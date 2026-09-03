import { monthIndex } from "./schemas";
import { inclusiveMonthRange } from "./social-security-evidence";
import { isUnitCode } from "./company-cleanup";
import { sourceLabel } from "./page-evidence";
import type {
  RecruiterComparisonRow,
  RecruiterRowStatus,
  RecruiterSummary,
  RecruiterTotals,
} from "./result-view-model";

export type FieldEvidenceView = {
  label: string;
  sourceLabel: string;
  pageNumber: number | null;
  quote: string;
  conflict: boolean;
  alternatives?: Array<{
    sourceLabel: string;
    pageNumber: number | null;
    quote: string;
  }>;
};

export type ResumeExperience = {
  sourceId?: string;
  companyRaw: string | null;
  position: string | null;
  startMonth: string | null;
  endMonth: string | null;
  endMonthRaw?: string | null;
  endIsPresent?: boolean;
  sourcePage?: number | null;
  sourceQuote?: string | null;
  sourceKind?: "native_text" | "general_ocr" | "manual" | "hybrid";
};

export type SocialRecord = {
  sourceId?: string;
  companyRaw: string | null;
  companyNormalized?: string;
  unitCode?: string | null;
  mappingStatus?: "mapped" | "needs_review" | "missing";
  startMonth: string | null;
  endMonth: string | null;
  paidMonths: string[];
  paymentType: "company" | "personal" | "unknown";
  statedPaidMonthCount?: number | null;
  sourceFile?: string;
  sourcePage?: number;
  sourceQuote?: string;
};

export type SimpleComparisonRow = {
  resume: ResumeExperience | null;
  social: SocialRecord | null;
  companyConsistent: boolean | null;
  startMonthDifference: number | null;
  endMonthDifference: number | null;
  status: RecruiterRowStatus;
  reason: string;
  verificationBaseline?: string | null;
  hasManualOverride?: boolean;
};

export type OverallConclusion = "PASS" | "FAIL" | "NEEDS_REVIEW";

export type SimpleVerificationReport = {
  schemaVersion: 4 | 5 | 6;
  pipeline: "simple-v2" | "simple-v5" | "simple-v6";
  candidateName: string;
  verifiedAt: string;
  experiences: ResumeExperience[];
  socialRecords: SocialRecord[];
  rows: SimpleComparisonRow[];
  recruiterTable: RecruiterComparisonRow[];
  recruiterTotals: RecruiterTotals;
  recruiterSummary: RecruiterSummary;
  overallConclusion: OverallConclusion;
  overallConclusionLabel: string;
  resumeName?: string | null;
  socialName?: string | null;
  nameStatus?: "match" | "mismatch" | "unknown";
  duplicateNotice?: string | null;
  monthDetails?: Array<{
    month: string;
    unitCode: string | null;
    companyRaw: string | null;
    paymentType: SocialRecord["paymentType"];
    sourceFile?: string;
    sourcePage?: number;
    origin: "system" | "manual";
  }>;
  monthDetailsText?: string;
  fieldOverrides?: Array<Record<string, unknown>>;
  overrides?: Array<Record<string, unknown>>;
  sourceConflicts?: Array<{
    field: "company" | "name" | "position" | "month";
    nativeValues: string[];
    ocrValues: string[];
    pageNumber?: number;
    sourceFile?: string;
  }>;
  hasUnconfirmedFields?: boolean;
  systemExtracted?: {
    candidateName: string;
    experiences: ResumeExperience[];
    socialRecords: SocialRecord[];
    socialName: string | null;
    duplicateNotice: string | null;
  };
};

const PERSONAL_PATTERN = /个人参保|个人缴费|灵活就业|个人缴费窗口/u;
const YEAR_MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export function normalizeCompanySubject(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFKC")
    .replace(/\s+/gu, " ")
    .trim();
}

export function companiesMatch(
  left: string | null | undefined,
  right: string | null | undefined,
): boolean | null {
  const a = normalizeCompanySubject(left);
  const b = normalizeCompanySubject(right);
  if (!a || !b) return null;
  return a === b;
}

