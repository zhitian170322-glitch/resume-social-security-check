import { describe, expect, it } from "vitest";
import type { EvidenceIssue } from "./evidence-validator";
import type { VerificationReport, VerificationReportV2 } from "./result";
import {
  buildResultViewModel,
  formatPaidDuration,
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
          position: {
            ...text("Java开发工程师"),
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
  derivedPaidMonths?: string[];
  includeDerivedFacts?: boolean;
  mutateReport?: (value: VerificationReportV2) => void;
}) {
  const verificationItem = input?.verificationItem ?? item();
  const verification: Phase8VerificationResult = {
    conclusion: input?.conclusion ?? "CONSISTENT",
    items: [verificationItem],
  };
  const result = report([verificationItem], input?.issues);
  input?.mutateReport?.(result);
  return buildResultViewModel({
    taskSchemaVersion: 2,
    result,
    verification,
    derivedFacts: input?.includeDerivedFacts === false ? null : {
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
          paidMonths:
            input?.derivedPaidMonths ?? ["2022-03", "2022-04"],
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
          businessResult: expect.objectContaining({
            comparison: expect.objectContaining({
              companyMatch: type,
            }),
          }),
        }),
      ],
    });
  });

  it.each([
    {
      name: "开始时间一致",
      resumeStart: "2022-03",
      socialStart: "2022-03",
      expectedStatus: "MATCH",
      expectedDifference: 0,
      expectedMessage: "开始时间一致。",
    },
    {
      name: "社保晚一个月",
      resumeStart: "2022-03",
      socialStart: "2022-04",
      expectedStatus: "SOCIAL_LATER",
      expectedDifference: 1,
      expectedMessage: "社保缴纳比简历入职时间晚 1 个月。",
    },
    {
      name: "社保早一个月",
      resumeStart: "2022-03",
      socialStart: "2022-02",
      expectedStatus: "SOCIAL_EARLIER",
      expectedDifference: 1,
      expectedMessage: "社保缴纳比简历入职时间早 1 个月。",
    },
  ] as const)(
    "[synthetic] maps $name deterministically",
    ({
      resumeStart,
      socialStart,
      expectedStatus,
      expectedDifference,
      expectedMessage,
    }) => {
      const verificationItem = item();
      verificationItem.resumePeriod = {
        startMonth: resumeStart,
        endMonth: "2024-03",
      };
      verificationItem.socialSecurityPeriod = {
        startMonth: socialStart,
        endMonth: "2024-03",
      };
      const mapped = model({
        verificationItem,
        mutateReport(value) {
          value.resumeExtraction.experiences[0].resumeStartMonth.value =
            resumeStart;
          value.resumeExtraction.experiences[0].resumeEndMonth.value =
            "2024-03";
          value.socialSecurityRecords[0].startMonth.value = socialStart;
          value.socialSecurityRecords[0].endMonth.value = "2024-03";
        },
      });
      expect(mapped).toMatchObject({
        legacy: false,
        items: [
          {
            businessResult: {
              comparison: {
                startMonthStatus: expectedStatus,
                startDifferenceMonths: expectedDifference,
                startMessage: expectedMessage,
              },
            },
          },
        ],
      });
    },
  );

  it.each([
    {
      name: "社保提前结束",
      resumeEnd: "2024-03",
      socialEnd: "2024-01",
      expectedStatus: "SOCIAL_EARLY_END",
      expectedDifference: 2,
    },
    {
      name: "社保延后结束",
      resumeEnd: "2024-03",
      socialEnd: "2024-05",
      expectedStatus: "SOCIAL_LATE_END",
      expectedDifference: 2,
    },
  ] as const)(
    "[synthetic] maps $name without changing engine verdict",
    ({ resumeEnd, socialEnd, expectedStatus, expectedDifference }) => {
      const verificationItem = item();
      verificationItem.resumePeriod = {
        startMonth: "2022-03",
        endMonth: resumeEnd,
      };
      verificationItem.socialSecurityPeriod = {
        startMonth: "2022-03",
        endMonth: socialEnd,
      };
      const mapped = model({
        verificationItem,
        mutateReport(value) {
          value.resumeExtraction.experiences[0].resumeEndMonth.value =
            resumeEnd;
          value.socialSecurityRecords[0].endMonth.value = socialEnd;
        },
      });
      expect(mapped).toMatchObject({
        legacy: false,
        items: [
          {
            businessResult: {
              comparison: {
                endMonthStatus: expectedStatus,
                endDifferenceMonths: expectedDifference,
              },
            },
          },
        ],
      });
    },
  );

  it.each([
    [29, 2, 5, "2年5个月"],
    [8, 0, 8, "8个月"],
    [24, 2, 0, "2年"],
  ] as const)(
    "[synthetic] maps %i validated paid months to business duration",
    (count, years, remaining, label) => {
      const paidMonths = Array.from(
        { length: count },
        (_, index) => `${2020 + Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`,
      );
      const verificationItem = item();
      verificationItem.paidMonths = paidMonths;
      const mapped = model({
        verificationItem,
        derivedPaidMonths: paidMonths,
      });
      expect(mapped).toMatchObject({
        legacy: false,
        items: [
          {
            businessResult: {
              social: {
                paidMonthCount: count,
                paidYears: years,
                paidRemainingMonths: remaining,
                paidDuration: label,
              },
            },
          },
        ],
      });
      expect(formatPaidDuration(years, remaining)).toBe(label);
    },
  );

  it("[synthetic] keeps interval span separate from unknown actual paid months", () => {
    const verificationItem = item("MANUAL_REVIEW_REQUIRED");
    verificationItem.socialSecurityPeriod = {
      startMonth: "2022-12",
      endMonth: "2025-04",
    };
    verificationItem.paidMonths = [];
    const mapped = model({
      verificationItem,
      includeDerivedFacts: false,
      mutateReport(value) {
        value.socialSecurityRecords[0].startMonth.value = "2022-12";
        value.socialSecurityRecords[0].endMonth.value = "2025-04";
        value.socialSecurityRecords[0].paidMonths = {
          ...evidenceBase,
          status: "missing",
          value: null,
        };
      },
    });

    expect(mapped).toMatchObject({
      legacy: false,
      items: [
        {
          businessResult: {
            social: {
              paidMonthCount: null,
              paidYears: null,
              paidRemainingMonths: null,
              paidDuration: null,
              timeSpanMonths: 29,
            },
          },
        },
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
          businessResult: expect.objectContaining({
            social: expect.objectContaining({
              gapMonths: ["2022-04"],
              gapSummary: "1个月",
            }),
          }),
        }),
      ],
    });
  });

  it("[synthetic] maps no gaps and multiple supplied gaps without guessing", () => {
    const noGap = model();
    const value = item("GAP_DETECTED");
    value.gapMonths = ["2023-03", "2023-07"];
    const multiple = model({ verificationItem: value });
    expect(noGap).toMatchObject({
      legacy: false,
      items: [{ businessResult: { social: { gapMonths: [], gapSummary: "无" } } }],
    });
    expect(multiple).toMatchObject({
      legacy: false,
      items: [
        {
          businessResult: {
            social: {
              gapMonths: ["2023-03", "2023-07"],
              gapSummary: "2个月",
            },
          },
        },
      ],
    });
  });

  it("[synthetic] maps resume-only and social-only records with neutral factual copy", () => {
    const resumeOnly = item("RESUME_ONLY");
    resumeOnly.rawSocialSecurityCompanyName = null;
    resumeOnly.socialSecurityPeriod = null;
    resumeOnly.companyMatchType = null;
    const socialOnly = item("SOCIAL_SECURITY_ONLY");
    socialOnly.rawResumeCompanyName = null;
    socialOnly.resumePeriod = null;
    socialOnly.companyMatchType = null;

    expect(model({ verificationItem: resumeOnly })).toMatchObject({
      legacy: false,
      items: [
        {
          businessResult: {
            scenario: "RESUME_WITHOUT_SOCIAL_RECORD",
            scenarioMessage: "该段简历经历未找到对应社保单位记录。",
            resume: { companyRaw: "甲公司" },
            social: null,
          },
        },
      ],
    });
    expect(model({ verificationItem: socialOnly })).toMatchObject({
      legacy: false,
      items: [
        {
          businessResult: {
            scenario: "UNDECLARED_SOCIAL_RECORD",
            scenarioMessage: "社保存在简历未体现的缴纳单位。",
            resume: null,
            social: { companyRaw: "甲公司" },
          },
        },
      ],
    });
  });

  it("[synthetic] keeps one uncertain end field local to that comparison", () => {
    const blockedItem = item("MANUAL_REVIEW_REQUIRED");
    blockedItem.companyMatchType = null;
    blockedItem.rawResumeCompanyName = null;
    blockedItem.rawSocialSecurityCompanyName = null;
    blockedItem.resumePeriod = null;
    blockedItem.socialSecurityPeriod = null;
    blockedItem.paidMonths = [];
    blockedItem.requiresManualReview = true;
    const mapped = model({
      conclusion: "MANUAL_REVIEW_REQUIRED",
      verificationItem: blockedItem,
      mutateReport(value) {
        value.resumeExtraction.experiences[0].resumeEndMonth.status =
          "uncertain";
      },
    });
    expect(mapped).toMatchObject({
      legacy: false,
      items: [
        {
          businessResult: {
            scenario: "MANUAL_REVIEW_REQUIRED",
            resume: {
              companyRaw: "甲公司",
              position: "Java开发工程师",
              fieldStatus: {
                companyRaw: "VALIDATED",
                position: "VALIDATED",
                startMonth: "VALIDATED",
                endMonth: "UNCERTAIN",
              },
            },
            social: {
              companyRaw: "甲公司",
              paidMonthCount: 2,
            },
            comparison: {
              companyMatch: "EXACT",
              startMonthStatus: "MATCH",
              endMonthStatus: "MATCH",
              reviewRequiredFields: ["resume.endMonth"],
            },
          },
        },
      ],
    });
  });

  it("[synthetic] preserves both raw company names and technical Evidence", () => {
    const verificationItem = item();
    verificationItem.rawResumeCompanyName = "深圳市甲科技有限公司";
    verificationItem.rawSocialSecurityCompanyName = "甲科技";
    verificationItem.companyMatchType = "FUZZY_CANDIDATE";
    const mapped = model({
      verificationItem,
      mutateReport(value) {
        value.resumeExtraction.experiences[0].resumeCompany.value =
          "深圳市甲科技有限公司";
        value.socialSecurityRecords[0].companyRaw.value = "甲科技";
      },
      issues: [
        {
          code: "OCR_CONFIDENCE_LOW",
          field: "records.0.companyRaw",
          sourceFile: "synthetic.pdf",
          sourcePage: 1,
          message: "technical detail retained",
        },
      ],
    });
    expect(mapped).toMatchObject({
      legacy: false,
      evidenceIssues: [
        {
          code: "OCR_CONFIDENCE_LOW",
          message: "technical detail retained",
        },
      ],
      items: [
        {
          businessResult: {
            resume: { companyRaw: "深圳市甲科技有限公司" },
            social: { companyRaw: "甲科技" },
            comparison: { companyMatch: "FUZZY_CANDIDATE" },
          },
        },
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
        field: "experiences.0.companyRaw",
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

function monthSequence(start: string, count: number) {
  const [year, month] = start.split("-").map(Number);
  return Array.from({ length: count }, (_, index) => {
    const value = year * 12 + (month - 1) + index;
    return `${Math.floor(value / 12)}-${String((value % 12) + 1).padStart(2, "0")}`;
  });
}

describe("[synthetic] recruiter comparison table", () => {
  it("keeps every pass, fail, review, resume-only and social-only row visible", () => {
    const pass = item("EXACT_MATCH");
    const fail = item("START_MONTH_MISMATCH");
    fail.rawResumeCompanyName = "深圳中软国际科技服务有限公司";
    fail.rawSocialSecurityCompanyName = "深圳中软国际科技服务有限公司";
    fail.resumePeriod = { startMonth: "2020-12", endMonth: "2026-04" };
    fail.socialSecurityPeriod = { startMonth: "2021-01", endMonth: "2026-04" };
    fail.companyMatchType = "EXACT";
    const reviewItem = item("MANUAL_REVIEW_REQUIRED");
    reviewItem.rawResumeCompanyName = "乙公司";
    reviewItem.rawSocialSecurityCompanyName = "乙公司";
    const resumeOnly = item("RESUME_ONLY");
    resumeOnly.rawSocialSecurityCompanyName = null;
    resumeOnly.socialSecurityPeriod = null;
    resumeOnly.companyMatchType = null;
    resumeOnly.paidMonths = [];
    const socialOnly = item("SOCIAL_SECURITY_ONLY");
    socialOnly.rawResumeCompanyName = null;
    socialOnly.resumePeriod = null;
    socialOnly.companyMatchType = null;
    const mapped = buildResultViewModel({
      taskSchemaVersion: 2,
      result: (() => {
        const value = report([pass, fail, reviewItem, resumeOnly, socialOnly]);
        value.resumeExtraction.experiences = [
          value.resumeExtraction.experiences[0],
          {
            ...value.resumeExtraction.experiences[0],
            resumeCompany: { ...text("深圳中软国际科技服务有限公司"), extractionMethod: "deepseek" },
            resumeStartMonth: { ...month("2020-12"), extractionMethod: "deepseek" },
            resumeEndMonth: { ...month("2026-04"), extractionMethod: "deepseek" },
          },
          {
            ...value.resumeExtraction.experiences[0],
            resumeCompany: { ...text("乙公司"), extractionMethod: "deepseek" },
          },
          {
            ...value.resumeExtraction.experiences[0],
            resumeCompany: { ...text("丙公司"), extractionMethod: "deepseek" },
          },
        ];
        value.socialSecurityRecords = [
          value.socialSecurityRecords[0],
          {
            ...value.socialSecurityRecords[0],
            companyRaw: text("深圳中软国际科技服务有限公司"),
            startMonth: month("2021-01"),
            endMonth: month("2026-04"),
          },
          {
            ...value.socialSecurityRecords[0],
            companyRaw: text("乙公司"),
          },
          {
            ...value.socialSecurityRecords[0],
            companyRaw: text("丁公司"),
          },
        ];
        return value;
      })(),
      verification: {
        conclusion: "INCONSISTENT",
        items: [pass, fail, reviewItem, resumeOnly, socialOnly],
      },
      derivedFacts: null,
      validationStage: null,
      humanReview: review,
      tableCells: [],
    });
    if (mapped.legacy) throw new Error("expected non-legacy model");
    expect(mapped.recruiterTable.map((row) => row.rowStatus)).toEqual([
      "PASS",
      "FAIL",
      "NEEDS_REVIEW",
      "RESUME_ONLY",
      "SOCIAL_ONLY",
    ]);
    expect(mapped.recruiterTable).toHaveLength(5);
    expect(mapped.recruiterTable[1]).toMatchObject({
      resumeCompany: "深圳中软国际科技服务有限公司",
      socialCompany: "深圳中软国际科技服务有限公司",
      resumePeriod: "2020-12 至 2026-04",
      socialPeriod: "2021-01 至 2026-04",
      rowStatusLabel: "不通过",
      reason: "社保开始缴纳时间比简历开始时间晚1个月",
    });
    expect(mapped.recruiterSummary).toMatchObject({
      conclusion: "FAIL",
      conclusionLabel: "不通过",
      passCount: 1,
      failCount: 1,
      reviewCount: 1,
      resumeOnlyCount: 1,
      socialOnlyCount: 1,
    });
    expect(mapped.recruiterSummary.fullText).not.toMatch(/所有工作经历完全一致/);
    expect(mapped.recruiterTable[1].correctionReference).toBe(
      [
        "深圳中软国际科技服务有限公司",
        "Java开发工程师",
        "2021-01 至 2026-04",
      ].join("\n"),
    );
  });

  it("recalculates 17 + 65 + 3 confirmed months as 85 months and 7年1个月", () => {
    const companyA = monthSequence("2020-01", 17);
    const companyB = monthSequence("2021-06", 65);
    const personal = monthSequence("2026-11", 3);
    const first = item("EXACT_MATCH");
    first.rawResumeCompanyName = "甲科技";
    first.rawSocialSecurityCompanyName = "甲科技";
    first.paidMonths = companyA;
    first.resumePeriod = { startMonth: "2020-01", endMonth: "2021-05" };
    first.socialSecurityPeriod = { startMonth: "2020-01", endMonth: "2021-05" };
    const second = item("EXACT_MATCH");
    second.rawResumeCompanyName = "乙科技";
    second.rawSocialSecurityCompanyName = "乙科技";
    second.paidMonths = companyB;
    second.resumePeriod = { startMonth: "2021-06", endMonth: "2026-10" };
    second.socialSecurityPeriod = { startMonth: "2021-06", endMonth: "2026-10" };
    const windowItem = item("PERSONAL_INSURANCE");
    windowItem.rawResumeCompanyName = null;
    windowItem.resumePeriod = null;
    windowItem.rawSocialSecurityCompanyName = "社保局个人缴费窗口";
    windowItem.socialSecurityPeriod = { startMonth: "2026-11", endMonth: "2027-01" };
    windowItem.paidMonths = personal;
    windowItem.companyMatchType = null;
    const mapped = buildResultViewModel({
      taskSchemaVersion: 2,
      result: (() => {
        const value = report([first, second, windowItem]);
        value.resumeExtraction.experiences = [
          {
            ...value.resumeExtraction.experiences[0],
            resumeCompany: { ...text("甲科技"), extractionMethod: "deepseek" },
            resumeStartMonth: { ...month("2020-01"), extractionMethod: "deepseek" },
            resumeEndMonth: { ...month("2021-05"), extractionMethod: "deepseek" },
          },
          {
            ...value.resumeExtraction.experiences[0],
            resumeCompany: { ...text("乙科技"), extractionMethod: "deepseek" },
            resumeStartMonth: { ...month("2021-06"), extractionMethod: "deepseek" },
            resumeEndMonth: { ...month("2026-10"), extractionMethod: "deepseek" },
          },
        ];
        value.socialSecurityRecords = [
          {
            ...value.socialSecurityRecords[0],
            companyRaw: text("甲科技"),
            startMonth: month("2020-01"),
            endMonth: month("2021-05"),
            paidMonths: months(companyA),
            personalInsurance: false,
          },
          {
            ...value.socialSecurityRecords[0],
            companyRaw: text("乙科技"),
            startMonth: month("2021-06"),
            endMonth: month("2026-10"),
            paidMonths: months(companyB),
            personalInsurance: false,
          },
          {
            ...value.socialSecurityRecords[0],
            companyRaw: text("社保局个人缴费窗口"),
            startMonth: month("2026-11"),
            endMonth: month("2027-01"),
            paidMonths: months(personal),
            personalInsurance: true,
          },
        ];
        return value;
      })(),
      verification: {
        conclusion: "MANUAL_REVIEW_REQUIRED",
        items: [first, second, windowItem],
      },
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
            companyRaw: "甲科技",
            companyRawSource: "VALIDATED_RAW_EVIDENCE",
            companyEvidenceRefs: ["a"],
            startMonth: "2020-01",
            endMonth: "2021-05",
            paidMonths: companyA,
            paidMonthsSource: "VALIDATED_MONTHLY_EVIDENCE",
            paidMonthsEvidenceRefs: ["a"],
          },
          {
            companyRaw: "乙科技",
            companyRawSource: "VALIDATED_RAW_EVIDENCE",
            companyEvidenceRefs: ["b"],
            startMonth: "2021-06",
            endMonth: "2026-10",
            paidMonths: companyB,
            paidMonthsSource: "VALIDATED_MONTHLY_EVIDENCE",
            paidMonthsEvidenceRefs: ["b"],
          },
          {
            companyRaw: "社保局个人缴费窗口",
            companyRawSource: "VALIDATED_RAW_EVIDENCE",
            companyEvidenceRefs: ["c"],
            startMonth: "2026-11",
            endMonth: "2027-01",
            paidMonths: personal,
            paidMonthsSource: "VALIDATED_MONTHLY_EVIDENCE",
            paidMonthsEvidenceRefs: ["c"],
          },
        ],
      },
      validationStage: null,
      humanReview: review,
      tableCells: [],
    });
    if (mapped.legacy) throw new Error("expected non-legacy model");
    expect(mapped.recruiterTable.map((row) => row.paidMonthCount)).toEqual([
      17, 65, 3,
    ]);
    expect(mapped.recruiterTotals).toMatchObject({
      companyPaidMonthCount: 82,
      personalPaidMonthCount: 3,
      actualPaidMonthCount: 85,
      salaryEffectiveMonthCount: 82,
      actualPaidDuration: "7年1个月",
    });
    expect(mapped.recruiterSummary.fullText).toContain("实际缴费：85个月");
    expect(mapped.recruiterSummary.fullText).toContain("折算年限：7年1个月");
    expect(mapped.recruiterSummary.fullText).not.toMatch(/约7\.08年/);
    expect(mapped.recruiterTable[2]).toMatchObject({
      rowStatus: "NEEDS_REVIEW",
      companyConsistentLabel: "—",
      reason: "个人参保或灵活就业，不自动计入工作经历和定薪年限",
    });
    expect(mapped.recruiterSummary.conclusion).not.toBe("PASS");
  });

  it("does not treat an interval-only span as actual paid months", () => {
    const verificationItem = item("EXACT_MATCH");
    verificationItem.paidMonths = [];
    const mapped = model({
      verificationItem,
      includeDerivedFacts: false,
      mutateReport(value) {
        value.socialSecurityRecords[0].startMonth.value = "2022-12";
        value.socialSecurityRecords[0].endMonth.value = "2025-04";
        value.socialSecurityRecords[0].paidMonths = {
          ...evidenceBase,
          status: "missing",
          value: null,
        };
      },
    });
    if (mapped.legacy) throw new Error("expected non-legacy model");
    expect(mapped.recruiterTable[0]).toMatchObject({
      paidMonthCount: null,
      paidMonthLabel: "无法从材料确定",
    });
    expect(mapped.recruiterTotals.actualPaidMonthCount).toBe(0);
  });
});
