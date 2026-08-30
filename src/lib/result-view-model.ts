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
import type { SimpleVerificationReport } from "./simple-verification";

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
    statedPaidMonthCount: number | null;
    paidMonthCount: number | null;
    paidYears: number | null;
    paidRemainingMonths: number | null;
    paidDuration: string | null;
    timeSpanMonths: number | null;
    gapMonths: string[];
    gapSummary: string;
    fieldStatus: {
      companyRaw: DisplayEvidenceStatus;
      startMonth: DisplayEvidenceStatus;
      endMonth: DisplayEvidenceStatus;
      paidMonths: DisplayEvidenceStatus;
      statedPaidMonthCount: DisplayEvidenceStatus;
    };
    personalInsurance: boolean;
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

export type RecruiterRowStatus =
  | "PASS"
  | "FAIL"
  | "NEEDS_REVIEW"
  | "RESUME_ONLY"
  | "SOCIAL_ONLY";

export type RecruiterComparisonRow = {
  id: string;
  index: number;
  resumeCompany: string;
  position: string;
  resumePeriod: string;
  socialCompany: string;
  socialPeriod: string;
  companyConsistentLabel: string;
  startDifferenceLabel: string;
  endDifferenceLabel: string;
  rowStatus: RecruiterRowStatus;
  rowStatusLabel: string;
  reason: string;
  paidMonthCount: number | null;
  paidMonthLabel: string;
  personalInsurance: boolean;
  itemText: string;
  socialStandardText: string;
  correctionReference: string;
  hasManualOverride?: boolean;
  verificationBaseline?: string | null;
  endIsPresent?: boolean;
};

export type RecruiterTotals = {
  companyPaidMonthCount: number;
  personalPaidMonthCount: number;
  unknownPaidMonthCount?: number;
  overlapMonthCount?: number;
  actualPaidMonthCount: number;
  salaryEffectiveMonthCount: number;
  actualPaidDuration: string;
  salaryEffectiveDuration: string;
};