export function monthDifference(
  socialMonth: string | null | undefined,
  resumeMonth: string | null | undefined,
): number | null {
  if (!socialMonth || !resumeMonth) return null;
  if (!YEAR_MONTH.test(socialMonth) || !YEAR_MONTH.test(resumeMonth)) return null;
  return monthIndex(socialMonth) - monthIndex(resumeMonth);
}

export function uniquePaidMonths(months: string[]): string[] {
  return [...new Set(months.filter((month) => YEAR_MONTH.test(month)))].sort(
    (left, right) => monthIndex(left) - monthIndex(right),
  );
}

export function inferPaymentType(
  companyRaw: string | null | undefined,
  explicit?: "company" | "personal" | "unknown",
): "company" | "personal" | "unknown" {
  if (explicit === "personal" || explicit === "company" || explicit === "unknown") {
    return explicit;
  }
  if (PERSONAL_PATTERN.test(companyRaw ?? "")) return "personal";
  if (isUnitCode(companyRaw)) return "unknown";
  return companyRaw?.trim() ? "company" : "unknown";
}

function periodDistance(resume: ResumeExperience, social: SocialRecord): number {
  const start = monthDifference(social.startMonth, resume.startMonth);
  const end = monthDifference(social.endMonth, resume.endMonth);
  if (start === null && end === null) return Number.POSITIVE_INFINITY;
  return Math.abs(start ?? 0) + Math.abs(end ?? 0);
}

function classifyRow(
  resume: ResumeExperience | null,
  social: SocialRecord | null,
): Pick<
  SimpleComparisonRow,
  | "companyConsistent"
  | "startMonthDifference"
  | "endMonthDifference"
  | "status"
  | "reason"
> {
  if (resume && !social) {
    return {
      companyConsistent: null,
      startMonthDifference: null,
      endMonthDifference: null,
      status: "RESUME_ONLY",
      reason: "该段简历经历未找到对应社保记录",
    };
  }
  if (social && !resume) {
    const personal = inferPaymentType(social.companyRaw, social.paymentType) === "personal";
    return {
      companyConsistent: null,
      startMonthDifference: null,
      endMonthDifference: null,
      status: "SOCIAL_ONLY",
      reason: personal
        ? "个人参保或灵活就业，简历未体现该缴纳记录"
        : "社保存在简历未体现的缴纳单位",
    };
  }
  if (!resume || !social) {
    return {
      companyConsistent: null,
      startMonthDifference: null,
      endMonthDifference: null,
      status: "NEEDS_REVIEW",
      reason: "记录需要人工确认",
    };
  }

  const companyConsistent = companiesMatch(resume.companyRaw, social.companyRaw);
  const startMonthDifference = monthDifference(social.startMonth, resume.startMonth);
  const endMonthDifference = monthDifference(social.endMonth, resume.endMonth);
  const paymentType = inferPaymentType(social.companyRaw, social.paymentType);
  const personal = paymentType === "personal";
  const missingCompany = companyConsistent === null;
  const missingStart = !resume.startMonth || !social.startMonth;
  const missingEnd = !resume.endMonth || !social.endMonth;
  const mappingUncertain = social.mappingStatus === "needs_review";

  if (personal) {
    return {
      companyConsistent,
      startMonthDifference,
      endMonthDifference,
      status: "NEEDS_REVIEW",
      reason: "个人参保或灵活就业，不自动计入工作经历和定薪年限",
    };
  }
  if (paymentType === "unknown" || mappingUncertain) {
    return {
      companyConsistent,
      startMonthDifference,
      endMonthDifference,
      status: "NEEDS_REVIEW",
      reason:
        paymentType === "unknown"
          ? "缴费类型待确认"
          : "单位编号对应公司待人工确认",
    };
  }
  if (missingCompany || missingStart || missingEnd) {
    return {
      companyConsistent,
      startMonthDifference,
      endMonthDifference,
      status: "NEEDS_REVIEW",
      reason: "部分字段需要人工确认",
    };
  }
  if (
    companyConsistent === true &&
    startMonthDifference === 0 &&
    endMonthDifference === 0
  ) {
    return {
      companyConsistent,
      startMonthDifference,
      endMonthDifference,
      status: "PASS",
      reason: "公司一致，开始时间一致，结束时间一致",
    };
  }

  const parts: string[] = [];
  if (companyConsistent === false) parts.push("公司名称不一致");
  if (startMonthDifference !== null && startMonthDifference > 0) {
    parts.push(`社保开始缴纳时间比简历开始时间晚${startMonthDifference}个月`);
  } else if (startMonthDifference !== null && startMonthDifference < 0) {
    parts.push(
      `社保开始缴纳时间比简历开始时间早${Math.abs(startMonthDifference)}个月`,
    );
  }
  if (endMonthDifference !== null && endMonthDifference < 0) {
    parts.push(
      `社保结束缴纳时间比简历结束时间早${Math.abs(endMonthDifference)}个月`,
    );
  } else if (endMonthDifference !== null && endMonthDifference > 0) {
    parts.push(`社保结束缴纳时间比简历结束时间晚${endMonthDifference}个月`);
  }
  return {
    companyConsistent,
    startMonthDifference,
    endMonthDifference,
    status: "FAIL",
    reason: parts.join("；") || "记录不通过",
  };
}

