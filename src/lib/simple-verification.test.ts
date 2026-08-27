import { describe, expect, it } from "vitest";
import { extractSocialRecordsFromRawText } from "./social-records";
import {
  companiesMatch,
  uniquePaidMonths,
  verifyResumeAndSocial,
  type ResumeExperience,
  type SocialRecord,
} from "./simple-verification";

function months(start: string, count: number) {
  const [year, month] = start.split("-").map(Number);
  return Array.from({ length: count }, (_, index) => {
    const value = year * 12 + (month - 1) + index;
    return `${Math.floor(value / 12)}-${String((value % 12) + 1).padStart(2, "0")}`;
  });
}

function experience(
  companyRaw: string,
  startMonth: string,
  endMonth: string,
  position = "工程师",
): ResumeExperience {
  return { companyRaw, position, startMonth, endMonth };
}

function social(
  companyRaw: string,
  startMonth: string,
  endMonth: string,
  paid = months(startMonth, 1),
  paymentType: SocialRecord["paymentType"] = "company",
): SocialRecord {
  return {
    companyRaw,
    startMonth,
    endMonth,
    paidMonths: uniquePaidMonths(paid),
    paymentType,
    sourceFile: "social.pdf",
    sourcePage: 1,
    sourceQuote: companyRaw,
  };
}

