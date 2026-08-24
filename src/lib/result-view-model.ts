import type { EvidenceIssue } from "./evidence-validator";
import type { VerificationReport, VerificationReportV2 } from "./result";
import type {
  EvidenceMonthField,
  EvidenceMonthsField,
  EvidenceNumberField,
  EvidenceStringField,
  Phase8MatchStatus,
  Phase8TaskConclusion,
} from "./schemas";
import type {
  DerivedFactsPayload,
  EvidenceValidationStagePayload,
} from "./worker-pipeline-integration";
import type {
  Phase8VerificationResult,
  VerificationV2Item,
} from "./verification-engine-phase8";

export type HumanReviewStatus = "PENDING" | "CONFIRMED" | "REJECTED";
export type DisplayEvidenceStatus =
  | "VALIDATED"
  | "UNCERTAIN"
  | "CONFLICT"
  | "LOW_CONFIDENCE"
  | "MISSING"
  | "UNSUPPORTED";

export type HumanReview = {
  reviewStatus: HumanReviewStatus;
  reviewNote: string | null;
  reviewedAt: string | null;
};

export type TableCellDisplay = {
  id: string;
  sourceFile: string;
  page: number;
  tableIndex: number;
  rowIndex: number;
  columnIndex: number;
  rawValue: string;
  bbox: unknown | null;
  confidence: number | null;
};

export type ResultEvidenceDisplay = {
  id: string;
  field: string;
  rawValue: string | null;
  sourceFile: string;
  sourcePage: number;
  sourceQuote: string;
  extractionMethod: string;
  validationStatus: DisplayEvidenceStatus;
  confidence: number | null;
  tableCells: TableCellDisplay[];
};

export type ResultViewItem = {
  id: string;
  matchStatus: Phase8MatchStatus;
  statusLabel: string;
  companyMatchType:
    | "EXACT"
    | "NORMALIZED_MATCH"
    | "FUZZY_CANDIDATE"
    | "NO_MATCH"
    | null;
  companyMatchLabel: string;
  rawResumeCompanyName: string | null;
  rawSocialSecurityCompanyName: string | null;
  normalizedCompanyName: string | null;
  resumePeriod: { startMonth: string; endMonth: string } | null;
  socialSecurityPeriod: { startMonth: string; endMonth: string } | null;
  paidMonths: string[];
  missingMonths: string[];
  extraMonths: string[];
  gapMonths: string[];
  warnings: string[];
  specialLabels: string[];
  confidence: number;
  requiresManualReview: boolean;
  description: string;
  rules: string[];
  evidence: ResultEvidenceDisplay[];
  derivedFact: DerivedFactsPayload["socialSecurity"][number] | null;
};

export type ResultViewModel =
  | {
      schemaVersion: 3;
      legacy: false;
      candidateName: string;
      verifiedAt: string;
      machineResult: {
        conclusion: Phase8TaskConclusion;
        label: string;
      };
      trustStatus: {
        code:
          | "EVIDENCE_COMPLETE"
          | "EVIDENCE_PARTIAL"
          | "LOW_CONFIDENCE"
          | "EXTRACTION_CONFLICT"
          | "MANUAL_CONFIRMATION";
        label: string;
      };
      humanReview: HumanReview;
      summary: VerificationReportV2["summary"];
      items: ResultViewItem[];
      evidenceIssues: EvidenceIssue[];
    }
  | {
      schemaVersion: 1;
      legacy: true;
      warning: "旧版本任务，无完整证据链";
      report: VerificationReport | null;
      humanReview: HumanReview;
    };

const conclusionLabels: Record<Phase8TaskConclusion, string> = {
  CONSISTENT: "基本一致",
  INCONSISTENT: "存在明确差异",
  PARTIALLY_CONSISTENT: "部分一致",
  INSUFFICIENT_EVIDENCE: "材料不足，无法自动确认",
  MANUAL_REVIEW_REQUIRED: "需要人工复核",
};

const matchStatusLabels: Record<Phase8MatchStatus, string> = {
  EXACT_MATCH: "材料记录一致",
  COMPANY_MISMATCH: "公司名称不一致",
  START_MONTH_MISMATCH: "入职月份存在差异",
  END_MONTH_MISMATCH: "离职月份存在差异",
  PERIOD_MISMATCH: "起止月份存在差异",
  GAP_DETECTED: "存在断缴月份",
  RESUME_ONLY: "简历经历无对应社保证据",
  SOCIAL_SECURITY_ONLY: "社保经历未在简历披露",
  PERSONAL_INSURANCE: "个人参保或灵活就业",
  MULTIPLE_COMPANIES_SAME_MONTH: "同月存在多家公司",
  INSUFFICIENT_EVIDENCE: "材料不足",
  MANUAL_REVIEW_REQUIRED: "需要人工复核",
};

