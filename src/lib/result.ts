import type { VerificationResult } from "./schemas";
import type {
  DocumentPage,
  ResumeEvidenceExtraction,
  SocialSecurityEvidenceRecord,
} from "./schemas";
import type { EvidenceIssue } from "./evidence-validator";
import type { VerificationV2Item } from "./verification-engine-v2";

export type VerificationReport = {
  candidateName: string;
  verifiedAt: string;
  items: VerificationResult[];
  summary: {
    resumeExperienceCount: number;
    socialSecurityCompanyCount: number;
    matchedCount: number;
    companyAnomalyCount: number;
    dateAnomalyCount: number;
    undisclosedCount: number;
    unsupportedCount: number;
    gapMonthCount: number;
    anomalyCount: number;
    conclusion: "核验通过" | "建议人工复核";
    concerns: string[];
  };
};

export function createReport(
  candidateName: string,
  resumeCount: number,
  socialCompanyCount: number,
  items: VerificationResult[],
): VerificationReport {
  const anomalous = items.filter((item) => item.status !== "MATCHED");
  const count = (statuses: string[]) =>
    items.filter((item) => statuses.includes(item.status)).length;
  return {
    candidateName,
    verifiedAt: new Date().toISOString(),
    items,
    summary: {
      resumeExperienceCount: resumeCount,
      socialSecurityCompanyCount: socialCompanyCount,
      matchedCount: count(["MATCHED"]),
      companyAnomalyCount: count(["COMPANY_MISMATCH"]),
      dateAnomalyCount: count(["START_DATE_MISMATCH", "END_DATE_MISMATCH", "DATE_MISMATCH"]),
      undisclosedCount: count(["SOCIAL_SECURITY_ONLY"]),
      unsupportedCount: count(["RESUME_ONLY"]),
      gapMonthCount: items.reduce((sum, item) => sum + item.gapMonths.length, 0),
      anomalyCount: anomalous.length,
      conclusion: anomalous.length ? "建议人工复核" : "核验通过",
      concerns: anomalous.map((item) => item.description),
    },
  };
}

export type VerificationReportV2 = {
  schemaVersion: 2;
  candidateName: string;
  verifiedAt: string;
  documentPages: DocumentPage[];
  resumeExtraction: ResumeEvidenceExtraction;
  socialSecurityRecords: SocialSecurityEvidenceRecord[];
  evidenceIssues: EvidenceIssue[];
  items: VerificationV2Item[];
  usage: {
    ocrPages: number;
    ocrCalls: number;
    deepseekCalls: number;
    estimatedCost: number;
  };
  summary: {
    resumeExperienceCount: number;
    socialSecurityCompanyCount: number;
    exactMatchCount: number;
    anomalyCount: number;
    manualReviewCount: number;
    conclusion: "核验通过" | "建议人工复核";
    concerns: string[];
  };
};

export function createEvidenceReport(input: {
  candidateName: string;
  documentPages: DocumentPage[];
  resumeExtraction: ResumeEvidenceExtraction;
  socialSecurityRecords: SocialSecurityEvidenceRecord[];
  evidenceIssues: EvidenceIssue[];
  items: VerificationV2Item[];
  usage: VerificationReportV2["usage"];
}): VerificationReportV2 {
  const exactMatchCount = input.items.filter((item) => item.status === "EXACT_MATCH").length;
  const manualReviewCount = input.items.filter((item) =>
    ["EXTRACTION_UNCERTAIN", "MANUAL_REVIEW_REQUIRED", "PERSONAL_INSURANCE"].includes(
      item.status,
    ),
  ).length;
  const anomalous = input.items.filter((item) => item.status !== "EXACT_MATCH");
  return {
    schemaVersion: 2,
    candidateName: input.candidateName,
    verifiedAt: new Date().toISOString(),
    documentPages: input.documentPages,
    resumeExtraction: input.resumeExtraction,
    socialSecurityRecords: input.socialSecurityRecords,
    evidenceIssues: input.evidenceIssues,
    items: input.items,
    usage: input.usage,
    summary: {
      resumeExperienceCount: input.resumeExtraction.experiences.length,
      socialSecurityCompanyCount: new Set(
        input.socialSecurityRecords
          .map((record) => record.companyRaw.value)
          .filter((value): value is string => Boolean(value)),
      ).size,
      exactMatchCount,
      anomalyCount: anomalous.length,
      manualReviewCount,
      conclusion: anomalous.length ? "建议人工复核" : "核验通过",
      concerns: anomalous.map((item) => item.description),
    },
  };
}
