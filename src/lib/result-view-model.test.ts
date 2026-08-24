import { describe, expect, it } from "vitest";
import type { EvidenceIssue } from "./evidence-validator";
import type { VerificationReport, VerificationReportV2 } from "./result";
import {
  buildResultViewModel,
  readStoredArtifactPayload,
  type HumanReview,
} from "./result-view-model";
import {
  PROCESSING_STAGES,
  userFacingError,
} from "./result-ui-mappings";
import type {
  EvidenceMonthField,
  EvidenceMonthsField,
  EvidenceNumberField,
  EvidenceStringField,
  Phase8MatchStatus,
  Phase8TaskConclusion,
} from "./schemas";
import type {
  Phase8VerificationResult,
  VerificationV2Item,
} from "./verification-engine-phase8";

const SYNTHETIC_FIXTURE = true;
const review: HumanReview = {
  reviewStatus: "PENDING",
  reviewNote: null,
  reviewedAt: null,
};
const quote = "甲公司 2022-03 2022-04";
const evidenceBase = {
  status: "verified" as const,
  sourceFile: "synthetic.pdf",
  sourcePage: 1,
  sourceQuote: quote,
  extractionMethod: "table_ocr" as const,
  confidence: 0.98,
};
const text = (value: string): EvidenceStringField => ({
  ...evidenceBase,
  value,
});
const month = (value: string): EvidenceMonthField => ({
  ...evidenceBase,
  value,
});
const months = (value: string[]): EvidenceMonthsField => ({
  ...evidenceBase,
  value,
});
const number = (value: number): EvidenceNumberField => ({
  ...evidenceBase,
  value,
});

function item(
  matchStatus: Phase8MatchStatus = "EXACT_MATCH",
): VerificationV2Item {
  return {
    matchStatus,
    companyMatchType: "EXACT",
    rawResumeCompanyName: "甲公司",
    rawSocialSecurityCompanyName: "甲公司",
    normalizedCompanyName: "ignored-engine-normalized",
    resumePeriod: { startMonth: "2022-03", endMonth: "2022-04" },
    socialSecurityPeriod: {
      startMonth: "2022-03",
      endMonth: "2022-04",
    },
    paidMonths: ["2022-03", "2022-04"],
    missingMonths: [],
    extraMonths: [],
    gapMonths: [],
    warnings: [],
    evidenceRefs: [
      {
        field: "resumeCompanyRaw",
        sourceFile: "synthetic.pdf",
        sourcePage: 1,
        sourceQuote: quote,
        extractionMethod: "deepseek",
      },
      {
        field: "socialSecurityCompanyRaw",
        sourceFile: "synthetic.pdf",
        sourcePage: 1,
        sourceQuote: quote,
        extractionMethod: "table_ocr",
      },
      {
        field: "paidMonths",
        sourceFile: "synthetic.pdf",
        sourcePage: 1,
        sourceQuote: quote,
        extractionMethod: "table_ocr",
      },
    ],
    confidence: 0.98,
    requiresManualReview: false,
    status: "EXACT_MATCH",
    description: "synthetic deterministic result",
    rules: ["synthetic rule"],
  };
}

function report(items = [item()], issues: EvidenceIssue[] = []): VerificationReportV2 {
  return {
    schemaVersion: 2,
    candidateName: "合成候选人",
    verifiedAt: "2026-08-24T00:00:00.000Z",
    documentPages: [],
    resumeExtraction: {
      candidateName: {
        ...text("合成候选人"),
        sourceQuote: "合成候选人",
        extractionMethod: "deepseek",
      },
      experiences: [
        {
          resumeCompany: {
            ...text("甲公司"),
            extractionMethod: "deepseek",
          },
          resumeStartMonth: {
            ...month("2022-03"),
            extractionMethod: "deepseek",
          },
          resumeEndMonth: {
            ...month("2022-04"),
            extractionMethod: "deepseek",
          },
          warnings: [],
        },
      ],
    },
    socialSecurityRecords: [
      {
        companyRaw: text("甲公司"),
        companyNormalized: "甲",
        startMonth: month("2022-03"),
        endMonth: month("2022-04"),
        paidMonths: months(["2022-03", "2022-04"]),
        pensionMonths: number(2),
        injuryMonths: number(2),
        unemploymentMonths: number(2),
        personalInsurance: false,
        sourceFile: "synthetic.pdf",
        sourcePage: 1,
        sourceEvidence: ["synthetic-cell"],
        template: "shenzhen",
        warnings: [],
      },
    ],
    evidenceIssues: issues,
    items,
    usage: {
      ocrPages: 1,
      ocrCalls: 1,
      deepseekCalls: 1,
      estimatedCost: 0,
    },
    summary: {
      resumeExperienceCount: 1,
      socialSecurityCompanyCount: 1,
      exactMatchCount: items.filter(
        (entry) => entry.matchStatus === "EXACT_MATCH",
      ).length,
      anomalyCount: items.filter(
        (entry) => entry.matchStatus !== "EXACT_MATCH",
      ).length,
      manualReviewCount: items.filter(
        (entry) => entry.requiresManualReview,
      ).length,
      conclusion: "建议人工复核",
      concerns: [],
    },
  };
}

