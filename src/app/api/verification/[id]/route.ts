import { NextResponse } from "next/server";
import { db, type TaskRow } from "@/lib/db";
import { fileStorage } from "@/lib/file-storage";
import { kickWorker } from "@/lib/worker";
import { EVIDENCE_TASK_SCHEMA_VERSION } from "@/lib/document-extraction";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const task = db.prepare("SELECT * FROM verification_tasks WHERE id = ?").get(id) as
    | TaskRow
    | undefined;
  if (!task) return NextResponse.json({ message: "记录不存在" }, { status: 404 });
  return NextResponse.json({
    id: task.id,
    status: task.status,
    stage: task.stage,
    candidateName: task.candidate_name,
    estimatedOCRCalls: task.estimated_ocr_calls,
    errorCode: task.error_code,
    errorMessage: task.error_message,
    result: task.result_json ? JSON.parse(task.result_json) : null,
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
  const body = (await request.json()) as { paidOverride?: boolean; retry?: boolean };
  const task = db.prepare("SELECT * FROM verification_tasks WHERE id = ?").get(id) as
    | TaskRow
    | undefined;
  if (!task) return NextResponse.json({ message: "记录不存在" }, { status: 404 });
  if (
    task.task_schema_version < EVIDENCE_TASK_SCHEMA_VERSION ||
    !task.extraction_version
  ) {
    return NextResponse.json(
      { message: "旧版本任务不能进入新版提取流程，请创建新任务" },
      { status: 409 },
    );
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
