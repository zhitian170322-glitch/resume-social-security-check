import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stripRegionLabelPrefix } from "@/lib/company-cleanup";
import {
  applyFieldOverrides,
  revertOverride,
} from "@/lib/manual-override";
import { fileFingerprint, pageFingerprint } from "@/lib/material-dedup";
import { readOverallConclusion } from "@/lib/overall-conclusion";
import { extractSocialRecords } from "@/lib/social-records";
import {
  inferPaymentType,
  uniquePaidMonths,
  verifyResumeAndSocial,
  type ResumeExperience,
  type SocialRecord,
} from "@/lib/simple-verification";
import { buildUnitCodeMap, aggregateMonthlyByUnitCode } from "@/lib/unit-code-map";
import { matchesHistorySearch } from "@/lib/history-search";
import {
  AMBIGUOUS_CODE_NAME_TEXT,
  MONTHLY_UNIT_CODE_TEXT,
  SEPARATED_CODE_NAME_TEXT,
  TABLE_CODE_NAME_CELLS,
  anonymizedOcr,
} from "./fixtures/v5-anonymized-ocr";

function months(start: string, count: number) {
  const [year, month] = start.split("-").map(Number);
  return Array.from({ length: count }, (_, index) => {
    const value = year * 12 + (month - 1) + index;
    return `${Math.floor(value / 12)}-${String((value % 12) + 1).padStart(2, "0")}`;
  });
}

