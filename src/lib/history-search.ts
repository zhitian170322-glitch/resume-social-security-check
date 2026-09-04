import { readOverallConclusion } from "./overall-conclusion";

export type HistorySearchQuery = {
  candidateName?: string;
  resumeCompany?: string;
  socialCompany?: string;
  status?: string;
  from?: string;
  to?: string;
  reviewOnly?: boolean;
};

export type HistorySearchRecord = {
  id: string;
  candidateName: string | null;
  overallConclusion: string;
  overallConclusionLabel: string;
  reviewStatus: string | null;
  resumeCompanies: string[];
  socialCompanies: string[];
  createdAt: string;
  updatedAt: string | null;
  status: string;
};

function includesNormalized(haystack: string | null | undefined, needle: string | undefined) {
  if (!needle?.trim()) return true;
  return (haystack ?? "").toLocaleLowerCase("zh-CN").includes(needle.trim().toLocaleLowerCase("zh-CN"));
}

function anyIncludes(values: string[], needle: string | undefined) {
  if (!needle?.trim()) return true;
  return values.some((value) => includesNormalized(value, needle));
}

export function companiesFromResult(result: unknown): {
  resumeCompanies: string[];
  socialCompanies: string[];
} {
  if (!result || typeof result !== "object") {
    return { resumeCompanies: [], socialCompanies: [] };
  }
  const table = (result as { recruiterTable?: Array<Record<string, unknown>> }).recruiterTable ?? [];
  const resumeCompanies = table
    .map((row) => String(row.resumeCompany ?? ""))
    .filter((value) => value && value !== "—");
  const socialCompanies = table
    .map((row) => String(row.socialCompany ?? ""))
    .filter((value) => value && value !== "—");
  return { resumeCompanies, socialCompanies };
}

export function isPendingReview(record: Pick<HistorySearchRecord, "overallConclusion" | "reviewStatus">) {
  return record.overallConclusion === "NEEDS_REVIEW";
}

export function matchesHistorySearch(record: HistorySearchRecord, query: HistorySearchQuery) {
  if (query.reviewOnly && !isPendingReview(record)) return false;
  if (!includesNormalized(record.candidateName, query.candidateName)) return false;
  if (!anyIncludes(record.resumeCompanies, query.resumeCompany)) return false;
  if (!anyIncludes(record.socialCompanies, query.socialCompany)) return false;
  if (query.status?.trim()) {
    const status = query.status.trim();
    const matched =
      record.overallConclusion === status ||
      record.overallConclusionLabel === status ||
      record.status === status ||
      (status === "处理中" && record.status !== "COMPLETED" && record.status !== "FAILED") ||
      (status === "已终止" && (record.overallConclusion === "CANCELLED" || record.status === "CANCELLED")) ||
      (status === "处理失败" && record.overallConclusion === "FAILED");
    if (!matched) return false;
  }
  if (query.from && record.createdAt.slice(0, 10) < query.from) return false;
  if (query.to && record.createdAt.slice(0, 10) > query.to) return false;
  return true;
}

export function historyRecordFromTask(row: {
  id: string;
  status: string;
  candidate_name: string | null;
  result_json: string | null;
  review_status?: string | null;
  created_at: string;
  updated_at?: string | null;
  completed_at?: string | null;
  cancel_state?: string | null;
  error_code?: string | null;
}): HistorySearchRecord {
  const result = row.result_json ? (JSON.parse(row.result_json) as unknown) : null;
  const conclusion = readOverallConclusion(result, row.status, {
    cancelState: row.cancel_state,
    errorCode: row.error_code,
  });
  const companies = companiesFromResult(result);
  return {
    id: row.id,
    candidateName: row.candidate_name,
    overallConclusion: conclusion.overallConclusion,
    overallConclusionLabel: conclusion.overallConclusionLabel,
    reviewStatus: row.review_status ?? null,
    resumeCompanies: companies.resumeCompanies,
    socialCompanies: companies.socialCompanies,
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? row.completed_at ?? null,
    status: row.status,
  };
}
