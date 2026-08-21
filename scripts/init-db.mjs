import Database from "better-sqlite3";
import { dirname, resolve } from "node:path";
import { mkdirSync } from "node:fs";

const path = resolve((process.env.DATABASE_URL || "file:./data/app.db").replace(/^file:/, ""));
mkdirSync(dirname(path), { recursive: true });
const db = new Database(path);
db.pragma("journal_mode = WAL");
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
`);
db.close();
console.log(`Database initialized: ${path}`);
