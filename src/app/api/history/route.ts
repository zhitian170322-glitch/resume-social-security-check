import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { readOverallConclusion } from "@/lib/overall-conclusion";
import {
  companiesFromResult,
  historyRecordFromTask,
  matchesHistorySearch,
} from "@/lib/history-search";

export const runtime = "nodejs";

export function GET(request: Request) {
  const url = new URL(request.url);
  const query = {
    candidateName: url.searchParams.get("candidateName") ?? undefined,
    resumeCompany: url.searchParams.get("resumeCompany") ?? undefined,
    socialCompany: url.searchParams.get("socialCompany") ?? undefined,
    status: url.searchParams.get("status") ?? undefined,
    from: url.searchParams.get("from") ?? undefined,
    to: url.searchParams.get("to") ?? undefined,
    reviewOnly: url.searchParams.get("review") === "1",
  };
  const rows = db
    .prepare(
      `SELECT id, status, stage, candidate_name, result_json, error_code, created_at,
              completed_at, updated_at, review_status
       FROM verification_tasks ORDER BY created_at DESC LIMIT 200`,
    )
    .all() as Array<Record<string, string | null>>;
  const items = rows
    .map((row) => {
      const result = row.result_json ? JSON.parse(row.result_json) : null;
      const conclusion = readOverallConclusion(result, row.status ?? undefined);
      const companies = companiesFromResult(result);
      const searchRecord = historyRecordFromTask({
        id: String(row.id),
        status: String(row.status),
        candidate_name: row.candidate_name,
        result_json: row.result_json,
        review_status: row.review_status,
        created_at: String(row.created_at),
        updated_at: row.updated_at,
        completed_at: row.completed_at,
      });
      return {
        id: row.id,
        status: row.status,
        stage: row.stage,
        candidateName: row.candidate_name,
        anomalyCount:
          conclusion.failCount ??
          result?.recruiterSummary?.failCount ??
          result?.summary?.anomalyCount ??
          0,
        conclusion: conclusion.overallConclusionLabel,
        overallConclusion: conclusion.overallConclusion,
        overallConclusionLabel: conclusion.overallConclusionLabel,
        passCount: conclusion.passCount,
        failCount: conclusion.failCount,
        reviewCount: conclusion.reviewCount,
        actualPaidMonthCount: conclusion.actualPaidMonthCount,
        salaryEffectiveMonthCount: conclusion.salaryEffectiveMonthCount,
        errorCode: row.error_code,
        createdAt: row.created_at,
        completedAt: row.completed_at,
        updatedAt: row.updated_at,
        reviewStatus: row.review_status,
        resumeCompanies: companies.resumeCompanies,
        socialCompanies: companies.socialCompanies,
        searchRecord,
      };
    })
    .filter((item) => matchesHistorySearch(item.searchRecord, query))
    .map((item) => {
      const { searchRecord, ...visible } = item;
      void searchRecord;
      return visible;
    });
  return NextResponse.json(items);
}
