import Database from "better-sqlite3";
import { dirname, resolve } from "node:path";
import { mkdirSync } from "node:fs";
import { config } from "./config";

const dbPath = resolve(config.DATABASE_PATH);
mkdirSync(dirname(dbPath), { recursive: true });

const globalDb = globalThis as typeof globalThis & { verificationDb?: Database.Database };
export const db = globalDb.verificationDb ?? new Database(dbPath);
if (process.env.NODE_ENV !== "production") globalDb.verificationDb = db;

db.pragma("journal_mode = WAL");
db.pragma("busy_timeout = 5000");
db.pragma("foreign_keys = ON");

function hasColumn(table: string, column: string) {
  return (
    db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  ).some((entry) => entry.name === column);
}

function addColumn(table: string, definition: string) {
  const column = definition.split(/\s+/, 1)[0];
  if (!hasColumn(table, column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
}

export function initializeDatabase() {
  db.transaction(() => {
    db.exec(`
    CREATE TABLE IF NOT EXISTS verification_tasks (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL CHECK(status IN ('PENDING','PROCESSING','COMPLETED','FAILED')),
      stage TEXT NOT NULL DEFAULT 'PENDING',
      candidate_name TEXT,
      paid_override INTEGER NOT NULL DEFAULT 0,
      estimated_ocr_calls INTEGER NOT NULL DEFAULT 0,
      error_code TEXT,
      error_message TEXT,
      resume_json TEXT,
      social_security_json TEXT,
      result_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT
    );
    CREATE TABLE IF NOT EXISTS task_files (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES verification_tasks(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK(kind IN ('RESUME','SOCIAL_SECURITY')),
      original_name TEXT NOT NULL,
      storage_key TEXT NOT NULL UNIQUE,
      mime_type TEXT NOT NULL,
      size INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ocr_calls (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES verification_tasks(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      api_type TEXT NOT NULL,
      created_at TEXT NOT NULL,
      paid_override INTEGER NOT NULL DEFAULT 0,
      estimated_cost REAL NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_tasks_status_created ON verification_tasks(status, created_at);
    CREATE INDEX IF NOT EXISTS idx_files_expires ON task_files(expires_at);
    CREATE INDEX IF NOT EXISTS idx_ocr_created ON ocr_calls(created_at);
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS task_stage_artifacts (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES verification_tasks(id) ON DELETE CASCADE,
      stage TEXT NOT NULL,
      cache_key TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(task_id, stage, cache_key)
    );
    CREATE INDEX IF NOT EXISTS idx_artifacts_task_stage
      ON task_stage_artifacts(task_id, stage, updated_at);
    CREATE TABLE IF NOT EXISTS extraction_cache (
      cache_key TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      api_type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      last_used_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS api_calls (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES verification_tasks(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      api_type TEXT NOT NULL,
      source_page INTEGER,
      http_status INTEGER,
      error_code TEXT,
      request_id TEXT,
      duration_ms INTEGER NOT NULL,
      cache_hit INTEGER NOT NULL DEFAULT 0,
      estimated_cost REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_api_calls_task ON api_calls(task_id, created_at);
    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES verification_tasks(id) ON DELETE CASCADE,
      task_file_id TEXT NOT NULL REFERENCES task_files(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK(kind IN ('RESUME','SOCIAL_SECURITY')),
      original_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      extraction_version TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(task_file_id)
    );
    CREATE INDEX IF NOT EXISTS idx_documents_task ON documents(task_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_documents_content_version
      ON documents(content_hash, extraction_version);
    CREATE TABLE IF NOT EXISTS document_pages (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      page_number INTEGER NOT NULL CHECK(page_number > 0),
      page_type TEXT NOT NULL CHECK(page_type IN ('TEXT','TABLE','AMBIGUOUS','UNREADABLE','UNKNOWN')),
      pdf_text TEXT,
      ocr_text TEXT,
      selected_text TEXT,
      extraction_method TEXT NOT NULL CHECK(extraction_method IN (
        'PDF_TEXT','OCR_GENERAL','OCR_TABLE','HYBRID','MANUAL_REQUIRED'
      )),
      quality_score INTEGER NOT NULL CHECK(quality_score BETWEEN 0 AND 100),
      warnings_json TEXT NOT NULL DEFAULT '[]',
      content_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(document_id, page_number)
    );
    CREATE INDEX IF NOT EXISTS idx_document_pages_document
      ON document_pages(document_id, page_number);
    CREATE TABLE IF NOT EXISTS raw_extractions (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      document_page_id TEXT REFERENCES document_pages(id) ON DELETE CASCADE,
      extraction_method TEXT NOT NULL CHECK(extraction_method IN (
        'PDF_TEXT','OCR_GENERAL','OCR_TABLE','HYBRID','MANUAL_REQUIRED'
      )),
      raw_text TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      UNIQUE(document_page_id, extraction_method, content_hash)
    );
    CREATE INDEX IF NOT EXISTS idx_raw_extractions_document
      ON raw_extractions(document_id, document_page_id);
    CREATE TABLE IF NOT EXISTS extraction_warnings (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      document_page_id TEXT REFERENCES document_pages(id) ON DELETE CASCADE,
      code TEXT NOT NULL,
      severity TEXT NOT NULL CHECK(severity IN ('INFO','WARNING','ERROR')),
      details_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_extraction_warnings_page
      ON extraction_warnings(document_page_id, created_at);
    CREATE TABLE IF NOT EXISTS stage_cache (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES verification_tasks(id) ON DELETE CASCADE,
      document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      content_hash TEXT NOT NULL,
      stage TEXT NOT NULL CHECK(stage IN (
        'DOCUMENT_INGESTED','PDF_EXTRACTED','QUALITY_EVALUATED'
      )),
      version TEXT NOT NULL,
      cache_key TEXT NOT NULL UNIQUE,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(task_id, document_id, content_hash, stage, version)
    );
    CREATE INDEX IF NOT EXISTS idx_stage_cache_lookup
      ON stage_cache(task_id, document_id, content_hash, stage, version);
    `);
    addColumn("verification_tasks", "schema_version INTEGER NOT NULL DEFAULT 1");
    addColumn("verification_tasks", "task_schema_version INTEGER NOT NULL DEFAULT 1");
    addColumn("verification_tasks", "extraction_version TEXT");
    addColumn("verification_tasks", "ocr_pages INTEGER NOT NULL DEFAULT 0");
    addColumn("verification_tasks", "deepseek_calls INTEGER NOT NULL DEFAULT 0");
    addColumn("verification_tasks", "estimated_cost REAL NOT NULL DEFAULT 0");
    db.prepare(
      "INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (3, ?)",
    ).run(new Date().toISOString());
  })();
}

initializeDatabase();

export type TaskRow = {
  id: string;
  status: "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED";
  stage: string;
  candidate_name: string | null;
  paid_override: 0 | 1;
  estimated_ocr_calls: number;
  error_code: string | null;
  error_message: string | null;
  resume_json: string | null;
  social_security_json: string | null;
  result_json: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  schema_version: number;
  task_schema_version: number;
  extraction_version: string | null;
  ocr_pages: number;
  deepseek_calls: number;
  estimated_cost: number;
};
