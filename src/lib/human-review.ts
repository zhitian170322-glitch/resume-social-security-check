import { db } from "./db";
import type {
  HumanReview,
  HumanReviewStatus,
} from "./result-view-model";

export function saveHumanReview(input: {
  taskId: string;
  reviewStatus: HumanReviewStatus;
  reviewNote: string | null;
  now?: string;
}): HumanReview {
  const reviewedAt =
    input.reviewStatus === "PENDING"
      ? null
      : (input.now ?? new Date().toISOString());
  db.prepare(
    `UPDATE verification_tasks
     SET review_status = ?, review_note = ?, reviewed_at = ?, updated_at = ?
     WHERE id = ?`,
  ).run(
    input.reviewStatus,
    input.reviewNote,
    reviewedAt,
    input.now ?? new Date().toISOString(),
    input.taskId,
  );
  return {
    reviewStatus: input.reviewStatus,
    reviewNote: input.reviewNote,
    reviewedAt,
  };
}
