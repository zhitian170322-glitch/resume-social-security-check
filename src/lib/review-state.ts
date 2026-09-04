import type { FieldOverride } from "./manual-override";
import type { RecruiterRowStatus } from "./result-view-model";

type OverallConclusion = "PASS" | "FAIL" | "NEEDS_REVIEW";

export type FieldOrigin = "system" | "needs_review" | "confirmed" | "corrected";

export type ConclusionSource =
  | "system_pass"
  | "confirmed_pass"
  | "corrected_pass"
  | "fail"
  | "needs_review";

export type ManualLink = {
  id: string;
  resumeSourceId: string;
  socialSourceId: string;
  reviewStatus: "applied" | "reverted";
  updatedAt: string;
};

export type ReviewAuditEntry = {
  at: string;
  action: "confirm" | "correct" | "revert" | "relink" | "unlink" | "lock" | "unlock";
  field?: string;
  before?: string | null;
  after?: string | null;
  rowIndex?: number;
};

export type ReviewLock = {
  locked: boolean;
  lockedAt: string | null;
  unlockedAt?: string | null;
};

export type ReviewProgress = {
  pendingFieldCount: number;
  confirmedFieldCount: number;
  correctedFieldCount: number;
};

export function fieldOriginFromOverride(
  override: FieldOverride | undefined,
  systemNeedsReview: boolean,
): FieldOrigin {
  if (!override || override.reviewStatus !== "applied") {
    return systemNeedsReview ? "needs_review" : "system";
  }
  if (override.kind === "confirm") return "confirmed";
  return "corrected";
}

export function fieldOriginLabel(origin: FieldOrigin): string {
  if (origin === "confirmed") return "人工已确认";
  if (origin === "corrected") return "人工已修正";
  if (origin === "needs_review") return "待人工确认";
  return "系统识别";
}

export function conclusionSource(input: {
  overall: OverallConclusion;
  overrides?: FieldOverride[];
}): ConclusionSource {
  if (input.overall === "FAIL") return "fail";
  if (input.overall === "NEEDS_REVIEW") return "needs_review";
  const applied = (input.overrides ?? []).filter((item) => item.reviewStatus === "applied");
  if (applied.some((item) => item.kind !== "confirm")) return "corrected_pass";
  if (applied.some((item) => item.kind === "confirm")) return "confirmed_pass";
  return "system_pass";
}

export function conclusionSourceLabel(source: ConclusionSource): string {
  if (source === "system_pass") return "系统核验通过";
  if (source === "confirmed_pass") return "人工确认后通过";
  if (source === "corrected_pass") return "人工修正后通过";
  if (source === "fail") return "核验不通过";
  return "待人工确认";
}

export function computeReviewProgress(input: {
  rows: Array<{ status: string }>;
  overrides?: FieldOverride[];
}): ReviewProgress {
  const applied = (input.overrides ?? []).filter((item) => item.reviewStatus === "applied");
  const correctedFieldCount = applied.filter((item) => item.kind !== "confirm").length;
  const confirmedFieldCount = applied.filter((item) => item.kind === "confirm").length;
  const pendingFieldCount = input.rows.reduce((count, row) => {
    if (row.status === "PASS" || row.status === "FAIL") return count;
    return count + 1;
  }, 0);
  return { pendingFieldCount, confirmedFieldCount, correctedFieldCount };
}

export function canLockReview(input: {
  overall: OverallConclusion;
  pendingFieldCount: number;
}): { ok: true } | { ok: false; message: string } {
  if (input.pendingFieldCount > 0 || input.overall === "NEEDS_REVIEW") {
    return { ok: false, message: "仍有待确认字段，不能锁定为通过" };
  }
  return { ok: true };
}

export function rowNeedsManualLink(status: RecruiterRowStatus) {
  return status === "RESUME_ONLY" || status === "SOCIAL_ONLY" || status === "NEEDS_REVIEW";
}

export function occupiedSocialIds(
  links: ManualLink[],
  exceptResumeId?: string,
): Set<string> {
  return new Set(
    links
      .filter(
        (link) =>
          link.reviewStatus === "applied" &&
          (!exceptResumeId || link.resumeSourceId !== exceptResumeId),
      )
      .map((link) => link.socialSourceId),
  );
}
