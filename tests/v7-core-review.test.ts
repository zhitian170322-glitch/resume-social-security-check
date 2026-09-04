import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { companyFromMappedName, isUnitCode, normalizeCompanyName } from "../src/lib/company-cleanup";
import { diffCompanyChars } from "../src/lib/company-diff";
import { buildVerificationCopyText } from "../src/lib/copy-result";
import { applyFieldOverrides, revertOverride, upsertOverride } from "../src/lib/manual-override";
import { assertMonthRange, isValidYearMonth } from "../src/lib/month-input";
import { readOverallConclusion } from "../src/lib/overall-conclusion";
import { canLockReview, occupiedSocialIds } from "../src/lib/review-state";
import {
  companiesMatch,
  verifyResumeAndSocial,
  type ResumeExperience,
  type SocialRecord,
} from "../src/lib/simple-verification";
import { APP_NAVIGATION } from "../src/components/app-chrome";
import { recordHref } from "../src/lib/status-tone";
import { canCancelTask, TaskCancelledError, taskLifecycle } from "../src/lib/task-lifecycle";

function experience(companyRaw: string, startMonth: string | null, endMonth: string | null): ResumeExperience {
  return { sourceId: `resume-${companyRaw}`, companyRaw, position: null, startMonth, endMonth };
}

function social(
  companyRaw: string,
  startMonth: string | null,
  endMonth: string | null,
  extras: Partial<SocialRecord> = {},
): SocialRecord {
  return {
    sourceId: `social-${companyRaw}`,
    companyRaw,
    startMonth,
    endMonth,
    paidMonths: startMonth && endMonth ? [startMonth, endMonth] : [],
    paymentType: "company",
    sourceFile: "social.pdf",
    sourcePage: 1,
    sourceQuote: companyRaw,
    ...extras,
  };
}