function exactPeriodMatch(resume: ResumeExperience, social: SocialRecord): boolean {
  return Boolean(
    resume.startMonth &&
      resume.endMonth &&
      social.startMonth &&
      social.endMonth &&
      resume.startMonth === social.startMonth &&
      resume.endMonth === social.endMonth,
  );
}

export function pairResumeAndSocial(
  experiences: ResumeExperience[],
  socialRecords: SocialRecord[],
): SimpleComparisonRow[] {
  const usedSocial = new Set<number>();
  const usedResume = new Set<number>();
  const ambiguousSocial = new Set<number>();
  const rows: SimpleComparisonRow[] = [];

  const unused = (index: number) => !usedSocial.has(index) && !ambiguousSocial.has(index);

  for (const [resumeIndex, resume] of experiences.entries()) {
    const companyCandidates = socialRecords
      .map((social, index) => ({ social, index }))
      .filter(
        ({ social, index }) =>
          unused(index) && companiesMatch(resume.companyRaw, social.companyRaw) === true,
      )
      .sort(
        (left, right) =>
          periodDistance(resume, left.social) - periodDistance(resume, right.social),
      );
    if (companyCandidates.length > 1) {
      usedResume.add(resumeIndex);
      for (const candidate of companyCandidates) ambiguousSocial.add(candidate.index);
      rows.push({
        resume,
        social: null,
        companyConsistent: null,
        startMonthDifference: null,
        endMonthDifference: null,
        status: "NEEDS_REVIEW",
        reason: "多个社保记录可能对应同一段经历，待人工确认",
      });
      continue;
    }
    if (companyCandidates.length === 1) {
      usedResume.add(resumeIndex);
      usedSocial.add(companyCandidates[0].index);
      rows.push({
        resume,
        social: companyCandidates[0].social,
        ...classifyRow(resume, companyCandidates[0].social),
      });
    }
  }

  for (const [resumeIndex, resume] of experiences.entries()) {
    if (usedResume.has(resumeIndex)) continue;
    const dateCandidates = socialRecords
      .map((social, index) => ({ social, index }))
      .filter(({ social, index }) => unused(index) && exactPeriodMatch(resume, social));
    if (dateCandidates.length > 1) {
      usedResume.add(resumeIndex);
      for (const candidate of dateCandidates) ambiguousSocial.add(candidate.index);
      rows.push({
        resume,
        social: null,
        companyConsistent: null,
        startMonthDifference: null,
        endMonthDifference: null,
        status: "NEEDS_REVIEW",
        reason: "起止月份一致但存在多个对应记录，待人工确认",
      });
      continue;
    }
    if (dateCandidates.length === 1) {
      usedResume.add(resumeIndex);
      usedSocial.add(dateCandidates[0].index);
      rows.push({
        resume,
        social: dateCandidates[0].social,
        ...classifyRow(resume, dateCandidates[0].social),
      });
      continue;
    }
    usedResume.add(resumeIndex);
    rows.push({ resume, social: null, ...classifyRow(resume, null) });
  }

  for (const [index, social] of socialRecords.entries()) {
    if (usedSocial.has(index)) continue;
    if (ambiguousSocial.has(index)) {
      rows.push({
        resume: null,
        social,
        companyConsistent: null,
        startMonthDifference: null,
        endMonthDifference: null,
        status: "NEEDS_REVIEW",
        reason: "配对存在歧义，待人工确认",
      });
      continue;
    }
    rows.push({ resume: null, social, ...classifyRow(null, social) });
  }
  return rows;
}