function model(input?: {
  conclusion?: Phase8TaskConclusion;
  verificationItem?: VerificationV2Item;
  issues?: EvidenceIssue[];
  humanReview?: HumanReview;
}) {
  const verificationItem = input?.verificationItem ?? item();
  const verification: Phase8VerificationResult = {
    conclusion: input?.conclusion ?? "CONSISTENT",
    items: [verificationItem],
  };
  return buildResultViewModel({
    taskSchemaVersion: 2,
    result: report([verificationItem], input?.issues),
    verification,
    derivedFacts: {
      versions: {
        taskSchemaVersion: 2,
        extractionVersion: "synthetic",
        ocrVersion: "synthetic",
        parserVersion: "synthetic",
        evidenceValidatorVersion: "synthetic",
        verificationEngineVersion: "synthetic",
      },
      socialSecurity: [
        {
          companyRaw: "甲公司",
          companyRawSource: "VALIDATED_RAW_EVIDENCE",
          companyEvidenceRefs: ["synthetic-cell"],
          startMonth: "2022-03",
          endMonth: "2022-04",
          paidMonths: ["2022-03", "2022-04"],
          paidMonthsSource: "VALIDATED_MONTHLY_EVIDENCE",
          paidMonthsEvidenceRefs: ["synthetic-cell"],
        },
      ],
    },
    validationStage: null,
    humanReview: input?.humanReview ?? review,
    tableCells: [
      {
        id: "synthetic-cell",
        sourceFile: "synthetic.pdf",
        page: 1,
        tableIndex: 0,
        rowIndex: 1,
        columnIndex: 0,
        rawValue: "甲公司",
        bbox: { x: 1, y: 1, width: 10, height: 10 },
        confidence: 0.98,
      },
    ],
  });
}

