import Database from "better-sqlite3";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const exec = promisify(execFile);
let directory = "";

afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
});

describe("forward-only database migration", () => {
  it("preserves a V1 task while adding evidence cache tables", async () => {
    directory = await mkdtemp(join(tmpdir(), "verification-migration-"));
    const path = join(directory, "app.db");
    const db = new Database(path);
    db.exec(`
      CREATE TABLE verification_tasks (
        id TEXT PRIMARY KEY, status TEXT NOT NULL, stage TEXT NOT NULL,
        candidate_name TEXT, paid_override INTEGER NOT NULL DEFAULT 0,
        estimated_ocr_calls INTEGER NOT NULL DEFAULT 0, error_code TEXT, error_message TEXT,
        resume_json TEXT, social_security_json TEXT, result_json TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, completed_at TEXT
      );
    `);
    db.prepare(
      `INSERT INTO verification_tasks
       (id,status,stage,candidate_name,created_at,updated_at)
       VALUES ('old-task','COMPLETED','COMPLETED','旧候选人','2024-01-01','2024-01-01')`,
    ).run();
    db.close();
    await exec("node", [resolve("scripts/init-db.mjs")], {
      env: { ...process.env, DATABASE_URL: `file:${path}` },
    });
    const migrated = new Database(path);
    expect(
      migrated.prepare("SELECT candidate_name FROM verification_tasks WHERE id='old-task'").get(),
    ).toEqual({ candidate_name: "旧候选人" });
    expect(
      migrated
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='task_stage_artifacts'")
        .get(),
    ).toBeTruthy();
    expect(
      migrated.prepare("SELECT schema_version FROM verification_tasks WHERE id='old-task'").get(),
    ).toEqual({ schema_version: 1 });
    migrated.close();
  });
});
