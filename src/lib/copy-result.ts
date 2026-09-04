import type { RecruiterComparisonRow, RecruiterSummary } from "./result-view-model";

export type CopyMatchLabel = "一致" | "不一致" | "待确认";

export function copyMatchLabel(value: string | null | undefined): CopyMatchLabel {
  if (value === "一致") return "一致";
  if (value === "不一致") return "不一致";
  return "待确认";
}

export function buildVerificationCopyText(input: {
  candidateName: string;
  overallConclusionLabel: string;
  reviewStatusLabel: string;
  rows: RecruiterComparisonRow[];
}): string {
  const lines = [
    `候选人：${input.candidateName || "待人工确认"}`,
    `整体结论：${input.overallConclusionLabel}`,
    `复核状态：${input.reviewStatusLabel}`,
  ];
  input.rows.forEach((row, index) => {
    lines.push(
      "",
      `第${index + 1}段`,
      `简历公司：${row.resumeCompany}`,
      `简历时间：${row.resumePeriod}`,
      `社保公司：${row.socialCompany}`,
      `社保时间：${row.socialPeriod}`,
      `公司名称：${copyMatchLabel(row.companyConsistentLabel)}`,
      `开始月份：${copyMatchLabel(row.startDifferenceLabel)}`,
      `结束月份：${copyMatchLabel(row.endDifferenceLabel)}`,
      `该段结论：${row.rowStatusLabel}`,
    );
  });
  return lines.join("\n");
}

export function reviewStatusLabel(input: {
  locked?: boolean;
  conclusionSource?: string | null;
  summary?: RecruiterSummary;
}): string {
  if (input.locked) return "已锁定";
  if (input.conclusionSource === "confirmed_pass") return "人工确认后通过";
  if (input.conclusionSource === "corrected_pass") return "人工修正后通过";
  if (input.summary?.conclusion === "PASS") return "系统核验通过";
  if (input.summary?.conclusion === "FAIL") return "核验不通过";
  return "待人工确认";
}
