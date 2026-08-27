import { monthIndex } from "./schemas";
import { inclusiveMonthRange } from "./social-security-evidence";
import type {
  RecruiterComparisonRow,
  RecruiterRowStatus,
  RecruiterSummary,
  RecruiterTotals,
} from "./result-view-model";

export type ResumeExperience = {
  companyRaw: string | null;
  position: string | null;
  startMonth: string | null;
  endMonth: string | null;
};

export type SocialRecord = {
  companyRaw: string | null;
  startMonth: string | null;
  endMonth: string | null;
  paidMonths: string[];
  paymentType: "company" | "personal" | "unknown";
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
};

export type SimpleVerificationReport = {
  schemaVersion: 4;
  pipeline: "simple-v2";
  candidateName: string;
  verifiedAt: string;
  experiences: ResumeExperience[];
  socialRecords: SocialRecord[];
  rows: SimpleComparisonRow[];
  recruiterTable: RecruiterComparisonRow[];
  recruiterTotals: RecruiterTotals;
  recruiterSummary: RecruiterSummary;
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
  if (explicit === "personal" || PERSONAL_PATTERN.test(companyRaw ?? "")) {
    return "personal";
  }
  if (explicit === "company") return "company";
  return companyRaw?.trim() ? "company" : "unknown";
}

function periodDistance(resume: ResumeExperience, social: SocialRecord): number {
  const start = monthDifference(social.startMonth, resume.startMonth);
  const end = monthDifference(social.endMonth, resume.endMonth);
  if (start === null && end === null) return Number.POSITIVE_INFINITY;
  return Math.abs(start ?? 0) + Math.abs(end ?? 0);
}

function periodsOverlap(resume: ResumeExperience, social: SocialRecord): boolean {
  if (
    !resume.startMonth ||
    !resume.endMonth ||
    !social.startMonth ||
    !social.endMonth
  ) {
    return false;
  }
  return (
    monthIndex(resume.startMonth) <= monthIndex(social.endMonth) &&
    monthIndex(social.startMonth) <= monthIndex(resume.endMonth)
  );
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
      status: personal ? "NEEDS_REVIEW" : "SOCIAL_ONLY",
      reason: personal
        ? "个人参保或灵活就业，不自动计入工作经历和定薪年限"
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
  const personal = inferPaymentType(social.companyRaw, social.paymentType) === "personal";
  const missingCompany = companyConsistent === null;
  const missingStart = !resume.startMonth || !social.startMonth;
  const missingEnd = !resume.endMonth || !social.endMonth;

  if (personal) {
    return {
      companyConsistent,
      startMonthDifference,
      endMonthDifference,
      status: "NEEDS_REVIEW",
      reason: "个人参保或灵活就业，不自动计入工作经历和定薪年限",
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

export function pairResumeAndSocial(
  experiences: ResumeExperience[],
  socialRecords: SocialRecord[],
): SimpleComparisonRow[] {
  const usedSocial = new Set<number>();
  const rows: SimpleComparisonRow[] = [];

  const takeBest = (
    resume: ResumeExperience,
    predicate: (social: SocialRecord, index: number) => boolean,
  ) => {
    const candidates = socialRecords
      .map((social, index) => ({ social, index }))
      .filter(({ social, index }) => !usedSocial.has(index) && predicate(social, index))
      .sort(
        (left, right) =>
          periodDistance(resume, left.social) - periodDistance(resume, right.social),
      );
    return candidates[0] ?? null;
  };

  for (const resume of experiences) {
    const exact = takeBest(
      resume,
      (social) => companiesMatch(resume.companyRaw, social.companyRaw) === true,
    );
    const overlapped =
      exact ??
      takeBest(
        resume,
        (social) =>
          inferPaymentType(social.companyRaw, social.paymentType) !== "personal" &&
          periodsOverlap(resume, social),
      );
    if (!overlapped) {
      rows.push({ resume, social: null, ...classifyRow(resume, null) });
      continue;
    }
    usedSocial.add(overlapped.index);
    rows.push({
      resume,
      social: overlapped.social,
      ...classifyRow(resume, overlapped.social),
    });
  }

  for (const [index, social] of socialRecords.entries()) {
    if (usedSocial.has(index)) continue;
    rows.push({ resume: null, social, ...classifyRow(null, social) });
  }
  return rows;
}

function display(value: string | null | undefined) {
  return value?.trim() ? value : "—";
}

function periodLabel(start: string | null | undefined, end: string | null | undefined) {
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

export function buildRecruiterRowFromSimple(
  row: SimpleComparisonRow,
  index: number,
  candidateName: string,
): RecruiterComparisonRow {
  const resumeCompany = display(row.resume?.companyRaw);
  const socialCompany = display(row.social?.companyRaw);
  const position = display(row.resume?.position);
  const resumePeriod = periodLabel(row.resume?.startMonth, row.resume?.endMonth);
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
  const itemText = [
    `候选人：${candidateName}`,
    `简历：${resumeCompany}`,
    `职位：${position}`,
    `简历时间：${resumePeriod}`,
    `社保：${socialCompany}`,
    `社保时间：${socialPeriod}`,
    `公司是否一致：${companyConsistentLabel}`,
    `开始月份差：${startLabel}`,
    `结束月份差：${endLabel}`,
    `结果：${statusLabels[row.status]}`,
    `原因：${row.reason}`,
    `实际社保月数：${paidMonthCount === null ? "无法从材料确定" : `${paidMonthCount}个月`}`,
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
  for (const row of rows) {
    if (!row.social) continue;
    const months = uniquePaidMonths(row.social.paidMonths);
    const personal =
      inferPaymentType(row.social.companyRaw, row.social.paymentType) ===
      "personal";
    for (const month of months) {
      if (personal) personalMonths.add(month);
      else companyMonths.add(month);
    }
  }
  const actualMonths = new Set([...companyMonths, ...personalMonths]);
  return {
    companyPaidMonthCount: companyMonths.size,
    personalPaidMonthCount: personalMonths.size,
    actualPaidMonthCount: actualMonths.size,
    salaryEffectiveMonthCount: companyMonths.size,
    actualPaidDuration: formatDuration(actualMonths.size),
    salaryEffectiveDuration: formatDuration(companyMonths.size),
  };
}

function buildSummary(
  candidateName: string,
  rows: RecruiterComparisonRow[],
  totals: RecruiterTotals,
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
    `定薪有效缴纳：${totals.salaryEffectiveMonthCount}个月`,
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

export function verifyResumeAndSocial(input: {
  candidateName: string;
  experiences: ResumeExperience[];
  socialRecords: SocialRecord[];
  verifiedAt?: string;
}): SimpleVerificationReport {
  const rows = pairResumeAndSocial(input.experiences, input.socialRecords);
  const recruiterTable = rows.map((row, index) =>
    buildRecruiterRowFromSimple(row, index, input.candidateName),
  );
  const recruiterTotals = buildSimpleTotals(rows);
  const recruiterSummary = buildSummary(
    input.candidateName,
    recruiterTable,
    recruiterTotals,
  );
  return {
    schemaVersion: 4,
    pipeline: "simple-v2",
    candidateName: input.candidateName,
    verifiedAt: input.verifiedAt ?? new Date().toISOString(),
    experiences: input.experiences,
    socialRecords: input.socialRecords,
    rows,
    recruiterTable,
    recruiterTotals,
    recruiterSummary,
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
