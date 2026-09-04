export function statusToneClass(label: string): string {
  if (label === "通过" || label === "系统核验通过" || label === "人工确认后通过" || label === "人工修正后通过") {
    return "tone-pass";
  }
  if (label === "不通过" || label === "核验不通过" || label === "处理失败") {
    return "tone-fail";
  }
  if (label === "待人工确认" || label === "待确认") return "tone-review";
  if (label === "处理中" || label === "正在终止") return "tone-processing";
  if (label === "已终止") return "tone-cancelled";
  return "tone-legacy";
}

export function recordHref(item: {
  id: string;
  status: string;
  overallConclusion: string;
  overallConclusionLabel?: string;
}): string {
  if (item.overallConclusion === "CANCELLED" || item.overallConclusionLabel === "已终止") {
    return `/processing/${item.id}`;
  }
  if (item.status === "FAILED" || item.overallConclusion === "FAILED") {
    return `/processing/${item.id}`;
  }
  if (item.status !== "COMPLETED") return `/processing/${item.id}`;
  return `/result/${item.id}`;
}

export function displayStatusLabel(item: {
  status: string;
  overallConclusionLabel: string;
}): string {
  if (item.overallConclusionLabel === "处理中" || item.overallConclusionLabel === "已终止" || item.overallConclusionLabel === "处理失败") {
    return item.overallConclusionLabel;
  }
  if (item.status === "FAILED") return "处理失败";
  if (item.status !== "COMPLETED") return "处理中";
  return item.overallConclusionLabel;
}
