import { NextResponse } from "next/server";
import { db } from "@/lib/db";

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
      return {
        id: row.id,
        status: row.status,
        stage: row.stage,
        candidateName: row.candidate_name,
        anomalyCount: result?.summary?.anomalyCount ?? 0,
        conclusion: result?.summary?.conclusion ?? null,
        errorCode: row.error_code,
        createdAt: row.created_at,
        completedAt: row.completed_at,
      };
    }),
  );
}