describe("[synthetic] Phase 9 Result UI mapping", () => {
  it.each([
    ["CONSISTENT", "基本一致"],
    ["INCONSISTENT", "存在明确差异"],
    ["PARTIALLY_CONSISTENT", "部分一致"],
    ["INSUFFICIENT_EVIDENCE", "材料不足，无法自动确认"],
    ["MANUAL_REVIEW_REQUIRED", "需要人工复核"],
  ] as const)("[synthetic] A-E: maps %s without motive language", (conclusion, label) => {
    expect(SYNTHETIC_FIXTURE).toBe(true);
    const value = model({ conclusion });
    expect(value).toMatchObject({
      legacy: false,
      machineResult: { conclusion, label },
    });
    expect(JSON.stringify(value)).not.toMatch(/造假|欺诈|虚假经历/);
  });

  it.each([
    ["EXACT", "名称完全一致"],
    ["NORMALIZED_MATCH", "名称疑似一致，需要人工确认"],
    ["FUZZY_CANDIDATE", "名称可能相关，需要人工确认"],
    ["NO_MATCH", "名称不一致"],
  ] as const)("[synthetic] F-H: maps company type %s conservatively", (type, label) => {
    const value = item();
    value.companyMatchType = type;
    value.requiresManualReview = type !== "EXACT" && type !== "NO_MATCH";
    const mapped = model({ verificationItem: value });
    expect(mapped).toMatchObject({
      legacy: false,
      items: [
        expect.objectContaining({
          companyMatchType: type,
          companyMatchLabel: label,
          rawResumeCompanyName: "甲公司",
          rawSocialSecurityCompanyName: "甲公司",
          normalizedCompanyName: "甲",
        }),
      ],
    });
  });

  it("[synthetic] I: displays paidMonths and supplied gap without recalculation", () => {
    const value = item("GAP_DETECTED");
    value.paidMonths = ["2022-03", "2022-05"];
    value.missingMonths = ["2022-04"];
    value.gapMonths = ["2022-04"];
    const mapped = model({ verificationItem: value });
    expect(mapped).toMatchObject({
      legacy: false,
      items: [
        expect.objectContaining({
          paidMonths: ["2022-03", "2022-05"],
          missingMonths: ["2022-04"],
          gapMonths: ["2022-04"],
          specialLabels: ["月份断缴"],
        }),
      ],
    });
  });

  it.each([
    ["RESUME_ONLY", "简历存在、无社保证据"],
    ["SOCIAL_SECURITY_ONLY", "社保存在、简历未披露"],
  ] as const)("[synthetic] J-K: exposes special scenario %s", (status, label) => {
    const value = item(status);
    const mapped = model({ verificationItem: value });
    expect(mapped).toMatchObject({
      legacy: false,
      items: [
        expect.objectContaining({
          matchStatus: status,
          specialLabels: [label],
        }),
      ],
    });
  });

  it("[synthetic] L: maps Evidence conflict distinctly", () => {
    const issues: EvidenceIssue[] = [
      {
        code: "EXTRACTION_CONFLICT",
        field: "company",
        sourceFile: "synthetic.pdf",
        sourcePage: 1,
        message: "synthetic conflict",
      },
    ];
    const mapped = model({
      conclusion: "MANUAL_REVIEW_REQUIRED",
      issues,
    });
    expect(mapped).toMatchObject({
      legacy: false,
      trustStatus: { code: "EXTRACTION_CONFLICT" },
    });
    if (!mapped.legacy) {
      expect(mapped.items[0].evidence[0].validationStatus).toBe("CONFLICT");
    }
  });

  it("[synthetic] M: maps low-confidence Evidence without a fake AI score", () => {
    const mapped = model({
      conclusion: "MANUAL_REVIEW_REQUIRED",
      issues: [
        {
          code: "OCR_CONFIDENCE_LOW",
          field: "company",
          sourceFile: "synthetic.pdf",
          sourcePage: 1,
          message: "synthetic low confidence",
        },
      ],
    });
    expect(mapped).toMatchObject({
      legacy: false,
      trustStatus: { code: "LOW_CONFIDENCE" },
    });
  });

  it("[synthetic] N: preserves old tasks without Evidence", () => {
    const legacy: VerificationReport = {
      candidateName: "旧候选人",
      verifiedAt: "2026-08-24T00:00:00.000Z",
      items: [],
      summary: {
        resumeExperienceCount: 0,
        socialSecurityCompanyCount: 0,
        matchedCount: 0,
        companyAnomalyCount: 0,
        dateAnomalyCount: 0,
        undisclosedCount: 0,
        unsupportedCount: 0,
        gapMonthCount: 0,
        anomalyCount: 0,
        conclusion: "建议人工复核",
        concerns: [],
      },
    };
    expect(
      buildResultViewModel({
        taskSchemaVersion: 1,
        result: legacy,
        verification: null,
        derivedFacts: null,
        validationStage: null,
        humanReview: review,
        tableCells: [],
      }),
    ).toMatchObject({
      legacy: true,
      warning: "旧版本任务，无完整证据链",
      report: legacy,
    });
  });

  it.each(["CONFIRMED", "REJECTED"] as const)(
    "[synthetic] O-P: keeps machine result separate from human %s",
    (reviewStatus) => {
      const mapped = model({
        conclusion: "MANUAL_REVIEW_REQUIRED",
        humanReview: {
          reviewStatus,
          reviewNote: "synthetic review note",
          reviewedAt: "2026-08-24T01:00:00.000Z",
        },
      });
      expect(mapped).toMatchObject({
        legacy: false,
        machineResult: { conclusion: "MANUAL_REVIEW_REQUIRED" },
        humanReview: { reviewStatus },
      });
    },
  );

  it("[synthetic] reads only a saved versioned artifact payload", () => {
    expect(
      readStoredArtifactPayload(
        JSON.stringify({
          stage: "VERIFICATION_COMPLETE",
          versions: {},
          payload: { conclusion: "CONSISTENT" },
        }),
      ),
    ).toEqual({ conclusion: "CONSISTENT" });
    expect(readStoredArtifactPayload("invalid-json")).toBeNull();
  });

  it("[synthetic] maps real processing stages without fake percentages", () => {
    expect(PROCESSING_STAGES.map(([stage]) => stage)).toEqual([
      "DOCUMENT_INGESTED",
      "EXTRACTION_COMPLETE",
      "OCR_COMPLETE",
      "STRUCTURED",
      "EVIDENCE_VALIDATED",
      "VERIFICATION_COMPLETE",
      "COMPLETED",
    ]);
    expect(userFacingError("TEMPLATE_UNKNOWN", null)).toContain("人工复核");
    expect(userFacingError("EVIDENCE_VALIDATION_FAILED", null)).toContain(
      "证据校验",
    );
  });
});