function display(value: string | null | undefined) {
  return value?.trim() ? value : "—";
}

function periodLabel(
  start: string | null | undefined,
  end: string | null | undefined,
  endIsPresent?: boolean,
) {
  if (endIsPresent) {
    return `${start ?? "待人工确认"} 至 至今`;
  }
  if (!start && !end) return "—";
  return `${start ?? "待人工确认"} 至 ${end ?? "待人工确认"}`;
}

function startDifferenceLabel(row: SimpleComparisonRow) {
  if (row.status === "RESUME_ONLY" || row.status === "SOCIAL_ONLY") return "—";
  if (row.startMonthDifference === 0) return "一致";
  if (row.startMonthDifference === null) return "待人工确认";
  return row.startMonthDifference > 0
    ? `社保晚${row.startMonthDifference}个月`
    : `社保早${Math.abs(row.startMonthDifference)}个月`;
}

function endDifferenceLabel(row: SimpleComparisonRow) {
  if (row.status === "RESUME_ONLY" || row.status === "SOCIAL_ONLY") return "—";
  if (row.endMonthDifference === 0) return "一致";
  if (row.endMonthDifference === null) return "待人工确认";
  return row.endMonthDifference < 0
    ? `社保提前结束${Math.abs(row.endMonthDifference)}个月`
    : `社保延后${row.endMonthDifference}个月`;
}

const statusLabels: Record<RecruiterRowStatus, string> = {
  PASS: "通过",
  FAIL: "不通过",
  NEEDS_REVIEW: "待人工确认",
  RESUME_ONLY: "社保未体现",
  SOCIAL_ONLY: "简历未体现",
};

function snippet(value: string | null | undefined) {
  const text = (value ?? "").replace(/\s+/gu, " ").trim();
  if (!text) return "待人工确认";
  return text.length > 80 ? `${text.slice(0, 80)}…` : text;
}

