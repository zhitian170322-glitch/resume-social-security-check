import type { VerificationResult } from "./schemas";

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
