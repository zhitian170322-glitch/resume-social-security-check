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
} from "@/lib/manual-override";
import { buildPaidMonthDetails, monthDetailsText } from "@/lib/month-details";
import {
  verifyResumeAndSocial,
  type SimpleVerificationReport,
} from "@/lib/simple-verification";

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
    resultObject?.schemaVersion === 4 || resultObject?.schemaVersion === 5
      ? null
      : latestArtifactPayload<Phase8VerificationResult>(
          task.id,
          "VERIFICATION_COMPLETE",
        );
  const derivedFacts =
    resultObject?.schemaVersion === 4 || resultObject?.schemaVersion === 5
      ? null
      : latestArtifactPayload<DerivedFactsPayload>(
          task.id,
          "DERIVED_FACTS",
        );
  const validationStage =
    resultObject?.schemaVersion === 4 || resultObject?.schemaVersion === 5
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
    reviewStatus?: "PENDING" | "CONFIRMED" | "REJECTED";
    reviewNote?: string;
    manualOverride?: {
      id: string;
      rowIndex: number;
      field:
        | "resumeCompany"
        | "socialCompany"
        | "position"
        | "startMonth"
        | "endMonth"
        | "paymentType"
        | "unitCompany";
      originalValue: string | null;
      systemValue: string | null;
      overrideValue: string | null;
    };
    revertOverrideId?: string;
  };
  const task = db.prepare("SELECT * FROM verification_tasks WHERE id = ?").get(id) as
    | TaskRow
    | undefined;
  if (!task) return NextResponse.json({ message: "记录不存在" }, { status: 404 });
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
  if (body.manualOverride || body.revertOverrideId) {
    if (task.status !== "COMPLETED") {
      return NextResponse.json({ message: "任务完成后才能人工修正" }, { status: 409 });
    }
    const result = parseJson(task.result_json) as SimpleVerificationReport | null;
    if (!result?.systemExtracted || result.schemaVersion !== 5) {
      return NextResponse.json(
        { message: "当前结果无法安全持久化人工修正，未改写数据库结构" },
        { status: 409 },
      );
    }
    const currentOverrides = (result.fieldOverrides ?? []) as FieldOverride[];
    const currentRow = result.rows[body.manualOverride?.rowIndex ?? -1];
    const targetId = body.manualOverride
      ? isResumeOverrideField(body.manualOverride.field)
        ? currentRow?.resume?.sourceId
        : currentRow?.social?.sourceId
      : undefined;
    const nextOverrides = body.revertOverrideId
      ? revertOverride(currentOverrides, body.revertOverrideId)
      : upsertOverride(currentOverrides, {
          ...body.manualOverride!,
          targetId,
          reviewStatus: "applied",
        });
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
    });
    const monthDetails = buildPaidMonthDetails(
      applied.socialRecords,
      nextOverrides.some((entry) => entry.reviewStatus === "applied")
        ? "manual"
        : "system",
    );
    const saved = {
      ...next,
      monthDetails,
      monthDetailsText: monthDetailsText(monthDetails),
      fieldOverrides: nextOverrides,
      systemExtracted: result.systemExtracted,
    };
    const now = new Date().toISOString();
    db.prepare(
      `UPDATE verification_tasks SET result_json = ?, updated_at = ? WHERE id = ?`,
    ).run(JSON.stringify(saved), now, id);
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
