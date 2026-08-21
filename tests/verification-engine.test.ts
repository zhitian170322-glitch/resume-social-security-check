import { describe, expect, it } from "vitest";
import {
  ResumeExtractionSchema,
  SocialSecurityExtractionSchema,
  YearMonthSchema,
} from "../src/lib/schemas";
import { differenceInMonths, verifyEmployment } from "../src/lib/verification-engine";

const resume = (
  resumeDeclaredCompany: string,
  resumeDeclaredStartMonth = "2023-01",
  resumeDeclaredEndMonth = "2023-03",
) => ({ resumeDeclaredCompany, resumeDeclaredStartMonth, resumeDeclaredEndMonth });

const social = (
  verifiedSocialSecurityCompany: string,
  verifiedSocialSecurityStartMonth = "2023-01",
  verifiedSocialSecurityEndMonth = "2023-03",
  paidMonths = ["2023-01", "2023-02", "2023-03"],
  sourceFile = "社保.pdf",
) => ({
  verifiedSocialSecurityCompany,
  verifiedSocialSecurityStartMonth,
  verifiedSocialSecurityEndMonth,
  verifiedSocialSecurityMonths: paidMonths.length,
  pensionMonths: paidMonths.length,
  injuryMonths: paidMonths.length,
  unemploymentMonths: paidMonths.length,
  paidMonths,
  sourceFile,
  personalInsurance: false,
});

describe("固定结构化 Schema", () => {
  it.each(["2024-1", "24-01", "2024-00", "2024-13", "2024-01-01"])(
    "拒绝非法月份 %s",
    (value) => expect(YearMonthSchema.safeParse(value).success).toBe(false),
  );

  it("拒绝空公司、倒序日期、负数与 OCR 字段缺失", () => {
    expect(
      ResumeExtractionSchema.safeParse({
        candidateName: "张三",
        resumeExperiences: [resume("", "2024-03", "2024-02")],
      }).success,
    ).toBe(false);
    const missing = social("甲公司");
    const { pensionMonths: _removed, ...ocrMissing } = missing;
    expect(
      SocialSecurityExtractionSchema.safeParse({
        socialSecurityRecords: [ocrMissing],
      }).success,
    ).toBe(false);
    expect(
      SocialSecurityExtractionSchema.safeParse({
        socialSecurityRecords: [{ ...social("甲公司"), pensionMonths: -1 }],
      }).success,
    ).toBe(false);
  });
});

describe("严格核验引擎", () => {
  it("1 公司、入职、离职完全一致", () => {
    expect(
      verifyEmployment({
        resumeExperiences: [resume("甲公司")],
        socialSecurityRecords: [social("甲公司")],
      }),
    ).toMatchObject([{ status: "MATCHED" }]);
  });

  it.each([
    ["甲公可", "公司差一个字"],
    ["甲公司", "简称与全称"],
    ["甲公司深圳分公司", "分公司不同"],
  ])("2-4 严格原文比较：%s（%s）", (resumeName) => {
    const [result] = verifyEmployment({
      resumeExperiences: [resume(resumeName)],
      socialSecurityRecords: [social("甲公司有限公司")],
    });
    expect(result.status).toBe("COMPANY_MISMATCH");
  });

  it.each([
    ["2023-01", "2023-03", "MATCHED", 0, 0],
    ["2022-12", "2023-03", "START_DATE_MISMATCH", -1, 0],
    ["2023-01", "2023-04", "END_DATE_MISMATCH", 0, 1],
    ["2022-12", "2023-04", "DATE_MISMATCH", -1, 1],
  ] as const)(
    "5-8 日期严格比较 %s~%s",
    (start, end, status, startDiff, endDiff) => {
      const [result] = verifyEmployment({
        resumeExperiences: [resume("甲公司", start, end)],
        socialSecurityRecords: [social("甲公司")],
      });
      expect(result).toMatchObject({
        status,
        startMonthDifference: startDiff,
        endMonthDifference: endDiff,
      });
    },
  );

  it("9 简历有社保无", () => {
    expect(
      verifyEmployment({ resumeExperiences: [resume("甲公司")], socialSecurityRecords: [] })[0]
        .status,
    ).toBe("RESUME_ONLY");
  });

  it("10 社保有简历无", () => {
    expect(
      verifyEmployment({ resumeExperiences: [], socialSecurityRecords: [social("甲公司")] })[0]
        .status,
    ).toBe("SOCIAL_SECURITY_ONLY");
  });

  it("11 个人参保", () => {
    const record = { ...social("个人参保"), personalInsurance: true };
    expect(
      verifyEmployment({ resumeExperiences: [], socialSecurityRecords: [record] })[0].status,
    ).toBe("PERSONAL_INSURANCE");
  });

  it("12 中间断缴", () => {
    const results = verifyEmployment({
      resumeExperiences: [resume("甲公司", "2023-01", "2023-06")],
      socialSecurityRecords: [
        social("甲公司", "2023-01", "2023-06", [
          "2023-01", "2023-02", "2023-03", "2023-04", "2023-06",
        ]),
      ],
    });
    expect(results).toContainEqual(expect.objectContaining({
      status: "GAP_PERIOD",
      gapMonths: ["2023-05"],
    }));
  });

  it("13-14 合并多城市、多份文件中的不同记录", () => {
    const results = verifyEmployment({
      resumeExperiences: [],
      socialSecurityRecords: [
        social("深圳甲公司", "2022-01", "2022-02", ["2022-01", "2022-02"], "深圳.pdf"),
        social("广州乙公司", "2023-01", "2023-02", ["2023-01", "2023-02"], "广州.png"),
      ],
    });
    expect(results.filter((item) => item.status === "SOCIAL_SECURITY_ONLY")).toHaveLength(2);
  });

  it("15 重复记录合并 paidMonths", () => {
    const results = verifyEmployment({
      resumeExperiences: [resume("甲公司")],
      socialSecurityRecords: [
        social("甲公司", "2023-01", "2023-03", ["2023-01"], "1.pdf"),
        social("甲公司", "2023-01", "2023-03", ["2023-02", "2023-03"], "2.pdf"),
      ],
    });
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe("MATCHED");
  });

  it("程序计算跨年月份差", () => {
    expect(differenceInMonths("2023-12", "2024-02")).toBe(2);
  });
});
