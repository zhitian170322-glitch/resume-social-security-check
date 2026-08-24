import { describe, expect, it } from "vitest";
import { validateResumeEvidence } from "./evidence-validator";
import type { DocumentPage, ResumeEvidenceExtraction } from "./schemas";

const page: DocumentPage = {
  page: 1,
  sourceFile: "resume.pdf",
  pdfText: "2022.03-2024.05\n腾讯科技",
  ocrText: null,
  selectedText: "2022.03-2024.05\n腾讯科技",
  extractionMethod: "pdf_text",
  qualityScore: 90,
  ocrConfidence: null,
  warnings: [],
};

function evidence(value: string, quote: string) {
  return {
    value,
    status: "verified" as const,
    sourceFile: "resume.pdf",
    sourcePage: 1,
    sourceQuote: quote,
    extractionMethod: "deepseek" as const,
    confidence: 0.95,
  };
}

describe("Evidence Validator", () => {
  it("CASE 1: rejects an AI-expanded company name", () => {
    const input: ResumeEvidenceExtraction = {
      candidateName: evidence("腾讯科技", "腾讯科技"),
      experiences: [
        {
          resumeCompany: evidence("腾讯科技有限公司", "腾讯科技"),
          resumeStartMonth: evidence("2022-03", "2022.03-2024.05"),
          resumeEndMonth: evidence("2024-05", "2022.03-2024.05"),
          warnings: [],
        },
      ],
    };
    const result = validateResumeEvidence(input, [page]);
    expect(result.valid).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: "EVIDENCE_MISMATCH" }),
    );
    expect(result.value.experiences[0].resumeCompany.status).toBe("uncertain");
  });

  it("CASE 2: accepts deterministic YYYY.MM to YYYY-MM conversion", () => {
    const input: ResumeEvidenceExtraction = {
      candidateName: evidence("腾讯科技", "腾讯科技"),
      experiences: [
        {
          resumeCompany: evidence("腾讯科技", "腾讯科技"),
          resumeStartMonth: evidence("2022-03", "2022.03-2024.05"),
          resumeEndMonth: evidence("2024-05", "2022.03-2024.05"),
          warnings: [],
        },
      ],
    };
    expect(validateResumeEvidence(input, [page])).toMatchObject({
      valid: true,
      issues: [],
    });
  });
});
