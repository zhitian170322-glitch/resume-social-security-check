import { NextResponse } from "next/server";
import { db, type TaskRow } from "@/lib/db";
import { fileStorage } from "@/lib/file-storage";
import { kickWorker } from "@/lib/worker";
import { EVIDENCE_TASK_SCHEMA_VERSION } from "@/lib/document-extraction";
import {
  buildResultViewModel,
  readStoredArtifactPayload,
  type HumanReview,
  type TableCellDisplay,
} from "@/lib/result-view-model";
import type { Phase8VerificationResult } from "@/lib/verification-engine-phase8";
import type {
  DerivedFactsPayload,
  EvidenceValidationStagePayload,
} from "@/lib/worker-pipeline-integration";
import { saveHumanReview } from "@/lib/human-review";
import {
  applyFieldOverrides,
  isResumeOverrideField,
  revertOverride,
  upsertOverride,
  type FieldOverride,
  type OverrideField,
} from "@/lib/manual-override";
import { buildPaidMonthDetails, monthDetailsText } from "@/lib/month-details";
import { assertMonthRange } from "@/lib/month-input";
import {
  canLockReview,
  occupiedSocialIds,
  type ManualLink,
  type ReviewAuditEntry,
} from "@/lib/review-state";
import {
  verifyResumeAndSocial,
  type SimpleVerificationReport,
} from "@/lib/simple-verification";
import { canCancelTask, readCancelState } from "@/lib/task-lifecycle";

export const runtime = "nodejs";

