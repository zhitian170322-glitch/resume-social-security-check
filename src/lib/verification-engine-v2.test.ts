import { describe, expect, it } from "vitest";
import {
  PRODUCTION_READY,
  REAL_FIXTURE_CALIBRATION_PENDING,
  REAL_WORLD_CALIBRATION,
  classifyCompanyMatch,
  monthRange,
  verifyValidatedEvidence,
  type Phase8EvidenceGate,
} from "./verification-engine-phase8";
import { verifyEvidenceRecords as verifyWorkerEntry } from "./verification-engine-v2";
import type {
  EvidenceMonthField,
  EvidenceMonthsField,
  EvidenceNumberField,
  EvidenceStringField,
  ResumeEvidenceExperience,
  SocialSecurityEvidenceRecord,
  VerificationEvidenceGateStatus,
} from "./schemas";

const SYNTHETIC_FIXTURE = true;
const VALIDATED_GATE: Phase8EvidenceGate = {
  resume: "VALIDATED",
  socialSecurity: "VALIDATED",
};
const base = {
  status: "verified" as const,
  sourceFile: "synthetic-fixture.pdf",
  sourcePage: 1,
  sourceQuote: "synthetic fixture evidence",
  extractionMethod: "table_ocr" as const,
  confidence: 0.99,
};
const text = (value: string): EvidenceStringField => ({ ...base, value });
const month = (value: string): EvidenceMonthField => ({ ...base, value });
const months = (value: string[]): EvidenceMonthsField => ({ ...base, value });
const count = (value: number): EvidenceNumberField => ({ ...base, value });

function resume(
  company: string,
  startMonth = "2022-03",
  endMonth = "2022-06",
): ResumeEvidenceExperience {
  return {
    resumeCompany: { ...text(company), extractionMethod: "deepseek" },
    resumeStartMonth: {
      ...month(startMonth),
      extractionMethod: "deepseek",
    },
    resumeEndMonth: { ...month(endMonth), extractionMethod: "deepseek" },
    warnings: [],
  };
}

function social(
  company: string,
  startMonth = "2022-03",
  endMonth = "2022-06",
  paidMonths = monthRange(startMonth, endMonth),
): SocialSecurityEvidenceRecord {
  return {
    companyRaw: text(company),
    companyNormalized: "ignored-normalized-value",
    startMonth: month(startMonth),
    endMonth: month(endMonth),
    paidMonths: months(paidMonths),
    pensionMonths: count(paidMonths.length),
    injuryMonths: count(paidMonths.length),
    unemploymentMonths: count(paidMonths.length),
    personalInsurance: false,
    sourceFile: "synthetic-fixture.pdf",
    sourcePage: 1,
    sourceEvidence: ["synthetic-cell"],
    template: "shenzhen",
    warnings: [],
  };
}

function verify(
  resumeExperiences: ResumeEvidenceExperience[],
  socialSecurityRecords: SocialSecurityEvidenceRecord[],
) {
  return verifyValidatedEvidence({
    evidenceGate: VALIDATED_GATE,
    resumeExperiences,
    socialSecurityRecords,
  });
}

