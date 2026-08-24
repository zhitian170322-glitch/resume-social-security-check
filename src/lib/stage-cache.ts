import { createHash, randomUUID } from "node:crypto";
import { db } from "./db";

export type ProcessingStage =
  | "DOCUMENT_EXTRACTED"
  | "OCR_COMPLETED"
  | "STRUCTURED"
  | "EVIDENCE_VALIDATED"
  | "VERIFIED";

export type DocumentProcessingStage =
  | "DOCUMENT_INGESTED"
  | "PDF_EXTRACTED"
  | "QUALITY_EVALUATED";

export type DocumentStageCacheIdentity = {
  taskId: string;
  documentId: string;
  contentHash: string;
  stage: DocumentProcessingStage;
  version: string;
};

export function contentHash(data: Buffer | string) {
  return createHash("sha256").update(data).digest("hex");
}

export function documentStageCacheKey(identity: DocumentStageCacheIdentity) {
  return contentHash(
    [
      identity.taskId,
      identity.documentId,
      identity.contentHash,
      identity.stage,
      identity.version,
    ].join("\u001f"),
  );
}

export function readDocumentStageCache<T>(
  identity: DocumentStageCacheIdentity,
): T | null {
  const cacheKey = documentStageCacheKey(identity);
  const row = db
    .prepare(
      `SELECT payload_json FROM stage_cache
       WHERE task_id = ? AND document_id = ? AND content_hash = ?
         AND stage = ? AND version = ? AND cache_key = ?`,
    )
    .get(
      identity.taskId,
      identity.documentId,
      identity.contentHash,
      identity.stage,
      identity.version,
      cacheKey,
    ) as { payload_json: string } | undefined;
  return row ? (JSON.parse(row.payload_json) as T) : null;
}

export function writeDocumentStageCache(
  identity: DocumentStageCacheIdentity,
  payload: unknown,
) {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO stage_cache
      (id, task_id, document_id, content_hash, stage, version, cache_key,
       payload_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(task_id, document_id, content_hash, stage, version)
     DO UPDATE SET
       cache_key = excluded.cache_key,
       payload_json = excluded.payload_json,
       updated_at = excluded.updated_at`,
  ).run(
    randomUUID(),
    identity.taskId,
    identity.documentId,
    identity.contentHash,
    identity.stage,
    identity.version,
    documentStageCacheKey(identity),
    JSON.stringify(payload),
    now,
    now,
  );
}

export function readStageArtifact<T>(
  taskId: string,
  stage: ProcessingStage,
  cacheKey: string,
): T | null {
  const row = db
    .prepare(
      `SELECT payload_json FROM task_stage_artifacts
       WHERE task_id = ? AND stage = ? AND cache_key = ?`,
    )
    .get(taskId, stage, cacheKey) as { payload_json: string } | undefined;
  return row ? (JSON.parse(row.payload_json) as T) : null;
}

export function writeStageArtifact(
  taskId: string,
  stage: ProcessingStage,
  cacheKey: string,
  payload: unknown,
) {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO task_stage_artifacts
      (id, task_id, stage, cache_key, payload_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(task_id, stage, cache_key)
     DO UPDATE SET payload_json = excluded.payload_json, updated_at = excluded.updated_at`,
  ).run(randomUUID(), taskId, stage, cacheKey, JSON.stringify(payload), now, now);
}

export function readExtractionCache<T>(cacheKey: string): T | null {
  const row = db
    .prepare("SELECT payload_json FROM extraction_cache WHERE cache_key = ?")
    .get(cacheKey) as { payload_json: string } | undefined;
  if (!row) return null;
  db.prepare("UPDATE extraction_cache SET last_used_at = ? WHERE cache_key = ?").run(
    new Date().toISOString(),
    cacheKey,
  );
  return JSON.parse(row.payload_json) as T;
}

export function writeExtractionCache(
  cacheKey: string,
  provider: string,
  apiType: string,
  payload: unknown,
) {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO extraction_cache
      (cache_key, provider, api_type, payload_json, created_at, last_used_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(cache_key) DO UPDATE SET
       payload_json = excluded.payload_json,
       last_used_at = excluded.last_used_at`,
  ).run(cacheKey, provider, apiType, JSON.stringify(payload), now, now);
}