function buildFieldEvidence(
  row: SimpleComparisonRow,
  sourceConflicts: SimpleVerificationReport["sourceConflicts"] | undefined,
  overrides: Array<Record<string, unknown>> | undefined,
): Record<string, FieldEvidenceView> {
  const related = (sourceConflicts ?? []).filter((conflict) => {
    const values = [...conflict.nativeValues, ...conflict.ocrValues];
    return (
      (row.resume?.companyRaw && values.includes(row.resume.companyRaw)) ||
      (row.social?.companyRaw && values.includes(row.social.companyRaw)) ||
      (row.resume?.startMonth && values.some((value) => value.includes(row.resume!.startMonth!))) ||
      (row.resume?.endMonth && values.some((value) => value.includes(row.resume!.endMonth!)))
    );
  });
  const overrideFor = (field: string) =>
    (overrides ?? []).find(
      (entry) =>
        entry.reviewStatus === "applied" &&
        entry.field === field &&
        (entry.targetId === row.resume?.sourceId ||
          entry.targetId === row.social?.sourceId ||
          entry.rowIndex === undefined),
    );
  const resumeSource = row.hasManualOverride && overrideFor("resumeCompany")
    ? "manual"
    : row.resume?.sourceKind ?? "hybrid";
  const companyConflict = related.some((item) => item.field === "company");
  const monthConflict = related.some((item) => item.field === "month");
  const nameConflict = related.some((item) => item.field === "name");
  const positionConflict = related.some((item) => item.field === "position");
  const companyConflictItem = related.find((item) => item.field === "company");
  const monthConflictItem = related.find((item) => item.field === "month");
  return {
    resumeCompany: {
      label: "简历公司",
      sourceLabel: sourceLabel(resumeSource),
      pageNumber: row.resume?.sourcePage ?? null,
      quote: snippet(row.resume?.sourceQuote ?? row.resume?.companyRaw),
      conflict: companyConflict,
      alternatives: companyConflictItem
        ? [
            {
              sourceLabel: "原生文字",
              pageNumber: companyConflictItem.pageNumber ?? row.resume?.sourcePage ?? null,
              quote: snippet(companyConflictItem.nativeValues.join("；")),
            },
            {
              sourceLabel: "General OCR",
              pageNumber: companyConflictItem.pageNumber ?? null,
              quote: snippet(companyConflictItem.ocrValues.join("；")),
            },
          ]
        : undefined,
    },
    socialCompany: {
      label: "社保公司",
      sourceLabel: row.social?.sourcePage ? "Table OCR / General OCR" : "待确认",
      pageNumber: row.social?.sourcePage ?? null,
      quote: snippet(row.social?.sourceQuote ?? row.social?.companyRaw),
      conflict: companyConflict,
    },
    position: {
      label: "职位",
      sourceLabel: sourceLabel(resumeSource),
      pageNumber: row.resume?.sourcePage ?? null,
      quote: snippet(row.resume?.position),
      conflict: positionConflict,
    },
    startMonth: {
      label: "开始月份",
      sourceLabel: sourceLabel(resumeSource),
      pageNumber: row.resume?.sourcePage ?? null,
      quote: snippet(row.resume?.startMonth),
      conflict: monthConflict,
      alternatives: monthConflictItem
        ? [
            {
              sourceLabel: "原生文字",
              pageNumber: monthConflictItem.pageNumber ?? null,
              quote: snippet(monthConflictItem.nativeValues.join("；")),
            },
            {
              sourceLabel: "General OCR",
              pageNumber: monthConflictItem.pageNumber ?? null,
              quote: snippet(monthConflictItem.ocrValues.join("；")),
            },
          ]
        : undefined,
    },
    endMonth: {
      label: "结束月份",
      sourceLabel: sourceLabel(resumeSource),
      pageNumber: row.resume?.sourcePage ?? null,
      quote: snippet(row.resume?.endMonth),
      conflict: monthConflict,
    },
    candidateName: {
      label: "姓名",
      sourceLabel: sourceLabel(resumeSource),
      pageNumber: row.resume?.sourcePage ?? null,
      quote: snippet(row.resume?.sourceQuote),
      conflict: nameConflict,
    },
  };
}

