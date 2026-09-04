import { describe, expect, it } from "vitest";
import {
  applyFieldOverrides,
  revertOverride,
  upsertOverride,
  type FieldOverride,
} from "./manual-override";
import { verifyResumeAndSocial, type ResumeExperience, type SocialRecord } from "./simple-verification";

function override(
  partial: Partial<FieldOverride> & Pick<FieldOverride, "id" | "field">,
): FieldOverride {
  return {
    rowIndex: 0,
    originalValue: "甲科技有限公司",
    systemValue: "甲科技有限公司",
    overrideValue: "乙科技有限公司",
    reviewStatus: "applied",
    updatedAt: "2026-08-30T00:00:00.000Z",
    updatedBy: "manual-review",
    ...partial,
  };
}

describe("manual field overrides", () => {
  const experiences: ResumeExperience[] = [
    {
      sourceId: "resume-0",
      companyRaw: "甲科技有限公司",
      position: "工程师",
      startMonth: "2020-01",
      endMonth: "2021-05",
    },
  ];
  const socialRecords: SocialRecord[] = [
    {
      sourceId: "social-0",
      companyRaw: "甲科技有限公司",
      startMonth: "2020-01",
      endMonth: "2021-05",
      paidMonths: ["2020-01", "2020-02"],
      paymentType: "company",
    },
  ];

  it("applies a company override and recomputes pairing", () => {
    const applied = applyFieldOverrides({
      experiences,
      socialRecords,
      overrides: [override({ id: "o1", field: "resumeCompany", targetId: "resume-0" })],
    });
    const report = verifyResumeAndSocial({
      candidateName: "张三",
      experiences: applied.experiences,
      socialRecords: applied.socialRecords,
      overrides: [override({ id: "o1", field: "resumeCompany", targetId: "resume-0" })],
    });
    expect(applied.experiences[0]?.companyRaw).toBe("乙科技有限公司");
    expect(report.rows[0]?.hasManualOverride).toBe(true);
    expect(report.recruiterSummary.fullText).toContain("乙科技有限公司");
    expect(report.overallConclusion).toBe("NEEDS_REVIEW");
  });

  it("reverts an override back to the system value", () => {
    const current = [override({ id: "o1", field: "resumeCompany", targetId: "resume-0" })];
    const reverted = revertOverride(current, "o1");
    const applied = applyFieldOverrides({
      experiences,
      socialRecords,
      overrides: reverted,
    });
    expect(reverted[0]?.reviewStatus).toBe("reverted");
    expect(applied.experiences[0]?.companyRaw).toBe("甲科技有限公司");
    const report = verifyResumeAndSocial({
      candidateName: "张三",
      socialName: "张三",
      experiences: applied.experiences,
      socialRecords: applied.socialRecords,
      overrides: reverted,
    });
    expect(report.rows[0]?.hasManualOverride).toBe(false);
    expect(report.overallConclusion).toBe("PASS");
  });

  it("records manual-review as the updater and keeps original/system/override values", () => {
    const next = upsertOverride([], {
      id: "o2",
      rowIndex: 0,
      field: "paymentType",
      originalValue: "unknown",
      systemValue: "unknown",
      overrideValue: "company",
    });
    expect(next[0]).toMatchObject({
      originalValue: "unknown",
      systemValue: "unknown",
      overrideValue: "company",
      reviewStatus: "applied",
      updatedBy: "manual-review",
    });
  });
});
