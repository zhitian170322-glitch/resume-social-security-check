import { describe, expect, it } from "vitest";
import {
  PRODUCTION_READY,
  REAL_FIXTURE_CALIBRATION_PENDING,
  validateResumeEvidence,
  validateSocialSecurityRawRecords,
} from "./evidence-validator";
import { buildSocialSecurityCellEvidence } from "./social-security-evidence";
import { ShenzhenSocialSecurityParser } from "./social-security-parsers";
import type {
  SocialSecurityOCRCell,
  SocialSecurityOCRResult,
} from "./social-security-table";
import type { DocumentPage, ResumeEvidenceExtraction } from "./schemas";

const SYNTHETIC_FIXTURE = true;

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

function ocrCell(
  id: string,
  rawText: string,
  row: number,
  column: number,
  confidence = 0.96,
): SocialSecurityOCRCell {
  return {
    id,
    rawText,
    text: rawText,
    row,
    column,
    rowSpan: 1,
    columnSpan: 1,
    confidence,
    bbox: { x: column * 100, y: row * 30, width: 90, height: 24 },
    polygon: null,
  };
}

function syntheticShenzhenFixture() {
  const documentId = "synthetic-social-document";
  const result: SocialSecurityOCRResult = {
    page: 1,
    rawText: "深圳市社会保险 单位编号 单位名称 缴费年月",
    requestId: "synthetic-request",
    provider: "synthetic-provider",
    providerVersion: "synthetic-v1",
    apiType: "TABLE",
    ocrVersion: "synthetic-ocr-v1",
    contentHash: "synthetic-content",
    rawProviderResponseRef: "synthetic-request",
    tables: [
      {
        id: "units",
        page: 1,
        confidence: 0.96,
        provider: "synthetic-provider",
        providerVersion: "synthetic-v1",
        ocrVersion: "synthetic-ocr-v1",
        contentHash: "synthetic-content-units",
        rawProviderResponseRef: "synthetic-request",
        cells: [
          ocrCell("u-h-1", "单位编号", 0, 0),
          ocrCell("u-h-2", "单位名称", 0, 1),
          ocrCell("u-1", "30078648", 1, 0),
          ocrCell("u-2", "深圳市友点科技有限公司", 1, 1),
        ],
      },
      {
        id: "months",
        page: 1,
        confidence: 0.96,
        provider: "synthetic-provider",
        providerVersion: "synthetic-v1",
        ocrVersion: "synthetic-ocr-v1",
        contentHash: "synthetic-content-months",
        rawProviderResponseRef: "synthetic-request",
        cells: [
          ocrCell("m-h-1", "单位编号", 0, 0),
          ocrCell("m-h-2", "缴费年月", 0, 1),
          ocrCell("m-1-u", "30078648", 1, 0),
          ocrCell("m-1-m", "2022-08", 1, 1),
          ocrCell("m-2-u", "30078648", 2, 0),
          ocrCell("m-2-m", "2022-09", 2, 1),
          ocrCell("m-3-u", "30078648", 3, 0),
          ocrCell("m-3-m", "2022-10", 3, 1),
          ocrCell("m-4-u", "30078648", 4, 0),
          ocrCell("m-4-m", "2022-12", 4, 1),
        ],
      },
    ],
  };
  const cellEvidence = buildSocialSecurityCellEvidence(documentId, result);
  const parsed = new ShenzhenSocialSecurityParser().parse({
    ocr: result,
    sourceFile: "synthetic-shenzhen.pdf",
    documentId,
    cellEvidence,
  });
  return { cellEvidence, record: parsed.rawRecords[0] };
}