describe("[synthetic] Phase 8 deterministic verification", () => {
  it("[synthetic] keeps real calibration and production gates closed", () => {
    expect(REAL_FIXTURE_CALIBRATION_PENDING).toBe(true);
    expect(REAL_WORLD_CALIBRATION).toBe("PENDING");
    expect(PRODUCTION_READY).toBe(false);
  });

  it("[synthetic] produces the complete structured exact-match result", () => {
    expect(SYNTHETIC_FIXTURE).toBe(true);
    const result = verify([resume("甲公司")], [social("甲公司")]);
    expect(result.conclusion).toBe("CONSISTENT");
    expect(result.items[0]).toMatchObject({
      matchStatus: "EXACT_MATCH",
      companyMatchType: "EXACT",
      rawResumeCompanyName: "甲公司",
      rawSocialSecurityCompanyName: "甲公司",
      resumePeriod: { startMonth: "2022-03", endMonth: "2022-06" },
      socialSecurityPeriod: {
        startMonth: "2022-03",
        endMonth: "2022-06",
      },
      paidMonths: ["2022-03", "2022-04", "2022-05", "2022-06"],
      missingMonths: [],
      extraMonths: [],
      gapMonths: [],
      requiresManualReview: false,
      confidence: 0.99,
    });
    expect(result.items[0].evidenceRefs).toHaveLength(7);
  });

  it.each<VerificationEvidenceGateStatus>([
    "UNVERIFIED",
    "LOW_CONFIDENCE",
    "MISSING",
  ])(
    "[synthetic] prevents False Safe for %s evidence",
    (blockedStatus) => {
      const result = verifyValidatedEvidence({
        evidenceGate: {
          resume: blockedStatus,
          socialSecurity: "VALIDATED",
        },
        resumeExperiences: [resume("甲公司")],
        socialSecurityRecords: [social("甲公司")],
      });
      expect(result.conclusion).toBe("INSUFFICIENT_EVIDENCE");
      expect(result.items).not.toContainEqual(
        expect.objectContaining({ matchStatus: "EXACT_MATCH" }),
      );
    },
  );

  it.each<VerificationEvidenceGateStatus>([
    "CONFLICT",
    "MANUAL_REQUIRED",
    "UNCERTAIN",
    "UNSUPPORTED",
  ])(
    "[synthetic] forces manual review for %s evidence",
    (blockedStatus) => {
      const result = verifyValidatedEvidence({
        evidenceGate: {
          resume: "VALIDATED",
          socialSecurity: blockedStatus,
        },
        resumeExperiences: [resume("甲公司")],
        socialSecurityRecords: [social("甲公司")],
      });
      expect(result.conclusion).toBe("MANUAL_REVIEW_REQUIRED");
      expect(result.items[0].requiresManualReview).toBe(true);
      expect(result.items[0].matchStatus).not.toBe("EXACT_MATCH");
    },
  );

  it("[synthetic] prevents bypass when the explicit gate is omitted", () => {
    const items = verifyWorkerEntry({
      resumeExperiences: [resume("甲公司")],
      socialSecurityRecords: [social("甲公司")],
    });
    expect(items[0]).toMatchObject({
      matchStatus: "INSUFFICIENT_EVIDENCE",
      requiresManualReview: true,
    });
  });

  it("[synthetic] prevents a forged VALIDATED gate from covering an uncertain field", () => {
    const invalidResume = resume("甲公司");
    invalidResume.resumeCompany.status = "uncertain";
    const result = verify([invalidResume], [social("甲公司")]);
    expect(result.conclusion).toBe("INSUFFICIENT_EVIDENCE");
    expect(result.items[0].warnings).toContain(
      "VALIDATED_GATE_FIELD_CONTRADICTION",
    );
  });

  it("[synthetic] keeps normalized matches as manual candidates", () => {
    expect(
      classifyCompanyMatch(
        "XX 信息技术",
        "深圳市 XX 信息技术有限公司",
      ),
    ).toBe("NORMALIZED_MATCH");
    const result = verify(
      [resume("XX 信息技术")],
      [social("深圳市 XX 信息技术有限公司")],
    );
    expect(result.conclusion).toBe("MANUAL_REVIEW_REQUIRED");
    expect(result.items[0]).toMatchObject({
      companyMatchType: "NORMALIZED_MATCH",
      requiresManualReview: true,
    });
  });

  it("[synthetic] keeps fuzzy company candidates as manual candidates", () => {
    const result = verify(
      [resume("深圳市友点科技有限公司")],
      [social("深圳市友典科技有限公司")],
    );
    expect(result.items[0]).toMatchObject({
      companyMatchType: "FUZZY_CANDIDATE",
      requiresManualReview: true,
    });
  });

  it("[synthetic] detects deterministic company mismatch", () => {
    const result = verify([resume("甲公司")], [social("乙公司")]);
    expect(result).toMatchObject({
      conclusion: "INCONSISTENT",
      items: [
        {
          matchStatus: "COMPANY_MISMATCH",
          companyMatchType: "NO_MATCH",
        },
      ],
    });
  });

  it("[synthetic] distinguishes start and end month differences", () => {
    const start = verify(
      [resume("甲公司", "2022-02", "2022-06")],
      [social("甲公司")],
    );
    expect(start.items[0].matchStatus).toBe("START_MONTH_MISMATCH");
    expect(start.items[0].missingMonths).toEqual(["2022-02"]);

    const end = verify(
      [resume("甲公司", "2022-03", "2022-07")],
      [social("甲公司")],
    );
    expect(end.items[0].matchStatus).toBe("END_MONTH_MISMATCH");
    expect(end.items[0].missingMonths).toEqual(["2022-07"]);
  });

  it("[synthetic] derives gaps only from validated paidMonths", () => {
    const record = social("甲公司", "2022-03", "2022-06", [
      "2022-03",
      "2022-04",
      "2022-06",
    ]);
    const result = verify([resume("甲公司")], [record]);
    expect(result.items[0]).toMatchObject({
      matchStatus: "GAP_DETECTED",
      paidMonths: ["2022-03", "2022-04", "2022-06"],
      missingMonths: ["2022-05"],
      gapMonths: ["2022-05"],
    });
  });

  it("[synthetic] blocks inconsistent paidMonths-derived boundaries", () => {
    const record = social("甲公司", "2022-03", "2022-06", [
      "2022-04",
      "2022-05",
    ]);
    const result = verify([resume("甲公司")], [record]);
    expect(result).toMatchObject({
      conclusion: "MANUAL_REVIEW_REQUIRED",
      items: [
        expect.objectContaining({
          matchStatus: "MANUAL_REVIEW_REQUIRED",
          requiresManualReview: true,
        }),
      ],
    });
  });

  it("[synthetic] detects resume-only and social-security-only records", () => {
    const result = verify(
      [resume("甲公司", "2022-01", "2022-02")],
      [social("乙公司", "2023-01", "2023-02")],
    );
    expect(result.conclusion).toBe("INCONSISTENT");
    expect(result.items.map((item) => item.matchStatus)).toEqual([
      "RESUME_ONLY",
      "SOCIAL_SECURITY_ONLY",
    ]);
  });

  it("[synthetic] pairs multiple periods of the same company without merging them", () => {
    const result = verify(
      [
        resume("甲公司", "2022-01", "2022-02"),
        resume("甲公司", "2022-05", "2022-06"),
      ],
      [
        social("甲公司", "2022-05", "2022-06"),
        social("甲公司", "2022-01", "2022-02"),
      ],
    );
    expect(result.conclusion).toBe("CONSISTENT");
    expect(result.items).toHaveLength(2);
    expect(result.items.every((item) => item.matchStatus === "EXACT_MATCH")).toBe(
      true,
    );
    expect(
      result.items.every((item) =>
        item.warnings.includes("MULTIPLE_PERIODS_SAME_COMPANY"),
      ),
    ).toBe(true);
  });

  it("[synthetic] forces manual review for multiple companies in one month", () => {
    const result = verify(
      [
        resume("甲公司", "2022-03", "2022-03"),
        resume("乙公司", "2022-03", "2022-03"),
      ],
      [
        social("甲公司", "2022-03", "2022-03"),
        social("乙公司", "2022-03", "2022-03"),
      ],
    );
    expect(result.conclusion).toBe("MANUAL_REVIEW_REQUIRED");
    expect(
      result.items.every(
        (item) => item.matchStatus === "MULTIPLE_COMPANIES_SAME_MONTH",
      ),
    ).toBe(true);
  });

  it("[synthetic] detects same-month multiple companies without resume records", () => {
    const result = verify(
      [],
      [
        social("甲公司", "2022-03", "2022-03"),
        social("乙公司", "2022-03", "2022-03"),
      ],
    );
    expect(result.conclusion).toBe("MANUAL_REVIEW_REQUIRED");
    expect(
      result.items.every(
        (item) => item.matchStatus === "MULTIPLE_COMPANIES_SAME_MONTH",
      ),
    ).toBe(true);
  });

  it("[synthetic] forces manual review for personal insurance", () => {
    const personal = social("个人缴费", "2022-03", "2022-03");
    personal.personalInsurance = true;
    const result = verify([], [personal]);
    expect(result).toMatchObject({
      conclusion: "MANUAL_REVIEW_REQUIRED",
      items: [
        expect.objectContaining({
          matchStatus: "PERSONAL_INSURANCE",
          requiresManualReview: true,
        }),
      ],
    });
  });

  it("[synthetic] reports partially consistent mixed deterministic results", () => {
    const result = verify(
      [
        resume("甲公司", "2022-01", "2022-02"),
        resume("乙公司", "2022-03", "2022-04"),
      ],
      [
        social("甲公司", "2022-01", "2022-02"),
        social("乙公司", "2022-03", "2022-05"),
      ],
    );
    expect(result.conclusion).toBe("PARTIALLY_CONSISTENT");
    expect(result.items.map((item) => item.matchStatus)).toEqual([
      "EXACT_MATCH",
      "END_MONTH_MISMATCH",
    ]);
  });
});
