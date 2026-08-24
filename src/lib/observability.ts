import { randomUUID } from "node:crypto";
import { db } from "./db";

export type SafeLogEvent = {
  taskId: string;
  stage: string;
  provider?: string;
  page?: number;
  httpStatus?: number;
  errorCode?: string;
  requestId?: string;
  durationMs?: number;
};

export function logSafeEvent(level: "info" | "error", event: SafeLogEvent) {
  const safe = {
    level,
    at: new Date().toISOString(),
    taskId: event.taskId,
    stage: event.stage,
    provider: event.provider,
    page: event.page,
    httpStatus: event.httpStatus,
    errorCode: event.errorCode,
    requestId: event.requestId,
    durationMs: event.durationMs,
  };
  const output = JSON.stringify(safe);
  if (level === "error") console.error(output);
  else console.info(output);
}

export function recordApiCall(input: {
  taskId: string;
  provider: string;
  apiType: string;
  sourcePage?: number;
  httpStatus?: number;
  errorCode?: string;
  requestId?: string;
  durationMs: number;
  cacheHit: boolean;
  estimatedCost: number;
}) {
  db.prepare(
    `INSERT INTO api_calls
      (id, task_id, provider, api_type, source_page, http_status, error_code,
       request_id, duration_ms, cache_hit, estimated_cost, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    randomUUID(),
    input.taskId,
    input.provider,
    input.apiType,
    input.sourcePage ?? null,
    input.httpStatus ?? null,
    input.errorCode ?? null,
    input.requestId ?? null,
    input.durationMs,
    input.cacheHit ? 1 : 0,
    input.estimatedCost,
    new Date().toISOString(),
  );
}