export function buildRecruiterRowFromSimple(
  row: SimpleComparisonRow,
  index: number,
  candidateName: string,
  extras?: {
    sourceConflicts?: SimpleVerificationReport["sourceConflicts"];
    overrides?: Array<Record<string, unknown>>;
  },
): RecruiterComparisonRow {
  const resumeCompany = display(row.resume?.companyRaw);
  const socialCompany = display(row.social?.companyRaw);
  const position = display(row.resume?.position);
  const resumePeriod = periodLabel(
    row.resume?.startMonth,
    row.resume?.endMonth,
    row.resume?.endIsPresent,
  );
  const socialPeriod = periodLabel(row.social?.startMonth, row.social?.endMonth);
  const paidMonths = uniquePaidMonths(row.social?.paidMonths ?? []);
  const paidMonthCount = paidMonths.length ? paidMonths.length : null;
  const companyConsistentLabel =
    row.status === "RESUME_ONLY" ||
    row.status === "SOCIAL_ONLY" ||
    resumeCompany === "—" ||
    socialCompany === "—"
      ? "—"
      : row.companyConsistent === true
        ? "一致"
        : row.companyConsistent === false
          ? "不一致"
          : "待人工确认";
  const startLabel = startDifferenceLabel(row);
  const endLabel = endDifferenceLabel(row);
  const socialCompanyKnown = socialCompany !== "—";
  const correctionReference =
    row.status === "RESUME_ONLY" || !socialCompanyKnown
      ? "待人工确认"
      : [
          socialCompany,
          position === "—" ? "待人工确认" : position,
          row.social?.startMonth && row.social.endMonth
            ? `${row.social.startMonth} 至 ${row.social.endMonth}`
            : "待人工确认",
        ].join("\n");
  const socialStandardText = socialCompanyKnown
    ? [
        `社保公司：${socialCompany}`,
        `社保时间：${socialPeriod}`,
        `实际缴纳：${paidMonthCount === null ? "无法从材料确定" : `${paidMonthCount}个月`}`,
      ].join("\n")
    : "待人工确认";
  const presentLines = row.resume?.endIsPresent
    ? [
        `简历结束：至今`,
        `社保截止：${row.social?.endMonth ?? "待人工确认"}`,
        `核验基准：${row.verificationBaseline ?? "待人工确认"}`,
      ]
    : [];
  const itemText = [
    `候选人：${candidateName}`,
    `简历：${resumeCompany}`,
    `职位：${position}`,
    `简历时间：${resumePeriod}`,
    `社保：${socialCompany}`,
    `社保时间：${socialPeriod}`,
    ...presentLines,
    `公司是否一致：${companyConsistentLabel}`,
    `开始月份差：${startLabel}`,
    `结束月份差：${endLabel}`,
    `结果：${statusLabels[row.status]}`,
    `原因：${row.reason}`,
    `实际社保月数：${paidMonthCount === null ? "无法从材料确定" : `${paidMonthCount}个月`}`,
    ...(row.hasManualOverride ? ["已人工修正"] : []),
  ].join("\n");
  return {
    id: `simple-${index}`,
    index: index + 1,
    resumeCompany,
    position,
    resumePeriod,
    socialCompany,
    socialPeriod,
    companyConsistentLabel,
    startDifferenceLabel: startLabel,
    endDifferenceLabel: endLabel,
    rowStatus: row.status,
    rowStatusLabel: statusLabels[row.status],
    reason: row.reason,
    paidMonthCount,
    paidMonthLabel:
      paidMonthCount === null ? "无法从材料确定" : `${paidMonthCount}个月`,
    personalInsurance:
      inferPaymentType(row.social?.companyRaw, row.social?.paymentType) ===
      "personal",
    itemText,
    socialStandardText,
    correctionReference,
    hasManualOverride: Boolean(row.hasManualOverride),
    verificationBaseline: row.verificationBaseline ?? null,
    endIsPresent: Boolean(row.resume?.endIsPresent),
    hasSourceConflict: Boolean(
      extras?.sourceConflicts?.some((item) => item.field === "company" || item.field === "month" || item.field === "name"),
    ) || Boolean(row.reason.includes("来源冲突")),
    fieldEvidence: buildFieldEvidence(row, extras?.sourceConflicts, extras?.overrides),
  };
}

function formatDuration(monthCount: number) {
  const years = Math.floor(monthCount / 12);
  const remaining = monthCount % 12;
  if (years === 0) return `${remaining}个月`;
  if (remaining === 0) return `${years}年`;
  return `${years}年${remaining}个月`;
}

export function buildSimpleTotals(rows: SimpleComparisonRow[]): RecruiterTotals {
  const companyMonths = new Set<string>();
  const personalMonths = new Set<string>();
  const unknownMonths = new Set<string>();
  for (const row of rows) {
    if (!row.social) continue;
    const months = uniquePaidMonths(row.social.paidMonths);
    const paymentType = inferPaymentType(
      row.social.companyRaw,
      row.social.paymentType,
    );
    for (const month of months) {
      if (paymentType === "personal") personalMonths.add(month);
      else if (paymentType === "unknown") unknownMonths.add(month);
      else companyMonths.add(month);
    }
  }
  const actualMonths = new Set([
    ...companyMonths,
    ...personalMonths,
    ...unknownMonths,
  ]);
  const classified =
    companyMonths.size + personalMonths.size + unknownMonths.size;
  return {
    companyPaidMonthCount: companyMonths.size,
    personalPaidMonthCount: personalMonths.size,
    unknownPaidMonthCount: unknownMonths.size,
    overlapMonthCount: Math.max(0, classified - actualMonths.size),
    actualPaidMonthCount: actualMonths.size,
    salaryEffectiveMonthCount: companyMonths.size,
    actualPaidDuration: formatDuration(actualMonths.size),
    salaryEffectiveDuration: formatDuration(companyMonths.size),
  };
}

