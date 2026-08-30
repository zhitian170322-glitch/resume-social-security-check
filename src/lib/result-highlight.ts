export type FieldHighlight =
  | "plain"
  | "match"
  | "mismatch"
  | "review"
  | "missing"
  | "override";

export function highlightLabel(kind: FieldHighlight) {
  if (kind === "match") return "✓ 一致";
  if (kind === "mismatch") return "不一致";
  if (kind === "review") return "待人工确认";
  if (kind === "missing") return "未体现";
  if (kind === "override") return "已人工修正";
  return "";
}

export function companyHighlight(label: string): FieldHighlight {
  if (label === "一致") return "match";
  if (label === "不一致") return "mismatch";
  if (label === "待人工确认") return "review";
  return "plain";
}

export function differenceHighlight(label: string): FieldHighlight {
  if (label === "一致") return "match";
  if (label === "待人工确认") return "review";
  if (label === "—") return "plain";
  return "mismatch";
}

export function rowStatusHighlight(status: string): FieldHighlight {
  if (status === "PASS") return "match";
  if (status === "FAIL") return "mismatch";
  if (status === "NEEDS_REVIEW") return "review";
  if (status === "RESUME_ONLY" || status === "SOCIAL_ONLY") return "missing";
  return "plain";
}
