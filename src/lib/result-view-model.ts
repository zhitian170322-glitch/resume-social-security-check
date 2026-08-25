import type { EvidenceIssue } from "./evidence-validator";
import type { VerificationReport, VerificationReportV2 } from "./result";
import type {
  EvidenceMonthField,
  EvidenceMonthsField,
  EvidenceNumberField,
  EvidenceStringField,
  Phase8MatchStatus,
  Phase8TaskConclusion,
  ResumeEvidenceExperience,
  SocialSecurityEvidenceRecord,
} from "./schemas";
import { monthIndex } from "./schemas";
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

export type BusinessMonthStatus =
  | "MATCH"
  | "SOCIAL_EARLIER"
  | "SOCIAL_LATER"
  | "SOCIAL_EARLY_END"
  | "SOCIAL_LATE_END"
  | "MISSING"
  | "MANUAL_REVIEW_REQUIRED";

export type VerificationBusinessResult = {
  scenario:
    | "MATCHED_RECORDS"
    | "RESUME_WITHOUT_SOCIAL_RECORD"
    | "UNDECLARED_SOCIAL_RECORD"
    | "MANUAL_REVIEW_REQUIRED";
  scenarioMessage: string;
  resume: {
    companyRaw: string | null;
    position: string | null;
    startMonth: string | null;
    endMonth: string | null;
    fieldStatus: {
      companyRaw: DisplayEvidenceStatus;
      position: DisplayEvidenceStatus;
      startMonth: DisplayEvidenceStatus;
      endMonth: DisplayEvidenceStatus;
    };
  } | null;
  social: {
    companyRaw: string | null;
    startMonth: string | null;
    endMonth: string | null;
    paidMonthCount: number | null;
    paidYears: number | null;
    paidRemainingMonths: number | null;
    paidDuration: string | null;
    gapMonths: string[];
    gapSummary: string;
  } | null;
  comparison: {
    companyMatch:
      | "EXACT"
      | "NORMALIZED_MATCH"
      | "FUZZY_CANDIDATE"
      | "NO_MATCH";
    startMonthStatus: BusinessMonthStatus;
    startDifferenceMonths: number | null;
    startMessage: string;
    endMonthStatus: BusinessMonthStatus;
    endDifferenceMonths: number | null;
    endMessage: string;
    reviewRequiredFields: string[];
  };
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
  businessResult: VerificationBusinessResult;
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
    if (experience.position) {
      values.push({
        field: `resume.${index}.position`,
        evidence: experience.position,
      });
    }
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

export function formatPaidDuration(
  paidYears: number,
  paidRemainingMonths: number,
) {
  if (paidYears === 0) return `${paidRemainingMonths}个月`;
  if (paidRemainingMonths === 0) return `${paidYears}年`;
  return `${paidYears}年${paidRemainingMonths}个月`;
}

function matchingFieldIssues(
  issues: EvidenceIssue[],
  domain: "resume" | "social",
  index: number,
  aliases: string[],
) {
  const prefixes =
    domain === "resume"
      ? [`experiences.${index}.`, `resume.${index}.`]
      : [`records.${index}.`, `social.${index}.`];
  return issues.filter((issue) => {
    const field = issue.field.toLowerCase();
    return (
      prefixes.some((prefix) => field.includes(prefix.toLowerCase())) &&
      aliases.some((alias) => field.includes(alias.toLowerCase()))
    );
  });
}

function findResumeExperience(
  report: VerificationReportV2,
  sourceItem: Partial<VerificationV2Item>,
): { value: ResumeEvidenceExperience; index: number } | null {
  if (
    sourceItem.rawResumeCompanyName == null &&
    sourceItem.rawSocialSecurityCompanyName == null &&
    report.resumeExtraction.experiences.length === 1
  ) {
    return { value: report.resumeExtraction.experiences[0], index: 0 };
  }
  const candidates = report.resumeExtraction.experiences
    .map((value, index) => ({ value, index }))
    .filter(
      ({ value }) =>
        value.resumeCompany.value === sourceItem.rawResumeCompanyName,
    );
  if (!candidates.length) return null;
  return (
    candidates.find(
      ({ value }) =>
        !sourceItem.resumePeriod ||
        (value.resumeStartMonth.value === sourceItem.resumePeriod.startMonth &&
          value.resumeEndMonth.value === sourceItem.resumePeriod.endMonth),
    ) ?? candidates[0]
  );
}

function findSocialRecord(
  report: VerificationReportV2,
  sourceItem: Partial<VerificationV2Item>,
): { value: SocialSecurityEvidenceRecord; index: number } | null {
  if (
    sourceItem.rawResumeCompanyName == null &&
    sourceItem.rawSocialSecurityCompanyName == null &&
    report.socialSecurityRecords.length === 1
  ) {
    return { value: report.socialSecurityRecords[0], index: 0 };
  }
  const candidates = report.socialSecurityRecords
    .map((value, index) => ({ value, index }))
    .filter(
      ({ value }) =>
        value.companyRaw.value === sourceItem.rawSocialSecurityCompanyName,
    );
  if (!candidates.length) return null;
  return (
    candidates.find(
      ({ value }) =>
        !sourceItem.socialSecurityPeriod ||
        (value.startMonth.value ===
          sourceItem.socialSecurityPeriod.startMonth &&
          value.endMonth.value === sourceItem.socialSecurityPeriod.endMonth),
    ) ?? candidates[0]
  );
}

function dateComparison(input: {
  kind: "start" | "end";
  resumeValue: string | null;
  socialValue: string | null;
  resumeStatus: DisplayEvidenceStatus;
  socialStatus: DisplayEvidenceStatus;
}): {
  status: BusinessMonthStatus;
  differenceMonths: number | null;
  message: string;
} {
  if (
    input.resumeStatus === "MISSING" ||
    input.socialStatus === "MISSING" ||
    !input.resumeValue ||
    !input.socialValue
  ) {
    return {
      status: "MISSING",
      differenceMonths: null,
      message: "缺少可比较的月份。",
    };
  }
  if (
    input.resumeStatus !== "VALIDATED" ||
    input.socialStatus !== "VALIDATED"
  ) {
    return {
      status: "MANUAL_REVIEW_REQUIRED",
      differenceMonths: null,
      message: `${input.kind === "start" ? "开始" : "结束"}时间需人工确认。`,
    };
  }
  const signedDifference =
    monthIndex(input.socialValue) - monthIndex(input.resumeValue);
  const differenceMonths = Math.abs(signedDifference);
  if (signedDifference === 0) {
    return {
      status: "MATCH",
      differenceMonths: 0,
      message: `${input.kind === "start" ? "开始" : "结束"}时间一致。`,
    };
  }
  if (input.kind === "start") {
    return signedDifference > 0
      ? {
          status: "SOCIAL_LATER",
          differenceMonths,
          message: `社保缴纳比简历入职时间晚 ${differenceMonths} 个月。`,
        }
      : {
          status: "SOCIAL_EARLIER",
          differenceMonths,
          message: `社保缴纳比简历入职时间早 ${differenceMonths} 个月。`,
        };
  }
  return signedDifference < 0
    ? {
        status: "SOCIAL_EARLY_END",
        differenceMonths,
        message: `社保比简历工作结束时间早 ${differenceMonths} 个月停止缴纳。`,
      }
    : {
        status: "SOCIAL_LATE_END",
        differenceMonths,
        message: `社保比简历工作结束时间晚 ${differenceMonths} 个月停止缴纳。`,
      };
}

function businessResult(input: {
  report: VerificationReportV2;
  sourceItem: Partial<VerificationV2Item>;
  matchStatus: Phase8MatchStatus;
  derivedFact: DerivedFactsPayload["socialSecurity"][number] | null;
}): VerificationBusinessResult {
  const derivedForDisplay = input.derivedFact as
    | (DerivedFactsPayload["socialSecurity"][number] & {
        paidMonthCount?: number;
        paidYears?: number;
        paidRemainingMonths?: number;
        paidDuration?: string;
        gapMonths?: string[];
      })
    | null;
  const resumeMatch = findResumeExperience(input.report, input.sourceItem);
  const socialMatch = findSocialRecord(input.report, input.sourceItem);
  const resume = resumeMatch?.value;
  const social = socialMatch?.value;
  const resumeStatus = {
    companyRaw: fieldDisplayStatus(
      resume?.resumeCompany,
      resumeMatch
        ? matchingFieldIssues(
            input.report.evidenceIssues,
            "resume",
            resumeMatch.index,
            ["company", "companyRaw"],
          )
        : [],
    ),
    position: resume?.position
      ? fieldDisplayStatus(
          resume.position,
          resumeMatch
            ? matchingFieldIssues(
                input.report.evidenceIssues,
                "resume",
                resumeMatch.index,
                ["position"],
              )
            : [],
        )
      : "MISSING",
    startMonth: fieldDisplayStatus(
      resume?.resumeStartMonth,
      resumeMatch
        ? matchingFieldIssues(
            input.report.evidenceIssues,
            "resume",
            resumeMatch.index,
            ["start", "startMonth"],
          )
        : [],
    ),
    endMonth: fieldDisplayStatus(
      resume?.resumeEndMonth,
      resumeMatch
        ? matchingFieldIssues(
            input.report.evidenceIssues,
            "resume",
            resumeMatch.index,
            ["end", "endMonth"],
          )
        : [],
    ),
  };
  const socialStatus = {
    companyRaw: fieldDisplayStatus(
      social?.companyRaw,
      socialMatch
        ? matchingFieldIssues(
            input.report.evidenceIssues,
            "social",
            socialMatch.index,
            ["company", "companyRaw"],
          )
        : [],
    ),
    startMonth: fieldDisplayStatus(
      social?.startMonth,
      socialMatch
        ? matchingFieldIssues(
            input.report.evidenceIssues,
            "social",
            socialMatch.index,
            ["start", "startMonth"],
          )
        : [],
    ),
    endMonth: fieldDisplayStatus(
      social?.endMonth,
      socialMatch
        ? matchingFieldIssues(
            input.report.evidenceIssues,
            "social",
            socialMatch.index,
            ["end", "endMonth"],
          )
        : [],
    ),
    paidMonths: fieldDisplayStatus(
      social?.paidMonths,
      socialMatch
        ? matchingFieldIssues(
            input.report.evidenceIssues,
            "social",
            socialMatch.index,
            ["paidMonths"],
          )
        : [],
    ),
  };
  const start = dateComparison({
    kind: "start",
    resumeValue: resume?.resumeStartMonth.value ?? null,
    socialValue: social?.startMonth.value ?? null,
    resumeStatus: resumeStatus.startMonth,
    socialStatus: socialStatus.startMonth,
  });
  const end = dateComparison({
    kind: "end",
    resumeValue: resume?.resumeEndMonth.value ?? null,
    socialValue: social?.endMonth.value ?? null,
    resumeStatus: resumeStatus.endMonth,
    socialStatus: socialStatus.endMonth,
  });
  const reviewRequiredFields: string[] = [];
  const addReview = (field: string, status: DisplayEvidenceStatus) => {
    if (status !== "VALIDATED" && !reviewRequiredFields.includes(field)) {
      reviewRequiredFields.push(field);
    }
  };
  if (resume) {
    addReview("resume.companyRaw", resumeStatus.companyRaw);
    addReview("resume.position", resumeStatus.position);
    addReview("resume.startMonth", resumeStatus.startMonth);
    addReview("resume.endMonth", resumeStatus.endMonth);
  }
  if (social) {
    addReview("social.companyRaw", socialStatus.companyRaw);
    addReview("social.startMonth", socialStatus.startMonth);
    addReview("social.endMonth", socialStatus.endMonth);
    addReview("social.paidMonths", socialStatus.paidMonths);
  }
  const paidMonths =
    input.derivedFact?.paidMonths ??
    (input.sourceItem.paidMonths?.length
      ? input.sourceItem.paidMonths
      : (social?.paidMonths.value ?? []));
  const paidMonthCount = social
    ? (derivedForDisplay?.paidMonthCount ?? paidMonths.length)
    : null;
  const paidYears =
    paidMonthCount === null
      ? null
      : (derivedForDisplay?.paidYears ??
        Math.floor(paidMonthCount / 12));
  const paidRemainingMonths =
    paidMonthCount === null
      ? null
      : (derivedForDisplay?.paidRemainingMonths ??
        paidMonthCount % 12);
  const gapMonths = social
    ? [...(derivedForDisplay?.gapMonths ?? input.sourceItem.gapMonths ?? [])]
    : [];
  const scenario =
    input.matchStatus === "MANUAL_REVIEW_REQUIRED" ||
    input.matchStatus === "INSUFFICIENT_EVIDENCE"
      ? "MANUAL_REVIEW_REQUIRED"
      : input.matchStatus === "RESUME_ONLY"
      ? "RESUME_WITHOUT_SOCIAL_RECORD"
      : input.matchStatus === "SOCIAL_SECURITY_ONLY"
        ? "UNDECLARED_SOCIAL_RECORD"
        : resume && social
          ? "MATCHED_RECORDS"
          : "MANUAL_REVIEW_REQUIRED";
  const scenarioMessage =
    scenario === "RESUME_WITHOUT_SOCIAL_RECORD"
      ? "该段简历经历未找到对应社保单位记录。"
      : scenario === "UNDECLARED_SOCIAL_RECORD"
        ? "社保存在简历未体现的缴纳单位。"
        : scenario === "MATCHED_RECORDS"
          ? "已找到可比较的简历经历与社保记录。"
          : "记录关联关系需要人工确认。";
  return {
    scenario,
    scenarioMessage,
    resume: resume
      ? {
          companyRaw: resume.resumeCompany.value,
          position: resume.position?.value ?? null,
          startMonth: resume.resumeStartMonth.value,
          endMonth: resume.resumeEndMonth.value,
          fieldStatus: resumeStatus,
        }
      : null,
    social: social
      ? {
          companyRaw: social.companyRaw.value,
          startMonth: social.startMonth.value,
          endMonth: social.endMonth.value,
          paidMonthCount,
          paidYears,
          paidRemainingMonths,
          paidDuration:
            paidYears === null || paidRemainingMonths === null
              ? null
              : (derivedForDisplay?.paidDuration ??
                formatPaidDuration(paidYears, paidRemainingMonths)),
          gapMonths,
          gapSummary: gapMonths.length
            ? `${gapMonths.length}个月`
            : "无",
        }
      : null,
    comparison: {
      companyMatch:
        input.sourceItem.companyMatchType ??
        (resume?.resumeCompany.value &&
        social?.companyRaw.value &&
        resumeStatus.companyRaw === "VALIDATED" &&
        socialStatus.companyRaw === "VALIDATED" &&
        resume.resumeCompany.value === social.companyRaw.value
          ? "EXACT"
          : "NO_MATCH"),
      startMonthStatus: start.status,
      startDifferenceMonths: start.differenceMonths,
      startMessage: start.message,
      endMonthStatus: end.status,
      endDifferenceMonths: end.differenceMonths,
      endMessage: end.message,
      reviewRequiredFields,
    },
  };
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
      businessResult: businessResult({
        report,
        sourceItem,
        matchStatus,
        derivedFact,
      }),
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
