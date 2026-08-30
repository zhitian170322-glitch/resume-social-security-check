import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { readOverallConclusion } from "@/lib/overall-conclusion";

export const runtime = "nodejs";

export function GET() {
  const rows = db
    .prepare(
      `SELECT id, status, stage, candidate_name, result_json, error_code, created_at, completed_at
       FROM verification_tasks ORDER BY created_at DESC LIMIT 100`,
    )
    .all() as Array<Record<string, string | null>>;
  return NextResponse.json(
    rows.map((row) => {
      const result = row.result_json ? JSON.parse(row.result_json) : null;
      const conclusion = readOverallConclusion(result, row.status ?? undefined);
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
      };
    }),
  );
}
