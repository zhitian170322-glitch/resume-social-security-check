import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

let directory = "";
const originalDatabaseUrl = process.env.DATABASE_URL;

afterEach(async () => {
  vi.resetModules();
  if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalDatabaseUrl;
  if (directory) await rm(directory, { recursive: true, force: true });
  directory = "";
});

describe("Document Extraction Layer", () => {
  it("persists raw page text byte-for-byte and reuses the versioned stage cache", async () => {
    directory = await mkdtemp(join(tmpdir(), "document-extraction-"));
    process.env.DATABASE_URL = `file:${join(directory, "app.db")}`;
    vi.resetModules();

    const { db } = await import("./db");
    const {
      DOCUMENT_EXTRACTION_VERSION,
      EVIDENCE_TASK_SCHEMA_VERSION,
      extractPdfDocument,
      registerDocument,
    } = await import("./document-extraction");
    const { contentHash } = await import("./stage-cache");
    const { isEvidencePipelineTask } = await import("./worker");

    const taskId = "new-task";
    const fileId = "file-1";
    const documentId = "document-1";
    const createdAt = "2026-08-24T10:00:00.000Z";
    const fileBytes = Buffer.from("fake-pdf-content");
    const fileContentHash = contentHash(fileBytes);
    const rawText =
      "  候选人工作经历\r\n2022.03-2024.05  深圳市腾讯科技有限公司\t\r\n负责系统研发、测试、发布以及线上维护工作\r\n尾随空格  \n";

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
      createdAt,
      createdAt,
    );
    db.prepare(
      `INSERT INTO task_files
        (id, task_id, kind, original_name, storage_key, mime_type, size,
         created_at, expires_at)
       VALUES (?, ?, 'RESUME', 'resume.pdf', 'task/resume.pdf',
               'application/pdf', ?, ?, ?)`,
    ).run(fileId, taskId, fileBytes.length, createdAt, createdAt);
    registerDocument({
      id: documentId,
      taskId,
      taskFileId: fileId,
      kind: "RESUME",
      originalName: "resume.pdf",
      mimeType: "application/pdf",
      contentHash: fileContentHash,
      createdAt,
    });

    let extractionCalls = 0;
    const extractor = async () => {
      extractionCalls += 1;
      return {
        pages: [
          {
            page: 1,
            localText: rawText,
            qualityScore: 100,
            warnings: [],
            ocrRecommended: false,
          },
        ],
        estimatedOCRCalls: 0,
      };
    };
    const input = {
      taskId,
      documentId,
      path: join(directory, "unused.pdf"),
      contentHash: fileContentHash,
    };
    const first = await extractPdfDocument(input, extractor);
    const second = await extractPdfDocument(input, extractor);

    expect(first.cacheHit).toBe(false);
    expect(second.cacheHit).toBe(true);
    expect(extractionCalls).toBe(1);

    const page = db
      .prepare(
        `SELECT pdf_text, ocr_text, extraction_method, content_hash
         FROM document_pages WHERE document_id = ? AND page_number = 1`,
      )
      .get(documentId) as {
      pdf_text: string;
      ocr_text: string | null;
      extraction_method: string;
      content_hash: string;
    };
    const raw = db
      .prepare(
        `SELECT raw_text FROM raw_extractions
         WHERE document_id = ? AND extraction_method = 'PDF_TEXT'`,
      )
      .get(documentId) as { raw_text: string };

    expect(Buffer.from(page.pdf_text, "utf8")).toEqual(
      Buffer.from(rawText, "utf8"),
    );
    expect(Buffer.from(raw.raw_text, "utf8")).toEqual(
      Buffer.from(rawText, "utf8"),
    );
    expect(page.ocr_text).toBeNull();
    expect(page.extraction_method).toBe("PDF_TEXT");
    expect(page.content_hash).toBe(contentHash(rawText));
    expect(
      db
        .prepare(
          `SELECT stage FROM stage_cache
           WHERE task_id = ? AND document_id = ? ORDER BY stage`,
        )
        .all(taskId, documentId),
    ).toEqual([
      { stage: "DOCUMENT_INGESTED" },
      { stage: "PDF_EXTRACTED" },
      { stage: "QUALITY_EVALUATED" },
    ]);

    expect(
      isEvidencePipelineTask({
        task_schema_version: 1,
        extraction_version: null,
      }),
    ).toBe(false);
    expect(
      isEvidencePipelineTask({
        task_schema_version: EVIDENCE_TASK_SCHEMA_VERSION,
        extraction_version: DOCUMENT_EXTRACTION_VERSION,
      }),
    ).toBe(true);
    db.close();
  });
});