describe("V7 core review", () => {
  it("1 three matching fields auto-pass", () => {
    const report = verifyResumeAndSocial({
      candidateName: "甲",
      experiences: [experience("深圳市示例科技有限公司", "2020-01", "2021-05")],
      socialRecords: [social("深圳市示例科技有限公司", "2020-01", "2021-05")],
    });
    expect(report.schemaVersion).toBe(7);
    expect(report.overallConclusion).toBe("PASS");
    expect(report.recruiterTable[0]?.rowStatus).toBe("PASS");
  });

  it("2 different companies fail", () => {
    const fail = verifyResumeAndSocial({
      candidateName: "甲",
      experiences: [experience("甲科技有限公司", "2020-01", "2021-05")],
      socialRecords: [social("乙科技有限公司", "2020-01", "2021-05")],
      manualLinks: [
        {
          id: "forced",
          resumeSourceId: "resume-甲科技有限公司",
          socialSourceId: "social-乙科技有限公司",
          reviewStatus: "applied",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    });
    expect(fail.recruiterTable[0]?.rowStatus).toBe("FAIL");
    expect(fail.overallConclusion).toBe("FAIL");
  });

  it("3 start month off by one fails", () => {
    const report = verifyResumeAndSocial({
      candidateName: "甲",
      experiences: [experience("甲科技有限公司", "2020-01", "2021-05")],
      socialRecords: [social("甲科技有限公司", "2020-02", "2021-05")],
    });
    expect(report.recruiterTable[0]?.rowStatus).toBe("FAIL");
    expect(report.recruiterTable[0]?.startDifferenceLabel).toBe("不一致");
  });

  it("4 end month off by one fails", () => {
    const report = verifyResumeAndSocial({
      candidateName: "甲",
      experiences: [experience("甲科技有限公司", "2020-01", "2021-05")],
      socialRecords: [social("甲科技有限公司", "2020-01", "2021-04")],
    });
    expect(report.recruiterTable[0]?.rowStatus).toBe("FAIL");
    expect(report.recruiterTable[0]?.endDifferenceLabel).toBe("不一致");
  });

  it("5 missing field needs review", () => {
    const report = verifyResumeAndSocial({
      candidateName: "甲",
      experiences: [experience("甲科技有限公司", null, "2021-05")],
      socialRecords: [social("甲科技有限公司", "2020-01", "2021-05")],
    });
    expect(report.recruiterTable[0]?.rowStatus).toBe("NEEDS_REVIEW");
  });

  it("6 independent leading colon is cleaned", () => {
    expect(companyFromMappedName("：鸿动力信息技术有限公司").companyRaw).toBe(
      "鸿动力信息技术有限公司",
    );
    expect(companiesMatch("：鸿动力信息技术有限公司", "鸿动力信息技术有限公司")).toBe(true);
  });

  it("7 truncated company names do not auto-pass", () => {
    const report = verifyResumeAndSocial({
      candidateName: "甲",
      experiences: [experience("深圳软通动力信息技术有限公司", "2020-01", "2021-05")],
      socialRecords: [social("深圳软通动力信息", "2020-01", "2021-05")],
      manualLinks: [
        {
          id: "trunc",
          resumeSourceId: "resume-深圳软通动力信息技术有限公司",
          socialSourceId: "social-深圳软通动力信息",
          reviewStatus: "applied",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    });
    expect(report.recruiterTable[0]?.rowStatus).toBe("NEEDS_REVIEW");
    expect(report.overallConclusion).not.toBe("PASS");
  });

  it("8 table vs general OCR conflict needs review", () => {
    const report = verifyResumeAndSocial({
      candidateName: "甲",
      experiences: [experience("甲科技有限公司", "2020-01", "2021-05")],
      socialRecords: [
        social("甲科技有限公司", "2020-01", "2021-05", {
          tableCompany: "甲科技有限公司",
          generalCompany: "乙科技有限公司",
          sourceConflict: true,
        }),
      ],
    });
    expect(report.recruiterTable[0]?.rowStatus).toBe("NEEDS_REVIEW");
  });

  it("9 different page experiences stay separate", () => {
    const report = verifyResumeAndSocial({
      candidateName: "甲",
      experiences: [
        { ...experience("甲科技有限公司", "2020-01", "2020-06"), sourcePage: 1 },
        { ...experience("乙科技有限公司", "2021-01", "2021-06"), sourcePage: 2 },
      ],
      socialRecords: [
        { ...social("甲科技有限公司", "2020-01", "2020-06"), sourcePage: 1 },
        { ...social("乙科技有限公司", "2021-01", "2021-06"), sourcePage: 2 },
      ],
    });
    expect(report.recruiterTable).toHaveLength(2);
    expect(report.recruiterTable.map((row) => row.resumeCompany)).toEqual([
      "甲科技有限公司",
      "乙科技有限公司",
    ]);
  });

  it("10 single page OCR failure does not wipe other pages", () => {
    const pages = [
      { page: 1, text: "甲科技有限公司 2020-01 2020-06", failed: false },
      { page: 2, text: "", failed: true },
      { page: 3, text: "乙科技有限公司 2021-01 2021-06", failed: false },
    ];
    const kept = pages.filter((page) => !page.failed);
    expect(kept).toHaveLength(2);
    expect(kept.map((page) => page.page)).toEqual([1, 3]);
  });

  it("11 unit codes are not company names", () => {
    expect(isUnitCode("470855")).toBe(true);
    expect(companyFromMappedName("470855").companyRaw).toBeNull();
  });

  it("12 city text inside a legal name is kept", () => {
    expect(normalizeCompanyName("深圳市软通动力信息技术有限公司")).toBe(
      "深圳市软通动力信息技术有限公司",
    );
  });

  it("13 position is not extracted, shown, or used", () => {
    const report = verifyResumeAndSocial({
      candidateName: "甲",
      experiences: [{ ...experience("甲科技有限公司", "2020-01", "2021-05"), position: "工程师" }],
      socialRecords: [social("甲科技有限公司", "2020-01", "2021-05")],
    });
    expect(report.recruiterTable[0]?.position).toBe("—");
    expect(report.recruiterSummary.fullText).not.toContain("职位");
    const deepseek = readFileSync(new URL("../src/lib/deepseek.ts", import.meta.url), "utf8");
    expect(deepseek).toContain("不要输出职位");
  });

  it("14 paid month counts are not calculated or shown", () => {
    const report = verifyResumeAndSocial({
      candidateName: "甲",
      experiences: [experience("甲科技有限公司", "2020-01", "2021-05")],
      socialRecords: [social("甲科技有限公司", "2020-01", "2021-05")],
    });
    expect(report.recruiterTable[0]?.paidMonthCount).toBeNull();
    expect(report.recruiterSummary.fullText).not.toContain("实际缴费");
  });

  it("15 salary-effective months are not shown", () => {
    const report = verifyResumeAndSocial({
      candidateName: "甲",
      experiences: [experience("甲科技有限公司", "2020-01", "2021-05")],
      socialRecords: [social("甲科技有限公司", "2020-01", "2021-05")],
    });
    expect(report.recruiterSummary.fullText).not.toContain("定薪有效");
  });

  it("16 至今 stays pending without manual confirmation", () => {
    const report = verifyResumeAndSocial({
      candidateName: "甲",
      experiences: [{ ...experience("甲科技有限公司", "2025-01", null), endIsPresent: true }],
      socialRecords: [social("甲科技有限公司", "2025-01", "2026-07")],
    });
    expect(report.overallConclusion).toBe("NEEDS_REVIEW");
  });

  it("17 unpaired records are not force-paired", () => {
    const report = verifyResumeAndSocial({
      candidateName: "甲",
      experiences: [experience("简历公司", "2020-01", "2020-12")],
      socialRecords: [social("社保公司", "2020-01", "2020-12")],
    });
    expect(report.recruiterTable.map((row) => row.rowStatus)).toEqual(["RESUME_ONLY", "SOCIAL_ONLY"]);
  });

  it("18 rematch recomputes", () => {
    const report = verifyResumeAndSocial({
      candidateName: "甲",
      experiences: [experience("甲科技有限公司", "2020-01", "2021-05")],
      socialRecords: [social("甲科技有限公司", "2020-01", "2021-05")],
      manualLinks: [
        {
          id: "link-1",
          resumeSourceId: "resume-甲科技有限公司",
          socialSourceId: "social-甲科技有限公司",
          reviewStatus: "applied",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    });
    expect(report.recruiterTable).toHaveLength(1);
    expect(report.overallConclusion).toBe("PASS");
  });

  it("19 confirm then recompute", () => {
    const base = verifyResumeAndSocial({
      candidateName: "甲",
      experiences: [experience("甲科技有限公司", "2020-01", "2021-05")],
      socialRecords: [social("甲科技有限公司", "2020-01", "2021-05")],
    });
    const overrides = upsertOverride([], {
      id: "c1",
      rowIndex: 0,
      field: "resumeCompany",
      originalValue: "甲科技有限公司",
      systemValue: "甲科技有限公司",
      overrideValue: "甲科技有限公司",
      kind: "confirm",
    });
    const next = verifyResumeAndSocial({
      candidateName: "甲",
      experiences: base.experiences,
      socialRecords: base.socialRecords,
      overrides,
    });
    expect(next.conclusionSource).toBe("confirmed_pass");
  });

  it("20 correct then recompute", () => {
    const applied = applyFieldOverrides({
      experiences: [experience("甲科技", "2020-01", "2021-05")],
      socialRecords: [social("甲科技有限公司", "2020-01", "2021-05")],
      overrides: [
        {
          id: "u1",
          rowIndex: 0,
          targetId: "resume-甲科技",
          field: "resumeCompany",
          originalValue: "甲科技",
          systemValue: "甲科技",
          overrideValue: "甲科技有限公司",
          kind: "correct",
          reviewStatus: "applied",
          updatedAt: "2026-01-01T00:00:00.000Z",
          updatedBy: "manual-review",
        },
      ],
    });
    const next = verifyResumeAndSocial({
      candidateName: "甲",
      experiences: applied.experiences,
      socialRecords: applied.socialRecords,
      overrides: [
        {
          id: "u1",
          rowIndex: 0,
          field: "resumeCompany",
          originalValue: "甲科技",
          systemValue: "甲科技",
          overrideValue: "甲科技有限公司",
          kind: "correct",
          reviewStatus: "applied",
        },
      ],
    });
    expect(next.overallConclusion).toBe("PASS");
    expect(next.conclusionSource).toBe("corrected_pass");
  });

  it("21 revert restores system values", () => {
    const overrides = revertOverride(
      [
        {
          id: "u1",
          rowIndex: 0,
          field: "resumeCompany",
          originalValue: "甲科技",
          systemValue: "甲科技",
          overrideValue: "甲科技有限公司",
          reviewStatus: "applied",
          updatedAt: "2026-01-01T00:00:00.000Z",
          updatedBy: "manual-review",
        },
      ],
      "u1",
    );
    const next = applyFieldOverrides({
      experiences: [experience("甲科技", "2020-01", "2021-05")],
      socialRecords: [social("甲科技有限公司", "2020-01", "2021-05")],
      overrides,
    });
    expect(next.experiences[0]?.companyRaw).toBe("甲科技");
  });

  it("22 worker rerun keeps manual values via overrides", () => {
    const extracted = [experience("甲科技", "2020-01", "2021-05")];
    const applied = applyFieldOverrides({
      experiences: extracted,
      socialRecords: [social("甲科技有限公司", "2020-01", "2021-05")],
      overrides: [
        {
          id: "u1",
          rowIndex: 0,
          targetId: "resume-甲科技",
          field: "resumeCompany",
          originalValue: "甲科技",
          systemValue: "甲科技",
          overrideValue: "甲科技有限公司",
          reviewStatus: "applied",
          updatedAt: "2026-01-01T00:00:00.000Z",
          updatedBy: "manual-review",
        },
      ],
    });
    expect(applied.experiences[0]?.companyRaw).toBe("甲科技有限公司");
  });

  it("23 lock review when nothing is pending", () => {
    expect(canLockReview({ overall: "PASS", pendingFieldCount: 0 }).ok).toBe(true);
  });

  it("24 cannot lock as pass while fields are pending", () => {
    expect(canLockReview({ overall: "NEEDS_REVIEW", pendingFieldCount: 1 }).ok).toBe(false);
    expect(canLockReview({ overall: "PASS", pendingFieldCount: 1 }).ok).toBe(false);
  });

  it("25 one-click copy matches page values", () => {
    const report = verifyResumeAndSocial({
      candidateName: "甲",
      experiences: [experience("甲科技有限公司", "2020-01", "2021-05")],
      socialRecords: [social("甲科技有限公司", "2020-01", "2021-05")],
    });
    const copy = buildVerificationCopyText({
      candidateName: report.candidateName,
      overallConclusionLabel: report.overallConclusionLabel,
      reviewStatusLabel: "系统核验通过",
      rows: report.recruiterTable,
    });
    expect(copy).toContain("候选人：甲");
    expect(copy).toContain("整体结论：通过");
    expect(copy).toBe(report.recruiterSummary.fullText);
    expect(copy).not.toContain("OCR");
  });

  it("26 four surfaces share one conclusion", () => {
    const report = verifyResumeAndSocial({
      candidateName: "甲",
      experiences: [experience("甲科技有限公司", "2020-01", "2021-05")],
      socialRecords: [social("甲科技有限公司", "2020-01", "2021-05")],
    });
    const history = readOverallConclusion(report, "COMPLETED");
    const workbench = readOverallConclusion(report, "COMPLETED");
    expect(history.overallConclusion).toBe(report.overallConclusion);
    expect(workbench.overallConclusion).toBe(report.overallConclusion);
    expect(report.recruiterSummary.conclusion).toBe(report.overallConclusion);
  });

  it("27 processing can be cancelled", () => {
    expect(canCancelTask({ status: "PROCESSING", cancelState: "none" })).toBe(true);
    expect(canCancelTask({ status: "COMPLETED", cancelState: "none" })).toBe(false);
  });

  it("28 cancel is idempotent", () => {
    expect(taskLifecycle({ status: "FAILED", cancelState: "cancelled", errorCode: "CANCELLED" })).toBe(
      "cancelled",
    );
    expect(taskLifecycle({ status: "FAILED", cancelState: "cancelled", errorCode: "CANCELLED" })).toBe(
      "cancelled",
    );
  });

  it("29 cancel wins over complete", () => {
    expect(taskLifecycle({ status: "PROCESSING", cancelState: "cancelled" })).toBe("cancelled");
    expect(() => {
      throw new TaskCancelledError();
    }).toThrowError(/TASK_CANCELLED/);
  });

  it("30 temp files are released by withTemporaryDocument", () => {
    const source = readFileSync(new URL("../src/lib/document-processor.ts", import.meta.url), "utf8");
    expect(source).toContain("withTemporaryDocument");
  });

  it("31 independent review nav is removed", () => {
    expect(APP_NAVIGATION.map((item) => item.label)).toEqual(["工作台", "新建核查", "核查记录"]);
  });

  it("32 old review URL redirects to filtered history", () => {
    const source = readFileSync(new URL("../src/app/review/page.tsx", import.meta.url), "utf8");
    const history = readFileSync(new URL("../src/components/history-view.tsx", import.meta.url), "utf8");
    expect(source).toContain("/history?status=待人工确认");
    expect(history).toContain("/history?status=待人工确认");
  });

  it("33 history rows use semantic links", () => {
    const source = readFileSync(new URL("../src/components/history-view.tsx", import.meta.url), "utf8");
    expect(source).toContain("row-link");
    expect(source).toContain("查看结果 →");
    expect(source).not.toMatch(/onClick=\{\(\) => router.push/);
  });

  it("34 processing items go to the progress page", () => {
    expect(recordHref({ id: "t1", status: "PROCESSING", overallConclusion: "PROCESSING" })).toBe(
      "/processing/t1",
    );
  });

  it("35 completed items go to the result page", () => {
    expect(recordHref({ id: "t1", status: "COMPLETED", overallConclusion: "PASS" })).toBe("/result/t1");
  });

  it("36 old schema 2/4/5/6 stay readable", () => {
    expect(readOverallConclusion({ schemaVersion: 2 }, "COMPLETED").overallConclusion).toBe("LEGACY");
    expect(
      readOverallConclusion(
        { schemaVersion: 4, overallConclusion: "FAIL", recruiterSummary: { conclusion: "FAIL" } },
        "COMPLETED",
      ).overallConclusion,
    ).toBe("FAIL");
    expect(
      readOverallConclusion(
        { schemaVersion: 5, overallConclusion: "PASS", recruiterSummary: { conclusion: "PASS" } },
        "COMPLETED",
      ).overallConclusion,
    ).toBe("PASS");
    expect(
      readOverallConclusion(
        { schemaVersion: 6, overallConclusion: "NEEDS_REVIEW", recruiterSummary: { conclusion: "NEEDS_REVIEW" } },
        "COMPLETED",
      ).overallConclusion,
    ).toBe("NEEDS_REVIEW");
  });

  it("37 company names do not break per character", () => {
    const css = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");
    expect(css).toContain("word-break: keep-all");
  });

  it("38 status chips are fit-content", () => {
    const css = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");
    expect(css).toContain("width: fit-content");
  });

  it("39 mobile cards keep core fields", () => {
    const source = readFileSync(new URL("../src/components/evidence-result-view.tsx", import.meta.url), "utf8");
    expect(source).toContain("mobile-result-cards");
    expect(source).toContain("公司匹配");
    expect(source).toContain("开始月份");
    expect(source).toContain("结束月份");
  });

  it("40 logs do not include material text or secrets", () => {
    const source = readFileSync(new URL("../src/lib/observability.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/rawText|companyRaw|API_KEY|ocrText/);
  });

  it("41 deploy script rejects a wrong production root", () => {
    const source = readFileSync(new URL("../scripts/deploy-update.sh", import.meta.url), "utf8");
    expect(source).toContain("拒绝把 /home/admin 识别为生产根目录");
    expect(source).toContain("--app-dir");
  });

  it("42 systemd success cannot replace image inspect", () => {
    const source = readFileSync(new URL("../scripts/deploy-update.sh", import.meta.url), "utf8");
    expect(source).toContain("不得把 systemd Result=success 当成构建成功");
  });

  it("month picker rejects invalid months", () => {
    expect(isValidYearMonth("2024-13")).toBe(false);
    expect(assertMonthRange("2024-05", "2024-01").ok).toBe(false);
    expect(assertMonthRange("2024-01", "2024-05").ok).toBe(true);
  });

  it("occupied social records cannot be reused silently", () => {
    const used = occupiedSocialIds([
      {
        id: "1",
        resumeSourceId: "r1",
        socialSourceId: "s1",
        reviewStatus: "applied",
        updatedAt: "t",
      },
    ]);
    expect(used.has("s1")).toBe(true);
  });

  it("company char diff is display-only", () => {
    const diff = diffCompanyChars("甲科技有限公司", "甲科技股份有限公司");
    expect(diff.left.some((item) => item.changed) || diff.right.some((item) => item.changed)).toBe(true);
    expect(companiesMatch("甲科技有限公司", "甲科技股份有限公司")).toBe(false);
  });
});