describe("[synthetic] Evidence Validator", () => {
  it("[synthetic] keeps real calibration and production gates closed", () => {
    expect(REAL_FIXTURE_CALIBRATION_PENDING).toBe(true);
    expect(PRODUCTION_READY).toBe(false);
  });

  it("[synthetic] CASE 1: rejects an AI-expanded company name", () => {
    expect(SYNTHETIC_FIXTURE).toBe(true);
    const input: ResumeEvidenceExtraction = {
      candidateName: evidence("腾讯科技", "腾讯科技"),
      experiences: [
        {
          resumeCompany: evidence("腾讯科技有限公司", "2022.03-2024.05\n腾讯科技"),
          resumeStartMonth: evidence("2022-03", "2022.03-2024.05\n腾讯科技"),
          resumeEndMonth: evidence("2024-05", "2022.03-2024.05\n腾讯科技"),
          warnings: [],
        },
      ],
    };
    const result = validateResumeEvidence(input, [page]);
    expect(result.valid).toBe(false);
    expect(result.automaticEligible).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: "EVIDENCE_MISMATCH" }),
    );
    expect(result.value.experiences[0].resumeCompany.status).toBe("uncertain");
  });

  it("[synthetic] CASE 2: accepts deterministic YYYY.MM to YYYY-MM conversion", () => {
    const input: ResumeEvidenceExtraction = {
      candidateName: evidence("腾讯科技", "腾讯科技"),
      experiences: [
        {
          resumeCompany: evidence("腾讯科技", "2022.03-2024.05\n腾讯科技"),
          resumeStartMonth: evidence("2022-03", "2022.03-2024.05\n腾讯科技"),
          resumeEndMonth: evidence("2024-05", "2022.03-2024.05\n腾讯科技"),
          warnings: [],
        },
      ],
    };
    expect(validateResumeEvidence(input, [page])).toMatchObject({
      valid: true,
      validationStatus: "VALIDATED",
      automaticEligible: true,
      issues: [],
    });
  });

  it("[synthetic] blocks PDF/OCR extraction conflicts before verification", () => {
    const conflictPage: DocumentPage = {
      ...page,
      ocrText: "2022.03-2024.05\n腾讯科技有限公司",
      selectedText: null,
      extractionMethod: "manual_required",
      warnings: ["EXTRACTION_CONFLICT"],
    };
    const input: ResumeEvidenceExtraction = {
      candidateName: evidence("腾讯科技", "腾讯科技"),
      experiences: [],
    };
    const validated = validateResumeEvidence(input, [conflictPage]);
    expect(validated).toMatchObject({
      valid: false,
      automaticEligible: false,
      validationStatus: "CONFLICT",
    });
    expect(validated.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "EXTRACTION_CONFLICT" }),
      ]),
    );
  });

  it("[synthetic] blocks fields already marked uncertain", () => {
    const uncertain = {
      ...evidence("腾讯科技", "腾讯科技"),
      status: "uncertain" as const,
    };
    const validated = validateResumeEvidence(
      { candidateName: uncertain, experiences: [] },
      [page],
    );
    expect(validated).toMatchObject({
      validationStatus: "UNCERTAIN",
      automaticEligible: false,
    });
    expect(validated.issues).toContainEqual(
      expect.objectContaining({ code: "FIELD_STATUS_BLOCKED" }),
    );
  });

  it("[synthetic] validates cell-backed paid months and deterministic gaps", () => {
    const fixture = syntheticShenzhenFixture();
    const validated = validateSocialSecurityRawRecords(
      [fixture.record],
      fixture.cellEvidence,
    );
    expect(validated).toMatchObject({
      valid: true,
      validationStatus: "VALIDATED",
      automaticEligible: true,
      recordStatuses: ["VALIDATED"],
      issues: [],
    });
    expect(fixture.record.derived).toMatchObject({
      paidMonthCount: 4,
      gapMonths: ["2022-11"],
    });
  });

  it("[synthetic] rejects AI-style company expansion not present in its cell", () => {
    const fixture = syntheticShenzhenFixture();
    fixture.record.companyRaw.value = "深圳市友点科技股份有限公司";
    const validated = validateSocialSecurityRawRecords(
      [fixture.record],
      fixture.cellEvidence,
    );
    expect(validated.automaticEligible).toBe(false);
    expect(validated.issues).toContainEqual(
      expect.objectContaining({
        code: "EVIDENCE_MISMATCH",
        field: "records.0.companyRaw",
      }),
    );
  });

  it("[synthetic] rejects paidMonths not backed by monthly cells", () => {
    const fixture = syntheticShenzhenFixture();
    fixture.record.paidMonths = [
      "2022-08",
      "2022-09",
      "2022-10",
      "2022-11",
      "2022-12",
    ];
    const validated = validateSocialSecurityRawRecords(
      [fixture.record],
      fixture.cellEvidence,
    );
    expect(validated).toMatchObject({
      validationStatus: "CONFLICT",
      automaticEligible: false,
    });
    expect(validated.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "DERIVATION_MISMATCH" }),
      ]),
    );
  });

  it("[synthetic] rejects missing and low-confidence cell evidence", () => {
    const fixture = syntheticShenzhenFixture();
    fixture.cellEvidence.find(
      (entry) => entry.id === fixture.record.companyRaw.evidenceIds[0],
    )!.confidence = 0.2;
    fixture.record.monthlyRecords[0].month.evidenceIds = ["missing-cell"];
    const validated = validateSocialSecurityRawRecords(
      [fixture.record],
      fixture.cellEvidence,
    );
    expect(validated.automaticEligible).toBe(false);
    expect(validated.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "CELL_EVIDENCE_MISSING" }),
        expect.objectContaining({ code: "CELL_CONFIDENCE_LOW" }),
      ]),
    );
  });

  it("[synthetic] marks records without monthly detail unsupported", () => {
    const fixture = syntheticShenzhenFixture();
    fixture.record.paidMonths = null;
    fixture.record.monthlyRecords = [];
    fixture.record.derived = {
      startMonth: null,
      endMonth: null,
      paidMonthCount: null,
      gapMonths: [],
      periods: [],
    };
    const validated = validateSocialSecurityRawRecords(
      [fixture.record],
      fixture.cellEvidence,
    );
    expect(validated).toMatchObject({
      validationStatus: "UNSUPPORTED",
      automaticEligible: false,
    });
    expect(validated.issues).toContainEqual(
      expect.objectContaining({ code: "MONTH_DETAIL_UNAVAILABLE" }),
    );
  });
});