const companyMatchLabels = {
  EXACT: "名称完全一致",
  NORMALIZED_MATCH: "名称疑似一致，需要人工确认",
  FUZZY_CANDIDATE: "名称可能相关，需要人工确认",
  NO_MATCH: "名称不一致",
} as const;

type EvidenceField =
  | EvidenceStringField
  | EvidenceMonthField
  | EvidenceMonthsField
  | EvidenceNumberField;

function parseJson(value: string | null) {
  if (!value) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

export function readStoredArtifactPayload<T>(
  payloadJson: string | null,
): T | null {
  const parsed = parseJson(payloadJson);
  if (
    !parsed ||
    typeof parsed !== "object" ||
    !("payload" in parsed)
  ) {
    return null;
  }
  return (parsed as { payload: T }).payload;
}

function flattenEvidenceFields(report: VerificationReportV2) {
  const values: Array<{ field: string; evidence: EvidenceField }> = [
    { field: "candidateName", evidence: report.resumeExtraction.candidateName },
  ];
  report.resumeExtraction.experiences.forEach((experience, index) => {
    values.push(
      {
        field: `resume.${index}.companyRaw`,
        evidence: experience.resumeCompany,
      },
      {
        field: `resume.${index}.startMonth`,
        evidence: experience.resumeStartMonth,
      },
      {
        field: `resume.${index}.endMonth`,
        evidence: experience.resumeEndMonth,
      },
    );
  });
  report.socialSecurityRecords.forEach((record, index) => {
    values.push(
      { field: `social.${index}.companyRaw`, evidence: record.companyRaw },
      { field: `social.${index}.startMonth`, evidence: record.startMonth },
      { field: `social.${index}.endMonth`, evidence: record.endMonth },
      { field: `social.${index}.paidMonths`, evidence: record.paidMonths },
      { field: `social.${index}.pensionMonths`, evidence: record.pensionMonths },
      { field: `social.${index}.injuryMonths`, evidence: record.injuryMonths },
      {
        field: `social.${index}.unemploymentMonths`,
        evidence: record.unemploymentMonths,
      },
    );
  });
  return values;
}

function issueDisplayStatus(
  issues: EvidenceIssue[],
): DisplayEvidenceStatus | null {
  if (
    issues.some((issue) =>
      [
        "EVIDENCE_MISMATCH",
        "EXTRACTION_CONFLICT",
        "CELL_EVIDENCE_MISMATCH",
        "DERIVATION_MISMATCH",
      ].includes(issue.code),
    )
  ) {
    return "CONFLICT";
  }
  if (
    issues.some((issue) =>
      ["OCR_CONFIDENCE_LOW", "CELL_CONFIDENCE_LOW"].includes(issue.code),
    )
  ) {
    return "LOW_CONFIDENCE";
  }
  if (
    issues.some((issue) =>
      ["SOURCE_QUOTE_MISSING", "CELL_EVIDENCE_MISSING"].includes(issue.code),
    )
  ) {
    return "MISSING";
  }
  if (
    issues.some((issue) =>
      [
        "EXTRACTION_UNSUPPORTED",
        "TRANSFORMATION_UNSUPPORTED",
        "MONTH_DETAIL_UNAVAILABLE",
      ].includes(issue.code),
    )
  ) {
    return "UNSUPPORTED";
  }
  return issues.length ? "UNCERTAIN" : null;
}

function fieldDisplayStatus(
  field: EvidenceField | undefined,
  issues: EvidenceIssue[],
): DisplayEvidenceStatus {
  const issueStatus = issueDisplayStatus(issues);
  if (issueStatus) return issueStatus;
  switch (field?.status) {
    case "verified":
      return "VALIDATED";
    case "missing":
      return "MISSING";
    case "unsupported":
      return "UNSUPPORTED";
    default:
      return "UNCERTAIN";
  }
}

function rawFieldValue(field: EvidenceField | undefined) {
  if (!field || field.value === null) return null;
  return Array.isArray(field.value)
    ? field.value.join("、")
    : String(field.value);
}

function specialLabels(item: {
  matchStatus: Phase8MatchStatus;
  gapMonths: string[];
  warnings: string[];
}, issues: EvidenceIssue[]) {
  const values: string[] = [];
  const add = (value: string) => {
    if (!values.includes(value)) values.push(value);
  };
  if (item.matchStatus === "PERSONAL_INSURANCE") add("个人参保 / 灵活就业");
  if (item.matchStatus === "MULTIPLE_COMPANIES_SAME_MONTH")
    add("同月多家公司");
  if (item.matchStatus === "SOCIAL_SECURITY_ONLY") add("社保存在、简历未披露");
  if (item.matchStatus === "RESUME_ONLY") add("简历存在、无社保证据");
  if (item.matchStatus === "GAP_DETECTED" || item.gapMonths.length)
    add("月份断缴");
  if (item.warnings.includes("TEMPLATE_UNKNOWN")) add("未知社保模板");
  if (
    item.warnings.some((warning) =>
      ["OCR_CONFIDENCE_LOW", "CELL_CONFIDENCE_LOW"].includes(warning),
    )
  )
    add("OCR 低置信度");
  if (item.warnings.includes("EXTRACTION_CONFLICT")) add("PDF / OCR 冲突");
  if (issues.some((issue) => issue.code === "TEMPLATE_UNKNOWN"))
    add("未知社保模板");
  if (
    issues.some((issue) =>
      ["OCR_CONFIDENCE_LOW", "CELL_CONFIDENCE_LOW"].includes(issue.code),
    )
  )
    add("OCR 低置信度");
  if (issues.some((issue) => issue.code === "EXTRACTION_CONFLICT"))
    add("PDF / OCR 冲突");
  return values;
}

function legacyMatchStatus(status: string): Phase8MatchStatus {
  const values: Record<string, Phase8MatchStatus> = {
    EXACT_MATCH: "EXACT_MATCH",
    COMPANY_MISMATCH: "COMPANY_MISMATCH",
    TIME_MISMATCH: "PERIOD_MISMATCH",
    RESUME_ONLY: "RESUME_ONLY",
    SOCIAL_SECURITY_ONLY: "SOCIAL_SECURITY_ONLY",
    GAP_DETECTED: "GAP_DETECTED",
    PERSONAL_INSURANCE: "PERSONAL_INSURANCE",
    EXTRACTION_UNCERTAIN: "INSUFFICIENT_EVIDENCE",
    MANUAL_REVIEW_REQUIRED: "MANUAL_REVIEW_REQUIRED",
  };
  return values[status] ?? "MANUAL_REVIEW_REQUIRED";
}

function trustStatus(
  conclusion: Phase8TaskConclusion,
  issues: EvidenceIssue[],
  validationStatus?: string,
) {
  if (validationStatus === "CONFLICT")
    return { code: "EXTRACTION_CONFLICT" as const, label: "存在 PDF/OCR 冲突" };
  if (validationStatus === "UNCERTAIN")
    return { code: "LOW_CONFIDENCE" as const, label: "存在 OCR 低置信度" };
  if (validationStatus === "UNSUPPORTED")
    return { code: "EVIDENCE_PARTIAL" as const, label: "证据部分缺失" };
  const issueStatus = issueDisplayStatus(issues);
  if (issueStatus === "CONFLICT")
    return { code: "EXTRACTION_CONFLICT" as const, label: "存在 PDF/OCR 冲突" };
  if (issueStatus === "LOW_CONFIDENCE")
    return { code: "LOW_CONFIDENCE" as const, label: "存在 OCR 低置信度" };
  if (conclusion === "INSUFFICIENT_EVIDENCE")
    return { code: "EVIDENCE_PARTIAL" as const, label: "证据部分缺失" };
  if (conclusion === "MANUAL_REVIEW_REQUIRED")
    return { code: "MANUAL_CONFIRMATION" as const, label: "需要人工确认" };
  return { code: "EVIDENCE_COMPLETE" as const, label: "证据完整" };
}

export function buildResultViewModel(input: {
  taskSchemaVersion: number;
  result: unknown;
  verification: Phase8VerificationResult | null;
  derivedFacts: DerivedFactsPayload | null;
  validationStage: EvidenceValidationStagePayload | null;
  humanReview: HumanReview;
  tableCells: TableCellDisplay[];
}): ResultViewModel {
  if (
    input.taskSchemaVersion < 2 ||
    !input.result ||
    typeof input.result !== "object" ||
    !("schemaVersion" in input.result) ||
    input.result.schemaVersion !== 2
  ) {
    return {
      schemaVersion: 1,
      legacy: true,
      warning: "旧版本任务，无完整证据链",
      report: (input.result as VerificationReport | null) ?? null,
      humanReview: input.humanReview,
    };
  }
  const report = input.result as VerificationReportV2;
  const conclusion =
    input.verification?.conclusion ?? "INSUFFICIENT_EVIDENCE";
  const sourceItems = (input.verification?.items ?? report.items) as Array<
    Partial<VerificationV2Item> & {
      status?: string;
      description?: string;
      rules?: string[];
    }
  >;
  const fields = flattenEvidenceFields(report);
  const items = sourceItems.map((sourceItem, index): ResultViewItem => {
    const matchStatus =
      sourceItem.matchStatus ??
      legacyMatchStatus(sourceItem.status ?? "MANUAL_REVIEW_REQUIRED");
    const references = sourceItem.evidenceRefs ?? [];
    const evidence = references.map((reference, referenceIndex) => {
      const matched = fields.find(
        (entry) =>
          entry.evidence.sourceFile === reference.sourceFile &&
          entry.evidence.sourcePage === reference.sourcePage &&
          entry.evidence.sourceQuote === reference.sourceQuote &&
          entry.evidence.extractionMethod === reference.extractionMethod,
      );
      const matchingIssues = report.evidenceIssues.filter(
        (issue) =>
          issue.sourceFile === reference.sourceFile &&
          issue.sourcePage === reference.sourcePage,
      );
      const rawValue = rawFieldValue(matched?.evidence);
      const cells = input.tableCells.filter(
        (cell) =>
          cell.sourceFile === reference.sourceFile &&
          (cell.rawValue === rawValue ||
            (Array.isArray(matched?.evidence.value) &&
              matched.evidence.value.includes(cell.rawValue))),
      );
      return {
        id: `${index}-${referenceIndex}-${reference.field}`,
        field: reference.field,
        rawValue,
        sourceFile: reference.sourceFile,
        sourcePage: reference.sourcePage,
        sourceQuote: reference.sourceQuote,
        extractionMethod: reference.extractionMethod,
        validationStatus: fieldDisplayStatus(
          matched?.evidence,
          matchingIssues,
        ),
        confidence: matched?.evidence.confidence ?? null,
        tableCells: cells,
      };
    });
    const rawSocialCompany = sourceItem.rawSocialSecurityCompanyName ?? null;
    const social = report.socialSecurityRecords.find(
      (record) => record.companyRaw.value === rawSocialCompany,
    );
    const derivedFact =
      input.derivedFacts?.socialSecurity.find(
        (fact) =>
          fact.companyRaw === rawSocialCompany &&
          fact.startMonth === sourceItem.socialSecurityPeriod?.startMonth &&
          fact.endMonth === sourceItem.socialSecurityPeriod?.endMonth,
      ) ?? null;
    return {
      id: `verification-${index}`,
      matchStatus,
      statusLabel: matchStatusLabels[matchStatus],
      companyMatchType: sourceItem.companyMatchType ?? null,
      companyMatchLabel: sourceItem.companyMatchType
        ? companyMatchLabels[sourceItem.companyMatchType]
        : "无可比较公司",
      rawResumeCompanyName: sourceItem.rawResumeCompanyName ?? null,
      rawSocialSecurityCompanyName: rawSocialCompany,
      normalizedCompanyName: social?.companyNormalized ?? null,
      resumePeriod: sourceItem.resumePeriod ?? null,
      socialSecurityPeriod: sourceItem.socialSecurityPeriod ?? null,
      paidMonths: sourceItem.paidMonths ?? [],
      missingMonths: sourceItem.missingMonths ?? [],
      extraMonths: sourceItem.extraMonths ?? [],
      gapMonths: sourceItem.gapMonths ?? [],
      warnings: sourceItem.warnings ?? [],
      specialLabels: specialLabels(
        {
          matchStatus,
          gapMonths: sourceItem.gapMonths ?? [],
          warnings: sourceItem.warnings ?? [],
        },
        report.evidenceIssues,
      ),
      confidence: sourceItem.confidence ?? 0,
      requiresManualReview: sourceItem.requiresManualReview ?? true,
      description: sourceItem.description ?? matchStatusLabels[matchStatus],
      rules: sourceItem.rules ?? [],
      evidence,
      derivedFact,
    };
  });
  return {
    schemaVersion: 3,
    legacy: false,
    candidateName: report.candidateName,
    verifiedAt: report.verifiedAt,
    machineResult: {
      conclusion,
      label: conclusionLabels[conclusion],
    },
    trustStatus: trustStatus(
      conclusion,
      report.evidenceIssues,
      input.validationStage?.validationStatus,
    ),
    humanReview: input.humanReview,
    summary: report.summary,
    items,
    evidenceIssues: report.evidenceIssues,
  };
}
