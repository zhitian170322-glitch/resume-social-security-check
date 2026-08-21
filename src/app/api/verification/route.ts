import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { fileStorage } from "@/lib/file-storage";
import { UploadError, validateTaskSize, validateUpload } from "@/lib/upload";
import { config } from "@/lib/config";
import { kickWorker } from "@/lib/worker";

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
    const validated = [
      { file: resume, kind: "RESUME" as const, data: await validateUpload(resume, "RESUME") },
    ];
    for (const file of socialFiles) {
      validated.push({
        file,
        kind: "SOCIAL_SECURITY" as const,
        data: await validateUpload(file, "SOCIAL_SECURITY"),
      });
    }
    const rows = [];
    for (const item of validated) {
      const id = randomUUID();
      const key = `${taskId}/${id}${item.data.extension}`;
      await fileStorage.save(key, item.data.buffer);
      savedKeys.push(key);
      rows.push({ id, key, ...item });
    }
    db.transaction(() => {
      db.prepare(
        `INSERT INTO verification_tasks
          (id, status, stage, created_at, updated_at)
         VALUES (?, 'PENDING', 'FILES_SAVED', ?, ?)`,
      ).run(taskId, now.toISOString(), now.toISOString());
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