export type RecruiterSummary = {
  conclusion: "PASS" | "FAIL" | "NEEDS_REVIEW";
  conclusionLabel: string;
  totalRows: number;
  passCount: number;
  failCount: number;
  reviewCount: number;
  resumeOnlyCount: number;
  socialOnlyCount: number;
  headline: string;
  detailLines: string[];
  fullText: string;
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
      recruiterTable: RecruiterComparisonRow[];
      recruiterTotals: RecruiterTotals;
      recruiterSummary: RecruiterSummary;
      evidenceIssues: EvidenceIssue[];
      monthDetails?: SimpleVerificationReport["monthDetails"];
      monthDetailsText?: string;
      fieldOverrides?: SimpleVerificationReport["fieldOverrides"];
      nameStatus?: SimpleVerificationReport["nameStatus"];
      duplicateNotice?: string | null;
      overallConclusion?: SimpleVerificationReport["overallConclusion"];
      overallConclusionLabel?: string;
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
      ...(record.statedPaidMonthCount
        ? [
            {
              field: `social.${index}.statedPaidMonthCount`,
              evidence: record.statedPaidMonthCount,
            },
          ]
        : []),
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
  const relevantIssues = issues.filter(
    (issue) => issue.code !== "TEMPLATE_UNKNOWN",
  );
  if (
    relevantIssues.some((issue) =>
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
    relevantIssues.some((issue) =>
      ["OCR_CONFIDENCE_LOW", "CELL_CONFIDENCE_LOW"].includes(issue.code),
    )
  ) {
    return "LOW_CONFIDENCE";
  }
  if (
    relevantIssues.some((issue) =>
      ["SOURCE_QUOTE_MISSING", "CELL_EVIDENCE_MISSING"].includes(issue.code),
    )
  ) {
    return "MISSING";
  }
  if (
    relevantIssues.some((issue) =>
      [
        "EXTRACTION_UNSUPPORTED",
        "TRANSFORMATION_UNSUPPORTED",
        "MONTH_DETAIL_UNAVAILABLE",
      ].includes(issue.code),
    )
  ) {
    return "UNSUPPORTED";
  }
  return relevantIssues.length ? "UNCERTAIN" : null;
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

export function formatPaidMonthsAndYears(monthCount: number) {
  return {
    monthCount,
    years: Math.floor(monthCount / 12),
    remainingMonths: monthCount % 12,
    duration: formatPaidDuration(
      Math.floor(monthCount / 12),
      monthCount % 12,
    ),
  };
}

const PERSONAL_INSURANCE_PATTERN = /个人参保|个人缴费|灵活就业|个人缴费窗口/u;
const YEAR_MONTH_PATTERN = /^(?:19|20)\d{2}-(?:0[1-9]|1[0-2])$/;

function displayValue(value: string | null | undefined) {
  return value?.trim() ? value : "—";
}

function periodLabel(
  startMonth: string | null | undefined,
  endMonth: string | null | undefined,
) {
  if (!startMonth && !endMonth) return "—";
  return `${startMonth ?? "待人工确认"} 至 ${endMonth ?? "待人工确认"}`;
}

function uniqueConfirmedMonths(months: string[]) {
  return [
    ...new Set(months.filter((month) => YEAR_MONTH_PATTERN.test(month))),
  ].sort();
}

function isPersonalInsuranceRecord(input: {
  matchStatus: Phase8MatchStatus;
  socialCompany: string | null;
  personalInsurance?: boolean;
}) {
  return (
    input.matchStatus === "PERSONAL_INSURANCE" ||
    input.personalInsurance === true ||
    PERSONAL_INSURANCE_PATTERN.test(input.socialCompany ?? "")
  );
}

function recruiterRowStatus(input: {
  matchStatus: Phase8MatchStatus;
  scenario: VerificationBusinessResult["scenario"];
  companyMatch: VerificationBusinessResult["comparison"]["companyMatch"];
  startStatus: BusinessMonthStatus;
  endStatus: BusinessMonthStatus;
  reviewRequired: boolean;
  personalInsurance: boolean;
}): RecruiterRowStatus {
  if (
    input.matchStatus === "RESUME_ONLY" ||
    input.scenario === "RESUME_WITHOUT_SOCIAL_RECORD"
  ) {
    return "RESUME_ONLY";
  }
  if (
    input.matchStatus === "SOCIAL_SECURITY_ONLY" ||
    input.scenario === "UNDECLARED_SOCIAL_RECORD"
  ) {
    return "SOCIAL_ONLY";
  }
  if (
    input.personalInsurance ||
    input.reviewRequired ||
    input.matchStatus === "MANUAL_REVIEW_REQUIRED" ||
    input.matchStatus === "INSUFFICIENT_EVIDENCE" ||
    input.matchStatus === "MULTIPLE_COMPANIES_SAME_MONTH" ||
    input.companyMatch === "NORMALIZED_MATCH" ||
    input.companyMatch === "FUZZY_CANDIDATE" ||
    input.startStatus === "MANUAL_REVIEW_REQUIRED" ||
    input.endStatus === "MANUAL_REVIEW_REQUIRED"
  ) {
    return "NEEDS_REVIEW";
  }
  if (
    input.companyMatch === "NO_MATCH" ||
    input.startStatus === "SOCIAL_EARLIER" ||
    input.startStatus === "SOCIAL_LATER" ||
    input.endStatus === "SOCIAL_EARLY_END" ||
    input.endStatus === "SOCIAL_LATE_END" ||
    input.matchStatus === "COMPANY_MISMATCH" ||
    input.matchStatus === "START_MONTH_MISMATCH" ||
    input.matchStatus === "END_MONTH_MISMATCH" ||
    input.matchStatus === "PERIOD_MISMATCH" ||
    input.matchStatus === "GAP_DETECTED"
  ) {
    return "FAIL";
  }
  if (
    input.matchStatus === "EXACT_MATCH" &&
    input.companyMatch === "EXACT" &&
    input.startStatus === "MATCH" &&
    input.endStatus === "MATCH"
  ) {
    return "PASS";
  }
  return "NEEDS_REVIEW";
}

const recruiterStatusLabels: Record<RecruiterRowStatus, string> = {
  PASS: "通过",
  FAIL: "不通过",
  NEEDS_REVIEW: "待人工确认",
  RESUME_ONLY: "社保未体现",
  SOCIAL_ONLY: "简历未体现",
};

function companyConsistentLabel(
  rowStatus: RecruiterRowStatus,
  companyMatch: VerificationBusinessResult["comparison"]["companyMatch"],
  resumeCompany: string,
  socialCompany: string,
) {
  if (
    rowStatus === "RESUME_ONLY" ||
    rowStatus === "SOCIAL_ONLY" ||
    resumeCompany === "—" ||
    socialCompany === "—"
  ) {
    return "—";
  }
  if (companyMatch === "EXACT") return "一致";
  if (companyMatch === "NO_MATCH") return "不一致";
  return "待人工确认";
}

function startDifferenceLabel(
  rowStatus: RecruiterRowStatus,
  status: BusinessMonthStatus,
  differenceMonths: number | null,
) {
  if (rowStatus === "RESUME_ONLY" || rowStatus === "SOCIAL_ONLY") return "—";
  if (status === "MATCH") return "一致";
  if (status === "SOCIAL_LATER" && differenceMonths !== null) {
    return `社保晚${differenceMonths}个月`;
  }
  if (status === "SOCIAL_EARLIER" && differenceMonths !== null) {
    return `社保早${differenceMonths}个月`;
  }
  if (status === "MISSING") return "—";
  return "待人工确认";
}

function endDifferenceLabel(
  rowStatus: RecruiterRowStatus,
  status: BusinessMonthStatus,
  differenceMonths: number | null,
) {
  if (rowStatus === "RESUME_ONLY" || rowStatus === "SOCIAL_ONLY") return "—";
  if (status === "MATCH") return "一致";
  if (status === "SOCIAL_EARLY_END" && differenceMonths !== null) {
    return `社保提前结束${differenceMonths}个月`;
  }
  if (status === "SOCIAL_LATE_END" && differenceMonths !== null) {
    return `社保延后${differenceMonths}个月`;
  }
  if (status === "MISSING") return "—";
  return "待人工确认";
}

function recruiterReason(input: {
  rowStatus: RecruiterRowStatus;
  companyMatch: VerificationBusinessResult["comparison"]["companyMatch"];
  startStatus: BusinessMonthStatus;
  endStatus: BusinessMonthStatus;
  startDifferenceMonths: number | null;
  endDifferenceMonths: number | null;
  reviewRequiredFields: string[];
  gapMonths: string[];
  personalInsurance: boolean;
  resumeCompany: string;
  socialCompany: string;
}) {
  if (input.rowStatus === "PASS") {
    return "公司一致，开始时间一致，结束时间一致";
  }
  if (input.rowStatus === "RESUME_ONLY") return "该段简历经历未找到对应社保记录";
  if (input.rowStatus === "SOCIAL_ONLY") return "社保存在简历未体现的缴纳单位";
  if (input.personalInsurance) {
    return "个人参保或灵活就业，不自动计入工作经历和定薪年限";
  }
  const parts: string[] = [];
  if (
    input.companyMatch === "NO_MATCH" &&
    input.resumeCompany !== "—" &&
    input.socialCompany !== "—"
  ) {
    parts.push("公司名称不一致");
  }
  if (input.companyMatch === "NORMALIZED_MATCH" || input.companyMatch === "FUZZY_CANDIDATE") {
    parts.push("公司名称需要人工确认");
  }
  if (input.startStatus === "SOCIAL_LATER" && input.startDifferenceMonths !== null) {
    parts.push(
      `社保开始缴纳时间比简历开始时间晚${input.startDifferenceMonths}个月`,
    );
  } else if (
    input.startStatus === "SOCIAL_EARLIER" &&
    input.startDifferenceMonths !== null
  ) {
    parts.push(
      `社保开始缴纳时间比简历开始时间早${input.startDifferenceMonths}个月`,
    );
  } else if (input.startStatus === "MANUAL_REVIEW_REQUIRED") {
    parts.push("开始时间需要人工确认");
  }
  if (input.endStatus === "SOCIAL_EARLY_END" && input.endDifferenceMonths !== null) {
    parts.push(
      `社保结束缴纳时间比简历结束时间早${input.endDifferenceMonths}个月`,
    );
  } else if (
    input.endStatus === "SOCIAL_LATE_END" &&
    input.endDifferenceMonths !== null
  ) {
    parts.push(
      `社保结束缴纳时间比简历结束时间晚${input.endDifferenceMonths}个月`,
    );
  } else if (input.endStatus === "MANUAL_REVIEW_REQUIRED") {
    parts.push("结束时间需要人工确认");
  }
  if (input.gapMonths.length) {
    parts.push(`存在断缴：${input.gapMonths.join("、")}`);
  }
  if (input.reviewRequiredFields.length && !parts.length) {
    parts.push("部分字段需要人工确认");
  }
  return parts.join("；") || "记录需要人工确认";
}

function confirmedPaidMonths(item: ResultViewItem) {
  if (item.businessResult.social?.paidMonthCount == null) return [];
  const months = uniqueConfirmedMonths(
    item.derivedFact?.paidMonths ?? item.paidMonths,
  );
  return months.length === item.businessResult.social.paidMonthCount
    ? months
    : months;
}

function buildRecruiterRow(
  item: ResultViewItem,
  index: number,
  candidateName: string,
): RecruiterComparisonRow {
  const business = item.businessResult;
  const personalInsurance = isPersonalInsuranceRecord({
    matchStatus: item.matchStatus,
    socialCompany:
      business.social?.companyRaw ?? item.rawSocialSecurityCompanyName,
    personalInsurance: business.social?.personalInsurance,
  });
  const comparisonReviewFields = business.comparison.reviewRequiredFields.filter(
    (field) =>
      ![
        "resume.position",
        "social.paidMonths",
        "social.statedPaidMonthCount",
      ].includes(field),
  );
  const rowStatus = recruiterRowStatus({
    matchStatus: item.matchStatus,
    scenario: business.scenario,
    companyMatch: business.comparison.companyMatch,
    startStatus: business.comparison.startMonthStatus,
    endStatus: business.comparison.endMonthStatus,
    reviewRequired: comparisonReviewFields.length > 0,
    personalInsurance,
  });
  const resumeCompany = displayValue(
    business.resume?.companyRaw ?? item.rawResumeCompanyName,
  );
  const socialCompany = displayValue(
    business.social?.companyRaw ?? item.rawSocialSecurityCompanyName,
  );
  const position = displayValue(business.resume?.position);
  const resumePeriod = periodLabel(
    business.resume?.startMonth ?? item.resumePeriod?.startMonth,
    business.resume?.endMonth ?? item.resumePeriod?.endMonth,
  );
  const socialPeriod = periodLabel(
    business.social?.startMonth ?? item.socialSecurityPeriod?.startMonth,
    business.social?.endMonth ?? item.socialSecurityPeriod?.endMonth,
  );
  const paidMonths = confirmedPaidMonths(item);
  const paidMonthCount =
    business.social?.paidMonthCount ??
    (paidMonths.length ? paidMonths.length : null);
  const reason = recruiterReason({
    rowStatus,
    companyMatch: business.comparison.companyMatch,
    startStatus: business.comparison.startMonthStatus,
    endStatus: business.comparison.endMonthStatus,
    startDifferenceMonths: business.comparison.startDifferenceMonths,
    endDifferenceMonths: business.comparison.endDifferenceMonths,
    reviewRequiredFields: business.comparison.reviewRequiredFields,
    gapMonths: business.social?.gapMonths ?? item.gapMonths,
    personalInsurance,
    resumeCompany,
    socialCompany,
  });
  const socialStart =
    business.social?.startMonth ?? item.socialSecurityPeriod?.startMonth;
  const socialEnd =
    business.social?.endMonth ?? item.socialSecurityPeriod?.endMonth;
  const socialCompanyKnown = socialCompany !== "—";
  const correctionReference =
    rowStatus === "RESUME_ONLY" || !socialCompanyKnown
      ? "待人工确认"
      : [
          socialCompany,
          position === "—" ? "待人工确认" : position,
          socialStart && socialEnd
            ? `${socialStart} 至 ${socialEnd}`
            : "待人工确认",
        ].join("\n");
  const socialStandardText = socialCompanyKnown
    ? [
        `社保公司：${socialCompany}`,
        `社保时间：${socialPeriod}`,
        `实际缴纳：${paidMonthCount === null ? "无法从材料确定" : `${paidMonthCount}个月`}`,
      ].join("\n")
    : "待人工确认";
  const itemText = [
    `候选人：${candidateName}`,
    `简历：${resumeCompany}`,
    `职位：${position}`,
    `简历时间：${resumePeriod}`,
    `社保：${socialCompany}`,
    `社保时间：${socialPeriod}`,
    `公司是否一致：${companyConsistentLabel(rowStatus, business.comparison.companyMatch, resumeCompany, socialCompany)}`,
    `开始月份差：${startDifferenceLabel(rowStatus, business.comparison.startMonthStatus, business.comparison.startDifferenceMonths)}`,
    `结束月份差：${endDifferenceLabel(rowStatus, business.comparison.endMonthStatus, business.comparison.endDifferenceMonths)}`,
    `结果：${recruiterStatusLabels[rowStatus]}`,
    `原因：${reason}`,
    `实际社保月数：${paidMonthCount === null ? "无法从材料确定" : `${paidMonthCount}个月`}`,
  ].join("\n");
  return {
    id: item.id,
    index: index + 1,
    resumeCompany,
    position,
    resumePeriod,
    socialCompany,
    socialPeriod,
    companyConsistentLabel: companyConsistentLabel(
      rowStatus,
      business.comparison.companyMatch,
      resumeCompany,
      socialCompany,
    ),
    startDifferenceLabel: startDifferenceLabel(
      rowStatus,
      business.comparison.startMonthStatus,
      business.comparison.startDifferenceMonths,
    ),
    endDifferenceLabel: endDifferenceLabel(
      rowStatus,
      business.comparison.endMonthStatus,
      business.comparison.endDifferenceMonths,
    ),
    rowStatus,
    rowStatusLabel: recruiterStatusLabels[rowStatus],
    reason,
    paidMonthCount,
    paidMonthLabel:
      paidMonthCount === null ? "无法从材料确定" : `${paidMonthCount}个月`,
    personalInsurance,
    itemText,
    socialStandardText,
    correctionReference,
  };
}

export function buildRecruiterTotals(items: ResultViewItem[]): RecruiterTotals {
  const companyMonths = new Set<string>();
  const personalMonths = new Set<string>();
  for (const item of items) {
    const months = confirmedPaidMonths(item);
    const personal = isPersonalInsuranceRecord({
      matchStatus: item.matchStatus,
      socialCompany:
        item.businessResult.social?.companyRaw ??
        item.rawSocialSecurityCompanyName,
      personalInsurance: item.businessResult.social?.personalInsurance,
    });
    for (const month of months) {
      if (personal) personalMonths.add(month);
      else companyMonths.add(month);
    }
  }
  const actualMonths = new Set([...companyMonths, ...personalMonths]);
  const actual = formatPaidMonthsAndYears(actualMonths.size);
  const salary = formatPaidMonthsAndYears(companyMonths.size);
  return {
    companyPaidMonthCount: companyMonths.size,
    personalPaidMonthCount: personalMonths.size,
    actualPaidMonthCount: actualMonths.size,
    salaryEffectiveMonthCount: companyMonths.size,
    actualPaidDuration: actual.duration,
    salaryEffectiveDuration: salary.duration,
  };
}

export function buildRecruiterSummary(input: {
  candidateName: string;
  rows: RecruiterComparisonRow[];
  totals: RecruiterTotals;
}): RecruiterSummary {
  const passCount = input.rows.filter((row) => row.rowStatus === "PASS").length;
  const failCount = input.rows.filter((row) => row.rowStatus === "FAIL").length;
  const reviewCount = input.rows.filter((row) => row.rowStatus === "NEEDS_REVIEW").length;
  const resumeOnlyCount = input.rows.filter((row) => row.rowStatus === "RESUME_ONLY").length;
  const socialOnlyCount = input.rows.filter((row) => row.rowStatus === "SOCIAL_ONLY").length;
  const conclusion =
    failCount > 0 || resumeOnlyCount > 0 || socialOnlyCount > 0
      ? "FAIL"
      : reviewCount > 0 || input.rows.length === 0
        ? "NEEDS_REVIEW"
        : "PASS";
  const conclusionLabel =
    conclusion === "PASS" ? "通过" : conclusion === "FAIL" ? "不通过" : "待人工确认";
  const detailLines = [
    `共核验${input.rows.length}段记录：`,
    `${passCount}段一致`,
    `${failCount}段不通过`,
    `${resumeOnlyCount}段社保未体现`,
    `${socialOnlyCount}段简历未体现`,
    `${reviewCount}段待人工确认`,
  ];
  const headline = `整体结论：${conclusionLabel}`;
  const fullText = [
    `候选人：${input.candidateName}`,
    headline,
    ...detailLines,
    "",
    `实际缴费：${input.totals.actualPaidMonthCount}个月`,
    `折算年限：${input.totals.actualPaidDuration}`,
    `公司缴纳：${input.totals.companyPaidMonthCount}个月`,
    `个人缴纳：${input.totals.personalPaidMonthCount}个月`,
    `定薪有效缴纳：${input.totals.salaryEffectiveMonthCount}个月`,
    ...input.rows.flatMap((row) => ["", `${row.index}.`, row.itemText]),
  ].join("\n");
  return {
    conclusion,
    conclusionLabel,
    totalRows: input.rows.length,
    passCount,
    failCount,
    reviewCount,
    resumeOnlyCount,
    socialOnlyCount,
    headline,
    detailLines,
    fullText,
  };
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

function issuesForFlattenedField(
  issues: EvidenceIssue[],
  flattenedField: string | undefined,
) {
  const match = flattenedField?.match(/^(resume|social)\.(\d+)\.(.+)$/);
  if (!match) {
    return flattenedField === "candidateName"
      ? issues.filter((issue) => issue.field === "candidateName")
      : [];
  }
  const [, domain, index, field] = match;
  return matchingFieldIssues(
    issues,
    domain as "resume" | "social",
    Number(index),
    [field],
  );
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
    statedPaidMonthCount: social?.statedPaidMonthCount
      ? fieldDisplayStatus(
          social.statedPaidMonthCount,
          socialMatch
            ? matchingFieldIssues(
                input.report.evidenceIssues,
                "social",
                socialMatch.index,
                ["statedPaidMonthCount"],
              )
            : [],
        )
      : "MISSING" as const,
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
    ? (derivedForDisplay?.paidMonthCount ??
      (social.paidMonths.value === null ? null : paidMonths.length))
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
  const timeSpanMonths =
    social?.startMonth.value && social.endMonth.value
      ? monthIndex(social.endMonth.value) -
        monthIndex(social.startMonth.value) +
        1
      : null;
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
          statedPaidMonthCount:
            social.statedPaidMonthCount?.value ?? null,
          paidMonthCount,
          paidYears,
          paidRemainingMonths,
          paidDuration:
            paidYears === null || paidRemainingMonths === null
              ? null
              : (derivedForDisplay?.paidDuration ??
                formatPaidDuration(paidYears, paidRemainingMonths)),
          timeSpanMonths,
          gapMonths,
          gapSummary: gapMonths.length
            ? `${gapMonths.length}个月`
            : "无",
          fieldStatus: socialStatus,
          personalInsurance:
            social.personalInsurance ||
            PERSONAL_INSURANCE_PATTERN.test(social.companyRaw.value ?? ""),
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
  if (
    item.warnings.some((warning) =>
      ["OCR_CONFIDENCE_LOW", "CELL_CONFIDENCE_LOW"].includes(warning),
    )
  )
    add("OCR 低置信度");
  if (item.warnings.includes("EXTRACTION_CONFLICT")) add("PDF / OCR 冲突");
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

function buildSimpleResultViewModel(
  report: SimpleVerificationReport,
  humanReview: HumanReview,
): ResultViewModel {
  const conclusion =
    report.recruiterSummary.conclusion === "PASS"
      ? "CONSISTENT"
      : report.recruiterSummary.conclusion === "FAIL"
        ? "INCONSISTENT"
        : "MANUAL_REVIEW_REQUIRED";
  const items: ResultViewItem[] = report.rows.map((row, index) => ({
    id: `simple-${index}`,
    matchStatus:
      row.status === "PASS"
        ? "EXACT_MATCH"
        : row.status === "FAIL"
          ? row.companyConsistent === false
            ? "COMPANY_MISMATCH"
            : "PERIOD_MISMATCH"
          : row.status === "RESUME_ONLY"
            ? "RESUME_ONLY"
            : row.status === "SOCIAL_ONLY"
              ? "SOCIAL_SECURITY_ONLY"
              : "MANUAL_REVIEW_REQUIRED",
    statusLabel: report.recruiterTable[index]?.rowStatusLabel ?? row.status,
    companyMatchType:
      row.companyConsistent === true
        ? "EXACT"
        : row.companyConsistent === false
          ? "NO_MATCH"
          : null,
    companyMatchLabel:
      row.companyConsistent === true
        ? "原文一致"
        : row.companyConsistent === false
          ? "公司不一致"
          : "无可比较公司",
    rawResumeCompanyName: row.resume?.companyRaw ?? null,
    rawSocialSecurityCompanyName: row.social?.companyRaw ?? null,
    normalizedCompanyName: null,
    resumePeriod:
      row.resume?.startMonth && row.resume.endMonth
        ? { startMonth: row.resume.startMonth, endMonth: row.resume.endMonth }
        : null,
    socialSecurityPeriod:
      row.social?.startMonth && row.social.endMonth
        ? { startMonth: row.social.startMonth, endMonth: row.social.endMonth }
        : null,
    paidMonths: row.social?.paidMonths ?? [],
    missingMonths: [],
    extraMonths: [],
    gapMonths: [],
    warnings: [],
    specialLabels: [],
    confidence: 1,
    requiresManualReview: row.status !== "PASS",
    description: row.reason,
    rules: ["公司主体一致且起止月份差为 0 才可自动通过"],
    evidence: [],
    derivedFact: null,
    businessResult: {
      scenario:
        row.status === "RESUME_ONLY"
          ? "RESUME_WITHOUT_SOCIAL_RECORD"
          : row.status === "SOCIAL_ONLY"
            ? "UNDECLARED_SOCIAL_RECORD"
            : "MATCHED_RECORDS",
      scenarioMessage: row.reason,
      resume: row.resume
        ? {
            companyRaw: row.resume.companyRaw,
            position: row.resume.position,
            startMonth: row.resume.startMonth,
            endMonth: row.resume.endMonth,
            fieldStatus: {
              companyRaw: row.resume.companyRaw ? "VALIDATED" : "MISSING",
              position: row.resume.position ? "VALIDATED" : "MISSING",
              startMonth: row.resume.startMonth ? "VALIDATED" : "MISSING",
              endMonth: row.resume.endMonth ? "VALIDATED" : "MISSING",
            },
          }
        : null,
      social: row.social
        ? {
            companyRaw: row.social.companyRaw,
            startMonth: row.social.startMonth,
            endMonth: row.social.endMonth,
            statedPaidMonthCount: null,
            paidMonthCount: row.social.paidMonths.length || null,
            paidYears: null,
            paidRemainingMonths: null,
            paidDuration: null,
            timeSpanMonths: null,
            gapMonths: [],
            gapSummary: "",
            fieldStatus: {
              companyRaw: row.social.companyRaw ? "VALIDATED" : "MISSING",
              startMonth: row.social.startMonth ? "VALIDATED" : "MISSING",
              endMonth: row.social.endMonth ? "VALIDATED" : "MISSING",
              paidMonths: row.social.paidMonths.length ? "VALIDATED" : "MISSING",
              statedPaidMonthCount: "MISSING",
            },
            personalInsurance: row.social.paymentType === "personal",
          }
        : null,
      comparison: {
        companyMatch:
          row.companyConsistent === true
            ? "EXACT"
            : row.companyConsistent === false
              ? "NO_MATCH"
              : "FUZZY_CANDIDATE",
        startMonthStatus: "MATCH",
        startDifferenceMonths: row.startMonthDifference,
        startMessage: "",
        endMonthStatus: "MATCH",
        endDifferenceMonths: row.endMonthDifference,
        endMessage: "",
        reviewRequiredFields: [],
      },
    },
  }));
  return {
    schemaVersion: 3,
    legacy: false,
    candidateName: report.candidateName,
    verifiedAt: report.verifiedAt,
    machineResult: {
      conclusion,
      label: conclusionLabels[conclusion],
    },
    trustStatus: { code: "EVIDENCE_COMPLETE", label: "字段按自身取值展示" },
    humanReview,
    summary: {
      resumeExperienceCount: report.experiences.length,
      socialSecurityCompanyCount: report.socialRecords.length,
      exactMatchCount: report.recruiterSummary.passCount,
      anomalyCount: report.recruiterSummary.failCount,
      manualReviewCount: report.recruiterSummary.reviewCount,
      conclusion:
        report.recruiterSummary.conclusion === "PASS" ? "核验通过" : "建议人工复核",
      concerns: report.recruiterTable
        .filter((row) => row.rowStatus !== "PASS")
        .map((row) => row.reason),
    },
    items,
    recruiterTable: report.recruiterTable,
    recruiterTotals: report.recruiterTotals,
    recruiterSummary: report.recruiterSummary,
    evidenceIssues: [],
    monthDetails: report.monthDetails,
    monthDetailsText: report.monthDetailsText,
    fieldOverrides: report.fieldOverrides,
    nameStatus: report.nameStatus,
    duplicateNotice: report.duplicateNotice,
    overallConclusion: report.overallConclusion,
    overallConclusionLabel: report.overallConclusionLabel,
  };
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
    input.result &&
    typeof input.result === "object" &&
    "schemaVersion" in input.result &&
    (input.result.schemaVersion === 4 || input.result.schemaVersion === 5)
  ) {
    return buildSimpleResultViewModel(
      input.result as SimpleVerificationReport,
      input.humanReview,
    );
  }
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
      const matchingIssues = issuesForFlattenedField(
        report.evidenceIssues,
        matched?.field,
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
  const recruiterTable = items.map((item, index) =>
    buildRecruiterRow(item, index, report.candidateName),
  );
  const recruiterTotals = buildRecruiterTotals(items);
  const recruiterSummary = buildRecruiterSummary({
    candidateName: report.candidateName,
    rows: recruiterTable,
    totals: recruiterTotals,
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
    recruiterTable,
    recruiterTotals,
    recruiterSummary,
    evidenceIssues: report.evidenceIssues,
  };
}
