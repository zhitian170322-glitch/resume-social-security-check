import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { fileStorage } from "@/lib/file-storage";
import { UploadError, validateTaskSize, validateUpload } from "@/lib/upload";
import { config } from "@/lib/config";
import { kickWorker } from "@/lib/worker";
import {
  DOCUMENT_EXTRACTION_VERSION,
  EVIDENCE_TASK_SCHEMA_VERSION,
  registerDocument,
} from "@/lib/document-extraction";
import { contentHash } from "@/lib/stage-cache";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const savedKeys: string[] = [];
  try {
    const form = await request.formData();
    const resume = form.get("resume");
    const socials = form.getAll("socialSecurity");
    if (!(resume instanceof File) || socials.length === 0 || socials.some((f) => !(f instanceof File))) {
      return NextResponse.json(
        { code: "INVALID_FILE_TYPE", message: "请上传一份简历和至少一份社保材料" },
        { status: 400 },
      );
    }
    const socialFiles = socials as File[];
    validateTaskSize([resume, ...socialFiles]);
    const taskId = randomUUID();
    const now = new Date();
    const expiresAt = new Date(
      now.getTime() + config.RAW_FILE_RETENTION_DAYS * 86_400_000,
    ).toISOString();
    const validated: Array<{
      file: File;
      kind: "RESUME" | "SOCIAL_SECURITY";
      data: Awaited<ReturnType<typeof validateUpload>>;
    }> = [
      { file: resume, kind: "RESUME" as const, data: await validateUpload(resume, "RESUME") },
    ];
    for (const file of socialFiles) {
      validated.push({
        file,
        kind: "SOCIAL_SECURITY" as const,
        data: await validateUpload(file, "SOCIAL_SECURITY"),
      });
    }
    const rows: Array<
      (typeof validated)[number] & {
        id: string;
        documentId: string;
        key: string;
      }
    > = [];
    for (const item of validated) {
      const id = randomUUID();
      const key = `${taskId}/${id}${item.data.extension}`;
      await fileStorage.save(key, item.data.buffer);
      savedKeys.push(key);
      rows.push({ id, documentId: randomUUID(), key, ...item });
    }
    db.transaction(() => {
      db.prepare(
        `INSERT INTO verification_tasks
          (id, status, stage, schema_version, task_schema_version,
           extraction_version, created_at, updated_at)
         VALUES (?, 'PENDING', 'FILES_SAVED', ?, ?, ?, ?, ?)`,
      ).run(
        taskId,
        EVIDENCE_TASK_SCHEMA_VERSION,
        EVIDENCE_TASK_SCHEMA_VERSION,
        DOCUMENT_EXTRACTION_VERSION,
        now.toISOString(),
        now.toISOString(),
      );
      const insert = db.prepare(
        `INSERT INTO task_files
          (id, task_id, kind, original_name, storage_key, mime_type, size, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const row of rows) {
        insert.run(
          row.id,
          taskId,
          row.kind,
          row.file.name,
          row.key,
          row.data.mime,
          row.file.size,
          now.toISOString(),
          expiresAt,
        );
        registerDocument({
          id: row.documentId,
          taskId,
          taskFileId: row.id,
          kind: row.kind,
          originalName: row.file.name,
          mimeType: row.data.mime,
          contentHash: contentHash(row.data.buffer),
          extractionVersion: DOCUMENT_EXTRACTION_VERSION,
          createdAt: now.toISOString(),
        });
      }
    })();
    kickWorker();
    return NextResponse.json({ taskId }, { status: 202 });
  } catch (error) {
    await Promise.all(savedKeys.map((key) => fileStorage.delete(key)));
    const known = error instanceof UploadError;
    return NextResponse.json(
      {
        code: known ? error.code : "VERIFICATION_FAILED",
        message: known ? error.message : "创建核验任务失败",
      },
      { status: known ? 400 : 500 },
    );
  }
}