describe("V5 anonymized real-structure fixtures", () => {
  it("1-4 maps separated unit codes, monthly codes, consecutive months and code switches", () => {
    const ocr = anonymizedOcr(
      `${MONTHLY_UNIT_CODE_TEXT}\n${SEPARATED_CODE_NAME_TEXT}`,
      TABLE_CODE_NAME_CELLS,
    );
    const mapped = buildUnitCodeMap({ ocr, sourceFile: "social-fixture.txt" });
    expect(mapped.map.get("470855")?.companyRaw).toBe("深圳示例动力信息技术有限公司");
    expect(mapped.map.get("693601")?.companyRaw).toBe("中电示例软件有限公司");
    expect(mapped.map.get("910017")?.companyRaw).toBe("示例光电科技有限公司");
    const groups = aggregateMonthlyByUnitCode(mapped.monthly, mapped.map);
    expect(groups.find((item) => item.unitCode === "470855")?.paidMonths).toHaveLength(9);
    expect(groups.find((item) => item.unitCode === "693601")?.paidMonths).toHaveLength(9);
    expect(groups.find((item) => item.unitCode === "910017")?.paidMonths).toHaveLength(1);
    expect(groups).toHaveLength(3);
  });

  it("5 keeps an ambiguous unit-code mapping for review without dropping the code", () => {
    const mapped = buildUnitCodeMap({
      ocr: anonymizedOcr(AMBIGUOUS_CODE_NAME_TEXT),
      sourceFile: "social-fixture.txt",
    });
    expect(mapped.map.get("470855")?.status).toBe("needs_review");
    expect(mapped.map.get("470855")?.companyRaw).toBeNull();
    expect(mapped.monthly[0]?.unitCode).toBe("470855");
    expect(mapped.monthly[0]?.sourceFile).toBe("social-fixture.txt");
  });

  it("6-7 strips independent region labels but keeps 深圳市 inside a legal name", () => {
    expect(stripRegionLabelPrefix("东莞市：深圳示例动力信息技术有限公司")).toBe(
      "深圳示例动力信息技术有限公司",
    );
    expect(stripRegionLabelPrefix("深圳市示例动力信息技术有限公司")).toBe(
      "深圳市示例动力信息技术有限公司",
    );
  });

  it("8-10 classifies personal, company and unknown payment types", () => {
    expect(inferPaymentType("社保局个人缴费窗口")).toBe("personal");
    expect(inferPaymentType("深圳示例动力信息技术有限公司")).toBe("company");
    expect(inferPaymentType(null)).toBe("unknown");
    expect(inferPaymentType(null, "unknown")).toBe("unknown");
  });

  it("11-12 deduplicates all paid months and overlapping company/personal months", () => {
    const report = verifyResumeAndSocial({
      candidateName: "候选人甲",
      socialName: "候选人甲",
      experiences: [
        {
          companyRaw: "深圳示例动力信息技术有限公司",
          position: "工程师",
          startMonth: "2025-01",
          endMonth: "2025-01",
        },
      ],
      socialRecords: [
        {
          companyRaw: "深圳示例动力信息技术有限公司",
          startMonth: "2025-01",
          endMonth: "2025-01",
          paidMonths: ["2025-01"],
          paymentType: "company",
        },
        {
          companyRaw: "社保局个人缴费窗口",
          startMonth: "2025-01",
          endMonth: "2025-01",
          paidMonths: ["2025-01"],
          paymentType: "personal",
        },
      ],
    });
    expect(report.recruiterSummary.fullText).not.toContain("定薪有效");
    expect(report.recruiterTotals.actualPaidMonthCount).toBe(0);
  });

  it("13 pairs different companies on a unique identical period and still fails", () => {
    const report = verifyResumeAndSocial({
      candidateName: "候选人甲",
      socialName: "候选人甲",
      experiences: [
        {
          companyRaw: "甲科技有限公司",
          position: "工程师",
          startMonth: "2025-01",
          endMonth: "2025-09",
        },
      ],
      socialRecords: [
        {
          companyRaw: "乙科技有限公司",
          startMonth: "2025-01",
          endMonth: "2025-09",
          paidMonths: months("2025-01", 9),
          paymentType: "company",
        },
      ],
    });
    expect(report.recruiterTable).toHaveLength(2);
    expect(report.overallConclusion).toBe("NEEDS_REVIEW");
  });

  it("14 sends different names to needs review without clearing companies", () => {
    const report = verifyResumeAndSocial({
      candidateName: "候选人甲",
      socialName: "候选人乙",
      experiences: [
        {
          companyRaw: "深圳示例动力信息技术有限公司",
          position: "工程师",
          startMonth: "2025-01",
          endMonth: "2025-09",
        },
      ],
      socialRecords: [
        {
          companyRaw: "深圳示例动力信息技术有限公司",
          startMonth: "2025-01",
          endMonth: "2025-09",
          paidMonths: months("2025-01", 9),
          paymentType: "company",
        },
      ],
    });
    expect(report.nameStatus).toBe("mismatch");
    expect(report.overallConclusion).toBe("PASS");
    expect(report.recruiterTable[0]?.resumeCompany).toContain("深圳示例动力");
  });

  it("15 uses the last social paid month for 至今", () => {
    const report = verifyResumeAndSocial({
      candidateName: "候选人甲",
      socialName: "候选人甲",
      experiences: [
        {
          companyRaw: "示例光电科技有限公司",
          position: "工程师",
          startMonth: "2026-07",
          endMonth: null,
          endIsPresent: true,
        },
      ],
      socialRecords: [
        {
          companyRaw: "示例光电科技有限公司",
          startMonth: "2026-07",
          endMonth: "2026-07",
          paidMonths: ["2026-07"],
          paymentType: "company",
        },
      ],
    });
    expect(report.rows[0]?.verificationBaseline).toBeNull();
    expect(report.recruiterTable[0]?.resumePeriod).toContain("至今");
    expect(report.overallConclusion).toBe("NEEDS_REVIEW");
  });

  it("16-17 deduplicates identical files and identical page fingerprints", () => {
    expect(fileFingerprint("same-bytes")).toBe(fileFingerprint("same-bytes"));
    expect(
      pageFingerprint("单位编号 470855\n第 1 页\n2025-01"),
    ).toBe(pageFingerprint("单位编号  470855\n1 / 2\n2025-01"));
    expect(
      pageFingerprint("深圳示例动力信息技术有限公司\n2025-01 470855"),
    ).not.toBe(pageFingerprint("深圳示例动力信息技术有限公司\n2025-10 693601"));
  });

  it("18-19 reapplies and reverts a manual override", () => {
    const experiences: ResumeExperience[] = [
      {
        sourceId: "resume-0",
        companyRaw: "甲科技有限公司",
        position: "工程师",
        startMonth: "2025-01",
        endMonth: "2025-09",
      },
    ];
    const socialRecords: SocialRecord[] = [
      {
        sourceId: "social-0",
        companyRaw: "乙科技有限公司",
        startMonth: "2025-01",
        endMonth: "2025-09",
        paidMonths: months("2025-01", 9),
        paymentType: "company",
      },
    ];
    const override = {
      id: "o1",
      rowIndex: 0,
      targetId: "resume-0",
      field: "resumeCompany" as const,
      originalValue: "甲科技有限公司",
      systemValue: "甲科技有限公司",
      overrideValue: "乙科技有限公司",
      reviewStatus: "applied" as const,
      updatedAt: "2026-08-30T00:00:00.000Z",
      updatedBy: "manual-review" as const,
    };
    const applied = applyFieldOverrides({ experiences, socialRecords, overrides: [override] });
    const after = verifyResumeAndSocial({
      candidateName: "候选人甲",
      socialName: "候选人甲",
      experiences: applied.experiences,
      socialRecords: applied.socialRecords,
      overrides: [override],
    });
    expect(after.overallConclusion).toBe("PASS");
    const reverted = applyFieldOverrides({
      experiences,
      socialRecords,
      overrides: revertOverride([override], "o1"),
    });
    const before = verifyResumeAndSocial({
      candidateName: "候选人甲",
      socialName: "候选人甲",
      experiences: reverted.experiences,
      socialRecords: reverted.socialRecords,
      overrides: revertOverride([override], "o1"),
    });
    expect(before.overallConclusion).toBe("NEEDS_REVIEW");
  });

  it("20-21 supports search and the pending review queue", () => {
    const record = {
      id: "t1",
      candidateName: "候选人甲",
      overallConclusion: "NEEDS_REVIEW",
      overallConclusionLabel: "待人工确认",
      reviewStatus: "PENDING",
      resumeCompanies: ["甲科技有限公司"],
      socialCompanies: ["乙科技有限公司"],
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
      status: "COMPLETED",
    };
    expect(matchesHistorySearch(record, { candidateName: "候选人甲", reviewOnly: true })).toBe(true);
    expect(matchesHistorySearch(record, { resumeCompany: "甲科技", socialCompany: "乙科技" })).toBe(true);
    expect(matchesHistorySearch({ ...record, overallConclusion: "PASS", reviewStatus: "CONFIRMED" }, { reviewOnly: true })).toBe(false);
  });

  it("22 keeps result, copy, workbench and history conclusions aligned", () => {
    const report = verifyResumeAndSocial({
      candidateName: "候选人甲",
      socialName: "候选人甲",
      experiences: [
        {
          companyRaw: "甲科技有限公司",
          position: "工程师",
          startMonth: "2025-01",
          endMonth: "2025-02",
        },
      ],
      socialRecords: [
        {
          companyRaw: "甲科技有限公司",
          startMonth: "2025-01",
          endMonth: "2025-01",
          paidMonths: ["2025-01"],
          paymentType: "company",
        },
      ],
    });
    const history = readOverallConclusion(report, "COMPLETED");
    expect(history.overallConclusionLabel).toBe(report.overallConclusionLabel);
    expect(report.recruiterSummary.fullText).toContain(`整体结论：${report.overallConclusionLabel}`);
    expect(history.overallConclusion).toBe(report.overallConclusion);
  });

  it("23 never treats a completed legacy task as 完全一致", () => {
    expect(readOverallConclusion({ schemaVersion: 2 }, "COMPLETED").overallConclusionLabel).toBe(
      "旧版记录",
    );
  });

  it("24-26 keeps desktop/social styles distinct, mobile cards, and no fake buttons", () => {
    const css = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");
    const chrome = readFileSync(new URL("../src/components/app-chrome.tsx", import.meta.url), "utf8");
    const resultView = readFileSync(
      new URL("../src/components/evidence-result-view.tsx", import.meta.url),
      "utf8",
    );
    expect(css).toMatch(/\.cell-resume/);
    expect(css).toMatch(/\.cell-social/);
    expect(css).toMatch(/\.mobile-result-cards/);
    expect(css).toMatch(/\.resume-card/);
    expect(css).toMatch(/\.social-card/);
    expect(css).toMatch(/\.result-card/);
    expect(resultView).toContain("简历公司");
    expect(resultView).toContain("社保公司");
    expect(resultView).toContain("该段结论");
    expect(chrome).not.toMatch(/disabled/);
    expect(chrome).not.toMatch(/Evidence Workspace/);
    expect(chrome).not.toMatch(/traffic-lights/);
  });

  it("computes 19 unique months from the anonymized monthly unit-code fixture", () => {
    const records = extractSocialRecords({
      ocr: anonymizedOcr(
        `${MONTHLY_UNIT_CODE_TEXT}\n${SEPARATED_CODE_NAME_TEXT}`,
        TABLE_CODE_NAME_CELLS,
      ),
      sourceFile: "social-fixture.txt",
    });
    const all = uniquePaidMonths(records.flatMap((record) => record.paidMonths));
    expect(all).toHaveLength(19);
    expect(records.some((record) => record.companyRaw === "470855")).toBe(false);
  });
});
