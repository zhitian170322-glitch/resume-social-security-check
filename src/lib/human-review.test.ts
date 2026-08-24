import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { db } from "./db";
import { saveHumanReview } from "./human-review";

const SYNTHETIC_FIXTURE = true;
const taskIds: string[] = [];

function createCompletedTask() {
  const id = randomUUID();
  const now = new Date().toISOString();
  const resultJson = JSON.stringify({
    machineResult: "MANUAL_REVIEW_REQUIRED",
    synthetic: true,
  });
  db.prepare(
    `INSERT INTO verification_tasks
      (id, status, stage, result_json, created_at, updated_at, completed_at)
     VALUES (?, 'COMPLETED', 'COMPLETED', ?, ?, ?, ?)`,
  ).run(id, resultJson, now, now, now);
  taskIds.push(id);
  return { id, resultJson };
}

afterEach(() => {
  for (const id of taskIds.splice(0)) {
    db.prepare("DELETE FROM verification_tasks WHERE id = ?").run(id);
  }
});

describe("[synthetic] Human review persistence", () => {
  it.each(["CONFIRMED", "REJECTED"] as const)(
    "[synthetic] saves %s separately from machine result",
    (reviewStatus) => {
      expect(SYNTHETIC_FIXTURE).toBe(true);
      const fixture = createCompletedTask();
      const saved = saveHumanReview({
        taskId: fixture.id,
        reviewStatus,
        reviewNote: `synthetic ${reviewStatus}`,
        now: "2026-08-24T01:00:00.000Z",
      });
      expect(saved).toEqual({
        reviewStatus,
        reviewNote: `synthetic ${reviewStatus}`,
        reviewedAt: "2026-08-24T01:00:00.000Z",
      });
      expect(
        db.prepare(
          `SELECT result_json, review_status, review_note, reviewed_at
           FROM verification_tasks WHERE id = ?`,
        ).get(fixture.id),
      ).toEqual({
        result_json: fixture.resultJson,
        review_status: reviewStatus,
        review_note: `synthetic ${reviewStatus}`,
        reviewed_at: "2026-08-24T01:00:00.000Z",
      });
    },
  );
});
