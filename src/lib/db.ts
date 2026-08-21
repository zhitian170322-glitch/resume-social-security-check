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

export function initializeDatabase() {
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
  `);
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
};
