import { describe, expect, it } from "vitest";
import { verifyEvidenceRecords } from "./verification-engine-v2";
import type {
  EvidenceMonthField,
  EvidenceMonthsField,
  EvidenceNumberField,
  EvidenceStringField,
  ResumeEvidenceExperience,
  SocialSecurityEvidenceRecord,
} from "./schemas";

const base = {
  status: "verified" as const,
  sourceFile: "fixture.pdf",
  sourcePage: 1,
  sourceQuote: "fixture",
  extractionMethod: "table_ocr" as const,
  confidence: 0.99,
};
const text = (value: string): EvidenceStringField => ({ ...base, value });
const month = (value: string): EvidenceMonthField => ({ ...base, value });
const months = (value: string[]): EvidenceMonthsField => ({ ...base, value });
const count = (value: number): EvidenceNumberField => ({ ...base, value });

function resume(company: string): ResumeEvidenceExperience {
  return {
    resumeCompany: { ...text(company), extractionMethod: "deepseek" },
    resumeStartMonth: { ...month("2022-03"), extractionMethod: "deepseek" },
    resumeEndMonth: { ...month("2024-05"), extractionMethod: "deepseek" },
    warnings: [],
  };
}

function social(company: string): SocialSecurityEvidenceRecord {
  const paid = ["2022-03", "2024-05"];
  return {
    companyRaw: text(company),
    companyNormalized: null,
    startMonth: month("2022-03"),
    endMonth: month("2024-05"),
    paidMonths: months(paid),
    pensionMonths: count(2),
    injuryMonths: count(2),
    unemploymentMonths: count(2),
    personalInsurance: false,
    sourceFile: "fixture.pdf",
    sourcePage: 1,
    sourceEvidence: ["fixture"],
    template: "shenzhen",
    warnings: [],
  };
}

describe("evidence-based verification", () => {
  it("CASE 4: normalized candidate match never becomes exact match", () => {
    const [result] = verifyEvidenceRecords({
      resumeExperiences: [resume("XX 信息技术")],
      socialSecurityRecords: [social("深圳市 XX 信息技术有限公司")],
    });
    expect(result).toMatchObject({
      status: "MANUAL_REVIEW_REQUIRED",
      companyComparison: {
        rawExactMatch: false,
        normalizedCandidateMatch: true,
        manualReview: true,
      },
    });
  });

  it("blocks automatic verification when evidence is uncertain", () => {
    const uncertain = resume("甲公司");
    uncertain.resumeCompany.status = "uncertain";
    const [result] = verifyEvidenceRecords({
      resumeExperiences: [uncertain],
      socialSecurityRecords: [social("甲公司")],
    });
    expect(result.status).toBe("EXTRACTION_UNCERTAIN");
  });
});