describe("simple verification main chain", () => {
  it("keeps a record when only one field is missing", () => {
    const report = verifyResumeAndSocial({
      candidateName: "张三",
      experiences: [
        { companyRaw: "甲科技有限公司", position: "工程师", startMonth: null, endMonth: "2021-05" },
      ],
      socialRecords: [social("甲科技有限公司", "2020-01", "2021-05", months("2020-01", 17))],
    });
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0]?.resume?.companyRaw).toBe("甲科技有限公司");
    expect(report.rows[0]?.social?.companyRaw).toBe("甲科技有限公司");
    expect(report.recruiterTable[0]?.rowStatus).toBe("NEEDS_REVIEW");
    expect(report.recruiterTable[0]?.resumeCompany).toBe("甲科技有限公司");
  });

  it("fails and keeps both originals when start month differs by 1", () => {
    const report = verifyResumeAndSocial({
      candidateName: "张三",
      experiences: [experience("深圳中软国际科技服务有限公司", "2020-12", "2026-04")],
      socialRecords: [
        social(
          "深圳中软国际科技服务有限公司",
          "2021-01",
          "2026-04",
          months("2021-01", 64),
        ),
      ],
    });
    expect(report.recruiterTable[0]).toMatchObject({
      resumeCompany: "深圳中软国际科技服务有限公司",
      socialCompany: "深圳中软国际科技服务有限公司",
      resumePeriod: "2020-12 至 2026-04",
      socialPeriod: "2021-01 至 2026-04",
      rowStatus: "FAIL",
      rowStatusLabel: "不通过",
      startDifferenceLabel: "社保晚1个月",
    });
    expect(report.recruiterTable[0]?.itemText).toContain("不通过");
    expect(report.recruiterTable[0]?.correctionReference).toContain(
      "深圳中软国际科技服务有限公司",
    );
  });

  it("keeps both raw company names when they are inconsistent", () => {
    const report = verifyResumeAndSocial({
      candidateName: "张三",
      experiences: [experience("甲科技有限公司", "2020-01", "2021-05")],
      socialRecords: [social("甲科技股份有限公司", "2020-01", "2021-05", months("2020-01", 17))],
    });
    expect(report.recruiterTable[0]).toMatchObject({
      resumeCompany: "甲科技有限公司",
      socialCompany: "甲科技股份有限公司",
      companyConsistentLabel: "不一致",
      rowStatus: "FAIL",
    });
    expect(companiesMatch("甲科技有限公司", "甲科技股份有限公司")).toBe(false);
    expect(companiesMatch("甲　科技  有限公司", "甲 科技 有限公司")).toBe(true);
  });

  it("shows unpaired resume and social as separate rows", () => {
    const report = verifyResumeAndSocial({
      candidateName: "张三",
      experiences: [experience("简历独有公司", "2020-01", "2020-12")],
      socialRecords: [social("社保独有公司", "2021-01", "2021-12", months("2021-01", 12))],
    });
    expect(report.recruiterTable.map((row) => row.rowStatus)).toEqual([
      "RESUME_ONLY",
      "SOCIAL_ONLY",
    ]);
    expect(report.recruiterTable[0]?.resumeCompany).toBe("简历独有公司");
    expect(report.recruiterTable[1]?.socialCompany).toBe("社保独有公司");
    expect(report.recruiterSummary.conclusion).toBe("FAIL");
    expect(report.recruiterSummary.fullText).not.toMatch(/所有经历完全一致|所有工作经历完全一致/);
  });

  it("counts 17 + 65 + 3 = 85 months as 7年1个月 and excludes personal from salary-effective", () => {
    const report = verifyResumeAndSocial({
      candidateName: "张三",
      experiences: [
        experience("甲科技", "2020-01", "2021-05"),
        experience("乙科技", "2021-06", "2026-10"),
      ],
      socialRecords: [
        social("甲科技", "2020-01", "2021-05", months("2020-01", 17)),
        social("乙科技", "2021-06", "2026-10", months("2021-06", 65)),
        social(
          "社保局个人缴费窗口",
          "2026-11",
          "2027-01",
          months("2026-11", 3),
          "personal",
        ),
      ],
    });
    expect(report.recruiterTable.map((row) => row.paidMonthCount)).toEqual([17, 65, 3]);
    expect(report.recruiterTotals).toMatchObject({
      companyPaidMonthCount: 82,
      personalPaidMonthCount: 3,
      actualPaidMonthCount: 85,
      salaryEffectiveMonthCount: 82,
      actualPaidDuration: "7年1个月",
    });
    expect(report.recruiterSummary.fullText).toContain("实际缴费：85个月");
    expect(report.recruiterSummary.fullText).toContain("折算年限：7年1个月");
    expect(report.recruiterSummary.fullText).not.toMatch(/约7\.08年/);
    expect(report.recruiterTable[2]).toMatchObject({
      rowStatus: "NEEDS_REVIEW",
      socialCompany: "社保局个人缴费窗口",
    });
    expect(report.recruiterSummary.conclusion).not.toBe("PASS");
  });

  it("keeps the summary consistent with row statuses and still copyable when overall fail", () => {
    const report = verifyResumeAndSocial({
      candidateName: "李四",
      experiences: [
        experience("通过公司", "2020-01", "2020-02"),
        experience("失败公司", "2021-01", "2021-12"),
      ],
      socialRecords: [
        social("通过公司", "2020-01", "2020-02", ["2020-01", "2020-02"]),
        social("失败公司", "2021-02", "2021-12", months("2021-02", 11)),
        social("未申报公司", "2022-01", "2022-03", ["2022-01", "2022-02", "2022-03"]),
      ],
    });
    expect(report.recruiterTable.map((row) => row.rowStatusLabel)).toEqual([
      "通过",
      "不通过",
      "简历未体现",
    ]);
    expect(report.recruiterSummary).toMatchObject({
      conclusion: "FAIL",
      conclusionLabel: "不通过",
      passCount: 1,
      failCount: 1,
      socialOnlyCount: 1,
    });
    expect(report.recruiterSummary.fullText).toContain("整体结论：不通过");
    expect(report.recruiterSummary.fullText).toContain("失败公司");
    expect(report.recruiterTable[1]?.itemText).toContain("不通过");
  });

  it("extracts social fields from rawText when tables are absent", () => {
    const records = extractSocialRecordsFromRawText(
      "甲科技有限公司 2020年1月 至 2021年5月 累计17个月",
      "general.txt",
    );
    expect(records[0]?.companyRaw).toContain("甲科技有限公司");
    expect(records[0]?.startMonth).toBe("2020-01");
    expect(records[0]?.endMonth).toBe("2021-05");
  });
});
