import type { OverallConclusion } from "./simple-verification";

export type HistoryConclusion = {
  overallConclusion: OverallConclusion | "LEGACY";
  overallConclusionLabel: string;
  passCount: number | null;
  failCount: number | null;
  reviewCount: number | null;
  actualPaidMonthCount: number | null;
  salaryEffectiveMonthCount: number | null;
};

function label(conclusion: HistoryConclusion["overallConclusion"]) {
  if (conclusion === "PASS") return "通过";
  if (conclusion === "FAIL") return "不通过";
  if (conclusion === "NEEDS_REVIEW") return "待人工确认";
  return "旧版记录";
}

export function readOverallConclusion(result: unknown, taskStatus?: string): HistoryConclusion {
  const empty = (conclusion: HistoryConclusion["overallConclusion"]): HistoryConclusion => ({
    overallConclusion: conclusion,
    overallConclusionLabel: label(conclusion),
    passCount: null,
    failCount: null,
    reviewCount: null,
    actualPaidMonthCount: null,
    salaryEffectiveMonthCount: null,
  });
  if (!result || typeof result !== "object") {
    return empty(taskStatus === "COMPLETED" ? "LEGACY" : "NEEDS_REVIEW");
  }
  const record = result as Record<string, unknown>;
  if (record.schemaVersion === 6 || record.schemaVersion === 5 || record.schemaVersion === 4) {
    const summary = (record.recruiterSummary ?? {}) as Record<string, unknown>;
    const totals = (record.recruiterTotals ?? {}) as Record<string, unknown>;
    const conclusion =
      (record.overallConclusion as OverallConclusion | undefined) ??
      (summary.conclusion as OverallConclusion | undefined);
    if (conclusion === "PASS" || conclusion === "FAIL" || conclusion === "NEEDS_REVIEW") {
      return {
        overallConclusion: conclusion,
        overallConclusionLabel:
          (record.overallConclusionLabel as string | undefined) ?? label(conclusion),
        passCount: typeof summary.passCount === "number" ? summary.passCount : null,
        failCount: typeof summary.failCount === "number" ? summary.failCount : null,
        reviewCount: typeof summary.reviewCount === "number" ? summary.reviewCount : null,
        actualPaidMonthCount:
          typeof totals.actualPaidMonthCount === "number"
            ? totals.actualPaidMonthCount
            : null,
        salaryEffectiveMonthCount:
          typeof totals.salaryEffectiveMonthCount === "number"
            ? totals.salaryEffectiveMonthCount
            : null,
      };
    }
  }
  if (record.schemaVersion === 2) {
    return empty("LEGACY");
  }
  return empty("LEGACY");
}
