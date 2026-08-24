import Database from "better-sqlite3";
import { dirname, resolve } from "node:path";
import { mkdirSync } from "node:fs";

const path = resolve((process.env.DATABASE_URL || "file:./data/app.db").replace(/^file:/, ""));
mkdirSync(dirname(path), { recursive: true });
const db = new Database(path);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.exec("BEGIN IMMEDIATE");
try {
db.exec(`
  CREATE TABLE IF NOT EXISTS verification_tasks (
    id TEXT PRIMARY KEY, status TEXT NOT NULL, stage TEXT NOT NULL DEFAULT 'PENDING',
    candidate_name TEXT, paid_override INTEGER NOT NULL DEFAULT 0,
    estimated_ocr_calls INTEGER NOT NULL DEFAULT 0, error_code TEXT, error_message TEXT,
    resume_json TEXT, social_security_json TEXT, result_json TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, completed_at TEXT
  );
  CREATE TABLE IF NOT EXISTS task_files (
    id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES verification_tasks(id) ON DELETE CASCADE,
    kind TEXT NOT NULL, original_name TEXT NOT NULL, storage_key TEXT NOT NULL UNIQUE,
    mime_type TEXT NOT NULL, size INTEGER NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS ocr_calls (
    id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES verification_tasks(id) ON DELETE CASCADE,
    provider TEXT NOT NULL, api_type TEXT NOT NULL, created_at TEXT NOT NULL,
    paid_override INTEGER NOT NULL DEFAULT 0, estimated_cost REAL NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS task_stage_artifacts (
    id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES verification_tasks(id) ON DELETE CASCADE,
    stage TEXT NOT NULL, cache_key TEXT NOT NULL, payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(task_id, stage, cache_key)
  );
  CREATE TABLE IF NOT EXISTS extraction_cache (
    cache_key TEXT PRIMARY KEY, provider TEXT NOT NULL, api_type TEXT NOT NULL,
    payload_json TEXT NOT NULL, created_at TEXT NOT NULL, last_used_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS api_calls (
    id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES verification_tasks(id) ON DELETE CASCADE,
    provider TEXT NOT NULL, api_type TEXT NOT NULL, source_page INTEGER,
    http_status INTEGER, error_code TEXT, request_id TEXT, duration_ms INTEGER NOT NULL,
    cache_hit INTEGER NOT NULL DEFAULT 0, estimated_cost REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
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
  CREATE TABLE IF NOT EXISTS extraction_warnings (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    document_page_id TEXT REFERENCES document_pages(id) ON DELETE CASCADE,
    code TEXT NOT NULL,
    severity TEXT NOT NULL CHECK(severity IN ('INFO','WARNING','ERROR')),
    details_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
  );
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
  CREATE TABLE IF NOT EXISTS ocr_page_cache (
    cache_key TEXT PRIMARY KEY, content_hash TEXT NOT NULL,
    page_number INTEGER NOT NULL CHECK(page_number > 0), provider TEXT NOT NULL,
    api_type TEXT NOT NULL CHECK(api_type IN ('GENERAL','TABLE')),
    ocr_version TEXT NOT NULL, payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL, last_used_at TEXT NOT NULL,
    UNIQUE(content_hash, page_number, provider, api_type, ocr_version)
  );
  CREATE TABLE IF NOT EXISTS social_security_ocr_results (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES verification_tasks(id) ON DELETE CASCADE,
    document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    page_number INTEGER NOT NULL CHECK(page_number > 0),
    provider TEXT NOT NULL, provider_version TEXT NOT NULL,
    api_type TEXT NOT NULL CHECK(api_type IN ('GENERAL','TABLE')),
    ocr_version TEXT NOT NULL, content_hash TEXT NOT NULL,
    raw_provider_response_ref TEXT, result_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(document_id, page_number, provider, api_type, ocr_version, content_hash)
  );
  CREATE TABLE IF NOT EXISTS social_security_cell_evidence (
    id TEXT PRIMARY KEY,
    ocr_result_id TEXT NOT NULL REFERENCES social_security_ocr_results(id) ON DELETE CASCADE,
    document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    page_number INTEGER NOT NULL CHECK(page_number > 0),
    table_index INTEGER NOT NULL CHECK(table_index >= 0),
    row_index INTEGER NOT NULL CHECK(row_index >= 0),
    column_index INTEGER NOT NULL CHECK(column_index >= 0),
    source_cell_id TEXT NOT NULL, raw_value TEXT NOT NULL,
    bbox_json TEXT, polygon_json TEXT, confidence REAL,
    extraction_method TEXT NOT NULL CHECK(extraction_method = 'OCR_TABLE'),
    provider TEXT NOT NULL, provider_version TEXT NOT NULL,
    content_hash TEXT NOT NULL, ocr_version TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(ocr_result_id, table_index, row_index, column_index, source_cell_id)
  );
  CREATE INDEX IF NOT EXISTS idx_documents_task ON documents(task_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_documents_content_version ON documents(content_hash, extraction_version);
  CREATE INDEX IF NOT EXISTS idx_document_pages_document ON document_pages(document_id, page_number);
  CREATE INDEX IF NOT EXISTS idx_raw_extractions_document ON raw_extractions(document_id, document_page_id);
  CREATE INDEX IF NOT EXISTS idx_extraction_warnings_page ON extraction_warnings(document_page_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_stage_cache_lookup
    ON stage_cache(task_id, document_id, content_hash, stage, version);
  CREATE INDEX IF NOT EXISTS idx_ocr_page_cache_lookup
    ON ocr_page_cache(content_hash, page_number, provider, api_type, ocr_version);
  CREATE INDEX IF NOT EXISTS idx_social_cells_document_page
    ON social_security_cell_evidence(document_id, page_number, table_index, row_index);
`);
const columns = new Set(db.prepare("PRAGMA table_info(verification_tasks)").all().map((row) => row.name));
for (const definition of [
  "schema_version INTEGER NOT NULL DEFAULT 1",
  "task_schema_version INTEGER NOT NULL DEFAULT 1",
  "extraction_version TEXT",
  "ocr_pages INTEGER NOT NULL DEFAULT 0",
  "deepseek_calls INTEGER NOT NULL DEFAULT 0",
  "estimated_cost REAL NOT NULL DEFAULT 0",
  "review_status TEXT NOT NULL DEFAULT 'PENDING' CHECK(review_status IN ('PENDING','CONFIRMED','REJECTED'))",
  "review_note TEXT",
  "reviewed_at TEXT",
]) {
  const name = definition.split(/\s+/, 1)[0];
  if (!columns.has(name)) db.exec(`ALTER TABLE verification_tasks ADD COLUMN ${definition}`);
}
const apiCallColumns = new Set(db.prepare("PRAGMA table_info(api_calls)").all().map((row) => row.name));
if (!apiCallColumns.has("document_id")) {
  db.exec("ALTER TABLE api_calls ADD COLUMN document_id TEXT");
}
db.prepare("INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (5, ?)")
  .run(new Date().toISOString());
db.exec("COMMIT");
} catch (error) {
  if (db.inTransaction) db.exec("ROLLBACK");
  db.close();
  throw error;
}
db.close();
console.log(`Database initialized: ${path}`);