function overrideCopyLines(overrides: Array<Record<string, unknown>> | undefined) {
  return (overrides ?? [])
    .filter((entry) => entry.reviewStatus === "applied")
    .map((entry) => {
      const field = String(entry.field ?? "字段");
      const systemValue = entry.systemValue == null || entry.systemValue === ""
        ? "待人工确认"
        : String(entry.systemValue);
      const overrideValue = entry.overrideValue == null || entry.overrideValue === ""
        ? "待人工确认"
        : String(entry.overrideValue);
      return `人工修正 ${field}：系统识别=${systemValue}；人工修正=${overrideValue}`;
    });
}

function buildSummary(
  candidateName: string,
  rows: RecruiterComparisonRow[],
  totals: RecruiterTotals,
  overrides?: Array<Record<string, unknown>>,
): RecruiterSummary {
  const passCount = rows.filter((row) => row.rowStatus === "PASS").length;
  const failCount = rows.filter((row) => row.rowStatus === "FAIL").length;
  const reviewCount = rows.filter((row) => row.rowStatus === "NEEDS_REVIEW").length;
  const resumeOnlyCount = rows.filter((row) => row.rowStatus === "RESUME_ONLY").length;
  const socialOnlyCount = rows.filter((row) => row.rowStatus === "SOCIAL_ONLY").length;
  const conclusion =
    failCount > 0 || resumeOnlyCount > 0 || socialOnlyCount > 0
      ? "FAIL"
      : reviewCount > 0 || rows.length === 0
        ? "NEEDS_REVIEW"
        : "PASS";
  const conclusionLabel =
    conclusion === "PASS" ? "通过" : conclusion === "FAIL" ? "不通过" : "待人工确认";
  const detailLines = [
    `共核验${rows.length}段记录：`,
    `${passCount}段一致`,
    `${failCount}段不通过`,
    `${resumeOnlyCount}段社保未体现`,
    `${socialOnlyCount}段简历未体现`,
    `${reviewCount}段待人工确认`,
  ];
  const headline = `整体结论：${conclusionLabel}`;
  const fullText = [
    `候选人：${candidateName}`,
    headline,
    ...detailLines,
    "",
    `实际缴费：${totals.actualPaidMonthCount}个月`,
    `折算年限：${totals.actualPaidDuration}`,
    `公司缴纳：${totals.companyPaidMonthCount}个月`,
    `个人缴纳：${totals.personalPaidMonthCount}个月`,
    ...(totals.unknownPaidMonthCount
      ? [`缴费类型待确认：${totals.unknownPaidMonthCount}个月`]
      : []),
    ...(totals.overlapMonthCount
      ? [`重叠月份：${totals.overlapMonthCount}个月`]
      : []),
    `定薪有效缴纳：${totals.salaryEffectiveMonthCount}个月`,
    ...overrideCopyLines(overrides),
    ...rows.flatMap((row) => ["", `${row.index}.`, row.itemText]),
  ].join("\n");
  return {
    conclusion,
    conclusionLabel,
    totalRows: rows.length,
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

function namesMatch(left: string | null | undefined, right: string | null | undefined) {
  const a = (left ?? "").normalize("NFKC").replace(/\s+/gu, "").trim();
  const b = (right ?? "").normalize("NFKC").replace(/\s+/gu, "").trim();
  if (!a || !b) return null;
  return a === b;
}

function resolvePresentEnd(row: SimpleComparisonRow): SimpleComparisonRow {
  if (!row.resume?.endIsPresent) return row;
  const baseline =
    uniquePaidMonths(row.social?.paidMonths ?? []).at(-1) ??
    row.social?.endMonth ??
    null;
  if (!baseline) {
    return {
      ...row,
      verificationBaseline: null,
      ...classifyRow(
        { ...row.resume, endMonth: null },
        row.social,
      ),
    };
  }
  const resume = { ...row.resume, endMonth: baseline };
  return {
    ...row,
    resume,
    verificationBaseline: baseline,
    ...classifyRow(resume, row.social),
  };
}

export function verifyResumeAndSocial(input: {
  candidateName: string;
  socialName?: string | null;
  experiences: ResumeExperience[];
  socialRecords: SocialRecord[];
  verifiedAt?: string;
  duplicateNotice?: string | null;
  overrides?: Array<Record<string, unknown>>;
  hasManualOverride?: boolean;
  sourceConflicts?: SimpleVerificationReport["sourceConflicts"];
  hasUnconfirmedFields?: boolean;
}): SimpleVerificationReport {
  const appliedOverrides = (input.overrides ?? []).filter(
    (entry) => entry.reviewStatus === "applied",
  );
  const rows = pairResumeAndSocial(input.experiences, input.socialRecords)
    .map(resolvePresentEnd)
    .map((row, index) => ({
      ...row,
      hasManualOverride: appliedOverrides.some((entry) => {
        const targetId = typeof entry.targetId === "string" ? entry.targetId : "";
        return (
          (targetId &&
            (targetId === row.resume?.sourceId || targetId === row.social?.sourceId)) ||
          (!targetId && entry.rowIndex === index)
        );
      }),
    }));
  const recruiterTable = rows.map((row, index) =>
    buildRecruiterRowFromSimple(row, index, input.candidateName, {
      sourceConflicts: input.sourceConflicts,
      overrides: input.overrides,
    }),
  );
  const recruiterTotals = buildSimpleTotals(rows);
  const recruiterSummary = buildSummary(
    input.candidateName,
    recruiterTable,
    recruiterTotals,
    input.overrides,
  );
  const nameCompared = namesMatch(input.candidateName, input.socialName);
  const nameStatus: "match" | "mismatch" | "unknown" =
    nameCompared === true ? "match" : nameCompared === false ? "mismatch" : "unknown";
  let overallConclusion = recruiterSummary.conclusion;
  if (nameStatus !== "match" && overallConclusion === "PASS") {
    overallConclusion = "NEEDS_REVIEW";
  }
  if (
    overallConclusion === "PASS" &&
    (input.hasUnconfirmedFields || (input.sourceConflicts?.length ?? 0) > 0)
  ) {
    overallConclusion = "NEEDS_REVIEW";
  }
  const overallConclusionLabel =
    overallConclusion === "PASS"
      ? "通过"
      : overallConclusion === "FAIL"
        ? "不通过"
        : "待人工确认";
  recruiterSummary.conclusion = overallConclusion;
  recruiterSummary.conclusionLabel = overallConclusionLabel;
  recruiterSummary.headline = `整体结论：${overallConclusionLabel}`;
  return {
    schemaVersion: 6,
    pipeline: "simple-v6",
    candidateName: input.candidateName,
    verifiedAt: input.verifiedAt ?? new Date().toISOString(),
    experiences: input.experiences,
    socialRecords: input.socialRecords,
    rows,
    recruiterTable,
    recruiterTotals,
    recruiterSummary,
    overallConclusion,
    overallConclusionLabel,
    resumeName: input.candidateName,
    socialName: input.socialName ?? null,
    nameStatus,
    duplicateNotice: input.duplicateNotice ?? null,
    fieldOverrides: input.overrides ?? [],
    overrides: input.overrides ?? [],
    sourceConflicts: input.sourceConflicts ?? [],
    hasUnconfirmedFields: Boolean(input.hasUnconfirmedFields),
  };
}

export function paidMonthsFromInterval(
  startMonth: string | null,
  endMonth: string | null,
  statedCount: number | null,
): string[] {
  if (!startMonth || !endMonth || statedCount === null) return [];
  const range = inclusiveMonthRange(startMonth, endMonth);
  return range.length === statedCount ? range : [];
}