function parseJson(value: string | null) {
  if (!value) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function latestArtifactPayload<T>(taskId: string, stage: string) {
  const row = db
    .prepare(
      `SELECT payload_json FROM task_stage_artifacts
       WHERE task_id = ? AND stage = ?
       ORDER BY updated_at DESC LIMIT 1`,
    )
    .get(taskId, stage) as { payload_json: string } | undefined;
  return readStoredArtifactPayload<T>(row?.payload_json ?? null);
}

function tableCellEvidence(taskId: string): TableCellDisplay[] {
  const rows = db
    .prepare(
      `SELECT cells.id, documents.original_name AS source_file,
              cells.page_number, cells.table_index, cells.row_index,
              cells.column_index, cells.raw_value, cells.bbox_json,
              cells.confidence
       FROM social_security_cell_evidence cells
       JOIN documents ON documents.id = cells.document_id
       WHERE documents.task_id = ?
       ORDER BY cells.page_number, cells.table_index,
                cells.row_index, cells.column_index`,
    )
    .all(taskId) as Array<{
    id: string;
    source_file: string;
    page_number: number;
    table_index: number;
    row_index: number;
    column_index: number;
    raw_value: string;
    bbox_json: string | null;
    confidence: number | null;
  }>;
  return rows.map((row) => ({
    id: row.id,
    sourceFile: row.source_file,
    page: row.page_number,
    tableIndex: row.table_index,
    rowIndex: row.row_index,
    columnIndex: row.column_index,
    rawValue: row.raw_value,
    bbox: parseJson(row.bbox_json),
    confidence: row.confidence,
  }));
}

function humanReview(task: TaskRow): HumanReview {
  return {
    reviewStatus: task.review_status ?? "PENDING",
    reviewNote: task.review_note,
    reviewedAt: task.reviewed_at,
  };
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const task = db.prepare("SELECT * FROM verification_tasks WHERE id = ?").get(id) as
    | TaskRow
    | undefined;
  if (!task) return NextResponse.json({ message: "记录不存在" }, { status: 404 });
  const result = parseJson(task.result_json);
  const resultObject =
    result && typeof result === "object" ? (result as { schemaVersion?: number }) : null;
  const verification =
    resultObject?.schemaVersion === 4 ||
    resultObject?.schemaVersion === 5 ||
    resultObject?.schemaVersion === 6 ||
    resultObject?.schemaVersion === 7
      ? null
      : latestArtifactPayload<Phase8VerificationResult>(
          task.id,
          "VERIFICATION_COMPLETE",
        );
  const derivedFacts =
    resultObject?.schemaVersion === 4 ||
    resultObject?.schemaVersion === 5 ||
    resultObject?.schemaVersion === 6 ||
    resultObject?.schemaVersion === 7
      ? null
      : latestArtifactPayload<DerivedFactsPayload>(
          task.id,
          "DERIVED_FACTS",
        );
  const validationStage =
    resultObject?.schemaVersion === 4 ||
    resultObject?.schemaVersion === 5 ||
    resultObject?.schemaVersion === 6 ||
    resultObject?.schemaVersion === 7
      ? null
      : latestArtifactPayload<EvidenceValidationStagePayload>(
          task.id,
          "EVIDENCE_VALIDATED",
        );
  const review = humanReview(task);
  return NextResponse.json({
    id: task.id,
    status: task.status,
    stage: task.stage,
    candidateName: task.candidate_name,
    estimatedOCRCalls: task.estimated_ocr_calls,
    errorCode: task.error_code,
    errorMessage: task.error_message,
    result,
    resultView: buildResultViewModel({
      taskSchemaVersion: task.task_schema_version,
      result,
      verification,
      derivedFacts,
      validationStage,
      humanReview: review,
      tableCells: tableCellEvidence(task.id),
    }),
    humanReview: review,
    createdAt: task.created_at,
    completedAt: task.completed_at,
    taskSchemaVersion: task.task_schema_version,
    extractionVersion: task.extraction_version,
    cancelState: task.cancel_state ?? "none",
    reviewLocked: Boolean(task.review_locked),
  });
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const body = (await request.json()) as {
    paidOverride?: boolean;
    retry?: boolean;
    cancel?: boolean;
    lockReview?: boolean;
    unlockReview?: boolean;
    confirmFields?: { rowIndex: number; fields: OverrideField[] };
    relink?: { resumeSourceId: string; socialSourceId: string };
    unlink?: { resumeSourceId: string };
    reviewStatus?: "PENDING" | "CONFIRMED" | "REJECTED";
    reviewNote?: string;
    manualOverride?: {
      id: string;
      rowIndex: number;
      field: OverrideField;
      originalValue: string | null;
      systemValue: string | null;
      overrideValue: string | null;
      kind?: "confirm" | "correct";
    };
    revertOverrideId?: string;
  };
  const task = db.prepare("SELECT * FROM verification_tasks WHERE id = ?").get(id) as
    | TaskRow
    | undefined;
  if (!task) return NextResponse.json({ message: "记录不存在" }, { status: 404 });

  if (body.cancel === true) {
    const now = new Date().toISOString();
    const current = readCancelState(task.cancel_state);
    if (current === "cancelled" || task.error_code === "CANCELLED") {
      return NextResponse.json({ accepted: true, status: "cancelled", idempotent: true });
    }
    if (!canCancelTask({ status: task.status, cancelState: task.cancel_state, errorCode: task.error_code })) {
      return NextResponse.json({ message: "已完成任务不能终止" }, { status: 409 });
    }
    const changed = db
      .prepare(
        `UPDATE verification_tasks
         SET cancel_state = 'cancel_requested', updated_at = ?
         WHERE id = ? AND cancel_state = 'none' AND status IN ('PENDING','PROCESSING')`,
      )
      .run(now, id);
    if (task.status === "PENDING" && changed.changes) {
      db.prepare(
        `UPDATE verification_tasks
         SET status = 'FAILED', stage = 'CANCELLED', error_code = 'CANCELLED',
             error_message = '识别已终止', cancel_state = 'cancelled', updated_at = ?
         WHERE id = ? AND cancel_state = 'cancel_requested'`,
      ).run(now, id);
    }
    return NextResponse.json({ accepted: true, status: "cancel_requested" });
  }

  if (body.reviewStatus !== undefined) {
    if (
      body.paidOverride !== undefined ||
      body.retry !== undefined ||
      !["PENDING", "CONFIRMED", "REJECTED"].includes(body.reviewStatus)
    ) {
      return NextResponse.json({ message: "人工复核请求无效" }, { status: 400 });
    }
    if (task.status !== "COMPLETED") {
      return NextResponse.json(
        { message: "任务完成后才能提交人工复核" },
        { status: 409 },
      );
    }
    const note = body.reviewNote?.trim() || null;
    if (note && note.length > 2000) {
      return NextResponse.json(
        { message: "复核备注不能超过 2000 字" },
        { status: 400 },
      );
    }
    const savedReview = saveHumanReview({
      taskId: id,
      reviewStatus: body.reviewStatus,
      reviewNote: note,
    });
    return NextResponse.json({
      humanReview: savedReview,
      machineResultUnchanged: true,
    });
  }
  if (
    task.task_schema_version < EVIDENCE_TASK_SCHEMA_VERSION ||
    !task.extraction_version
  ) {
    return NextResponse.json(
      { message: "旧版本任务不能进入新版提取流程，请创建新任务" },
      { status: 409 },
    );
  }
  const writableSchema =
    (parseJson(task.result_json) as SimpleVerificationReport | null)?.schemaVersion;
  const canPersistReview =
    writableSchema === 5 || writableSchema === 6 || writableSchema === 7;

  function saveReviewedResult(
    result: SimpleVerificationReport,
    nextOverrides: FieldOverride[],
    manualLinks: ManualLink[],
    audit: ReviewAuditEntry[],
    lock = result.reviewLock,
  ) {
    if (!result.systemExtracted) {
      throw new Error("MISSING_SYSTEM_EXTRACTED");
    }
    const applied = applyFieldOverrides({
      experiences: result.systemExtracted.experiences,
      socialRecords: result.systemExtracted.socialRecords,
      overrides: nextOverrides,
    });
    const next = verifyResumeAndSocial({
      candidateName: result.systemExtracted.candidateName,
      socialName: result.systemExtracted.socialName,
      experiences: applied.experiences,
      socialRecords: applied.socialRecords,
      duplicateNotice: result.systemExtracted.duplicateNotice,
      overrides: nextOverrides,
      sourceConflicts: result.sourceConflicts,
      hasUnconfirmedFields: result.hasUnconfirmedFields,
      manualLinks,
      reviewLock: lock,
      reviewAudit: audit,
    });
    const monthDetails = buildPaidMonthDetails(
      applied.socialRecords,
      nextOverrides.some((entry) => entry.reviewStatus === "applied")
        ? "manual"
        : "system",
    );
    return {
      ...next,
      schemaVersion:
        result.schemaVersion === 5 ? 5 : result.schemaVersion === 6 ? 6 : next.schemaVersion,
      pipeline:
        result.schemaVersion === 5
          ? "simple-v5"
          : result.schemaVersion === 6
            ? "simple-v6"
            : next.pipeline,
      monthDetails,
      monthDetailsText: monthDetailsText(monthDetails),
      fieldOverrides: nextOverrides,
      systemExtracted: result.systemExtracted,
      reviewLock: lock,
      manualLinks,
      reviewAudit: audit,
    } satisfies SimpleVerificationReport;
  }

  if (
    body.lockReview ||
    body.unlockReview ||
    body.confirmFields ||
    body.relink ||
    body.unlink ||
    body.manualOverride ||
    body.revertOverrideId
  ) {
    if (task.status !== "COMPLETED") {
      return NextResponse.json({ message: "任务完成后才能人工复核" }, { status: 409 });
    }
    const result = parseJson(task.result_json) as SimpleVerificationReport | null;
    if (result && !result.systemExtracted && result.schemaVersion === 7) {
      result.systemExtracted = {
        candidateName: result.candidateName,
        experiences: result.experiences,
        socialRecords: result.socialRecords,
        socialName: result.socialName ?? null,
        duplicateNotice: result.duplicateNotice ?? null,
      };
    }
    if (!result?.systemExtracted || !canPersistReview) {
      return NextResponse.json(
        { message: "当前结果无法安全持久化人工修正，未改写数据库结构" },
        { status: 409 },
      );
    }
    if (result.reviewLock?.locked && !body.unlockReview) {
      return NextResponse.json({ message: "结果已锁定，请先解除锁定" }, { status: 409 });
    }
    const now = new Date().toISOString();
    let nextOverrides = (result.fieldOverrides ?? []) as FieldOverride[];
    let manualLinks = (result.manualLinks ?? []) as ManualLink[];
    const audit = [...(result.reviewAudit ?? [])];
    let lock = result.reviewLock ?? { locked: false, lockedAt: null };

    if (body.unlockReview) {
      lock = { locked: false, lockedAt: lock.lockedAt, unlockedAt: now };
      audit.push({ at: now, action: "unlock" });
      db.prepare(
        `UPDATE verification_tasks SET review_locked = 0, review_locked_at = ?, updated_at = ? WHERE id = ?`,
      ).run(now, now, id);
    } else if (body.lockReview) {
      const progress = result.reviewProgress ?? {
        pendingFieldCount: result.rows.filter((row) => row.status === "NEEDS_REVIEW").length,
        confirmedFieldCount: 0,
        correctedFieldCount: 0,
      };
      const allowed = canLockReview({
        overall: result.overallConclusion,
        pendingFieldCount: progress.pendingFieldCount,
      });
      if (!allowed.ok) {
        return NextResponse.json({ message: allowed.message }, { status: 409 });
      }
      lock = { locked: true, lockedAt: now };
      audit.push({ at: now, action: "lock" });
      db.prepare(
        `UPDATE verification_tasks SET review_locked = 1, review_locked_at = ?, updated_at = ? WHERE id = ?`,
      ).run(now, now, id);
    } else if (body.relink) {
      const used = occupiedSocialIds(manualLinks, body.relink.resumeSourceId);
      if (used.has(body.relink.socialSourceId)) {
        return NextResponse.json(
          { message: "该社保记录已被其他经历关联，禁止无提示重复关联" },
          { status: 409 },
        );
      }
      manualLinks = [
        ...manualLinks.filter(
          (link) =>
            link.resumeSourceId !== body.relink!.resumeSourceId &&
            link.socialSourceId !== body.relink!.socialSourceId,
        ),
        {
          id: `link-${body.relink.resumeSourceId}-${body.relink.socialSourceId}`,
          resumeSourceId: body.relink.resumeSourceId,
          socialSourceId: body.relink.socialSourceId,
          reviewStatus: "applied",
          updatedAt: now,
        },
      ];
      audit.push({
        at: now,
        action: "relink",
        before: null,
        after: body.relink.socialSourceId,
      });
    } else if (body.unlink) {
      manualLinks = manualLinks.map((link) =>
        link.resumeSourceId === body.unlink!.resumeSourceId && link.reviewStatus === "applied"
          ? { ...link, reviewStatus: "reverted", updatedAt: now }
          : link,
      );
      audit.push({ at: now, action: "unlink", before: body.unlink.resumeSourceId });
    } else if (body.confirmFields) {
      const row = result.rows[body.confirmFields.rowIndex];
      for (const field of body.confirmFields.fields) {
        const systemValue =
          field === "resumeCompany"
            ? row?.resume?.companyRaw ?? null
            : field === "socialCompany"
              ? row?.social?.companyRaw ?? null
              : field === "resumeStartMonth" || field === "startMonth"
                ? row?.resume?.startMonth ?? null
                : field === "resumeEndMonth" || field === "endMonth"
                  ? row?.resume?.endMonth ?? null
                  : field === "socialStartMonth"
                    ? row?.social?.startMonth ?? null
                    : field === "socialEndMonth"
                      ? row?.social?.endMonth ?? null
                      : null;
        nextOverrides = upsertOverride(nextOverrides, {
          id: `confirm-${body.confirmFields.rowIndex}-${field}`,
          rowIndex: body.confirmFields.rowIndex,
          targetId: isResumeOverrideField(field)
            ? row?.resume?.sourceId
            : row?.social?.sourceId,
          field,
          originalValue: systemValue,
          systemValue,
          overrideValue: systemValue,
          kind: "confirm",
        });
        audit.push({
          at: now,
          action: "confirm",
          field,
          before: systemValue,
          after: systemValue,
          rowIndex: body.confirmFields.rowIndex,
        });
      }
    } else if (body.revertOverrideId) {
      const previous = nextOverrides.find((item) => item.id === body.revertOverrideId);
      nextOverrides = revertOverride(nextOverrides, body.revertOverrideId);
      audit.push({
        at: now,
        action: "revert",
        field: previous?.field,
        before: previous?.overrideValue,
        after: previous?.systemValue,
        rowIndex: previous?.rowIndex,
      });
    } else if (body.manualOverride) {
      const monthCheck = assertMonthRange(
        body.manualOverride.field.endsWith("StartMonth") ||
          body.manualOverride.field === "startMonth"
          ? body.manualOverride.overrideValue
          : null,
        body.manualOverride.field.endsWith("EndMonth") ||
          body.manualOverride.field === "endMonth"
          ? body.manualOverride.overrideValue
          : null,
      );
      if (
        (body.manualOverride.field.includes("Month") ||
          body.manualOverride.field === "startMonth" ||
          body.manualOverride.field === "endMonth") &&
        body.manualOverride.overrideValue &&
        !monthCheck.ok
      ) {
        return NextResponse.json({ message: monthCheck.message }, { status: 400 });
      }
      const currentRow = result.rows[body.manualOverride.rowIndex];
      const targetId = isResumeOverrideField(body.manualOverride.field)
        ? currentRow?.resume?.sourceId
        : currentRow?.social?.sourceId;
      nextOverrides = upsertOverride(nextOverrides, {
        ...body.manualOverride,
        targetId,
        kind: body.manualOverride.kind ?? "correct",
        reviewStatus: "applied",
      });
      audit.push({
        at: now,
        action: "correct",
        field: body.manualOverride.field,
        before: body.manualOverride.systemValue,
        after: body.manualOverride.overrideValue,
        rowIndex: body.manualOverride.rowIndex,
      });
    }

    const saved = db.transaction(() => {
      const next = saveReviewedResult(result, nextOverrides, manualLinks, audit, lock);
      db.prepare(
        `UPDATE verification_tasks SET result_json = ?, updated_at = ? WHERE id = ?`,
      ).run(JSON.stringify(next), now, id);
      return next;
    })();
    return NextResponse.json({ accepted: true, result: saved });
  }
  if (body.retry === true && task.status === "FAILED") {
    db.prepare(
      `UPDATE verification_tasks
       SET status = 'PENDING', stage = 'FILES_SAVED', error_code = NULL, error_message = NULL,
           updated_at = ?
       WHERE id = ?`,
    ).run(new Date().toISOString(), id);
    kickWorker();
    return NextResponse.json({ accepted: true, resumeFromCache: true });
  }
  if (task.stage !== "AWAITING_OCR_CONFIRMATION" || body.paidOverride !== true) {
    return NextResponse.json({ message: "当前任务不接受此操作" }, { status: 409 });
  }
  db.prepare(
    `UPDATE verification_tasks
     SET paid_override = 1, stage = 'FILES_SAVED', error_code = NULL, error_message = NULL,
         updated_at = ?
     WHERE id = ?`,
  ).run(new Date().toISOString(), id);
  kickWorker();
  return NextResponse.json({ accepted: true });
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const files = db
    .prepare("SELECT storage_key FROM task_files WHERE task_id = ?")
    .all(id) as Array<{ storage_key: string }>;
  const deleted = db.prepare("DELETE FROM verification_tasks WHERE id = ?").run(id);
  if (!deleted.changes) return NextResponse.json({ message: "记录不存在" }, { status: 404 });
  await Promise.all(files.map((file) => fileStorage.delete(file.storage_key)));
  return new NextResponse(null, { status: 204 });
}
