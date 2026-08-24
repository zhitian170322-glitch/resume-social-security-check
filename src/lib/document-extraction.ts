import { randomUUID } from "node:crypto";
import { db } from "./db";
import {
  analyzePdf,
  type DocumentAnalysis,
} from "./document-processor";
import {
  contentHash,
  readDocumentStageCache,
  readExtractionCache,
  writeDocumentStageCache,
  writeExtractionCache,
} from "./stage-cache";
import { TextQualityEvaluator } from "./text-quality";

export const EVIDENCE_TASK_SCHEMA_VERSION = 2;
export const DOCUMENT_EXTRACTION_VERSION = "pdf-extraction-v1";

export type DocumentKind = "RESUME" | "SOCIAL_SECURITY";
export type DocumentPageType =
  | "TEXT"
  | "TABLE"
  | "AMBIGUOUS"
  | "UNREADABLE"
  | "UNKNOWN";
export type DocumentExtractionMethod =
  | "PDF_TEXT"
  | "OCR_GENERAL"
  | "OCR_TABLE"
  | "HYBRID"
  | "MANUAL_REQUIRED";

export type PersistedDocumentPage = {
  documentId: string;
  pageNumber: number;
  pageType: DocumentPageType;
  pdfText: string | null;
  ocrText: string | null;
  selectedText: string | null;
  extractionMethod: DocumentExtractionMethod;
  qualityScore: number;
  warnings: string[];
  contentHash: string;
  createdAt: string;
};

type CachedPdfExtraction = {
  analysis: DocumentAnalysis;
  pages: PersistedDocumentPage[];
};

export function registerDocument(input: {
  id: string;
  taskId: string;
  taskFileId: string;
  kind: DocumentKind;
  originalName: string;
  mimeType: string;
  contentHash: string;
  extractionVersion?: string;
  createdAt: string;
}) {
  const extractionVersion =
    input.extractionVersion ?? DOCUMENT_EXTRACTION_VERSION;
  db.prepare(
    `INSERT INTO documents
      (id, task_id, task_file_id, kind, original_name, mime_type,
       content_hash, extraction_version, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(task_file_id) DO NOTHING`,
  ).run(
    input.id,
    input.taskId,
    input.taskFileId,
    input.kind,
    input.originalName,
    input.mimeType,
    input.contentHash,
    extractionVersion,
    input.createdAt,
  );
  writeDocumentStageCache(
    {
      taskId: input.taskId,
      documentId: input.id,
      contentHash: input.contentHash,
      stage: "DOCUMENT_INGESTED",
      version: extractionVersion,
    },
    {
      documentId: input.id,
      contentHash: input.contentHash,
      mimeType: input.mimeType,
    },
  );
}

function pageDecision(
  analysisPage: DocumentAnalysis["pages"][number],
): Omit<
  PersistedDocumentPage,
  "documentId" | "pageNumber" | "contentHash" | "createdAt"
> {
  const rawText = analysisPage.localText;
  const quality = new TextQualityEvaluator().evaluate(rawText ?? "");
  const warnings: string[] = [...quality.warnings];
  let pageType: DocumentPageType = "TEXT";
  let extractionMethod: DocumentExtractionMethod = "PDF_TEXT";
  let selectedText = rawText;

  if (
    warnings.includes("possible_table_structure_loss") ||
    warnings.includes("suspicious_two_column_order")
  ) {
    pageType = "AMBIGUOUS";
  }
  if (quality.qualityLevel === "MEDIUM") {
    warnings.push("OCR_RECOMMENDED", "HYBRID_CANDIDATE");
  }
  if (quality.qualityLevel === "LOW") {
    pageType = "UNREADABLE";
    extractionMethod = "MANUAL_REQUIRED";
    selectedText = null;
    warnings.push("OCR_REQUIRED");
  }

  return {
    pageType,
    pdfText: rawText,
    ocrText: null,
    selectedText,
    extractionMethod,
    qualityScore: quality.score,
    warnings: [...new Set(warnings)],
  };
}

export async function extractPdfDocument(
  input: {
    taskId: string;
    documentId: string;
    path: string;
    contentHash: string;
    extractionVersion?: string;
  },
  extract: (path: string) => Promise<DocumentAnalysis> = analyzePdf,
): Promise<CachedPdfExtraction & { cacheHit: boolean }> {
  const extractionVersion =
    input.extractionVersion ?? DOCUMENT_EXTRACTION_VERSION;
  const cacheIdentity = {
    taskId: input.taskId,
    documentId: input.documentId,
    contentHash: input.contentHash,
    stage: "QUALITY_EVALUATED" as const,
    version: extractionVersion,
  };
  const cached = readDocumentStageCache<CachedPdfExtraction>(cacheIdentity);
  if (cached) return { ...cached, cacheHit: true };

  const sharedCacheKey = contentHash(
    `PDF_TEXT\u001f${input.contentHash}\u001f${extractionVersion}`,
  );
  const sharedAnalysis =
    readExtractionCache<DocumentAnalysis>(sharedCacheKey);
  const analysis = sharedAnalysis ?? (await extract(input.path));
  if (!sharedAnalysis) {
    writeExtractionCache(
      sharedCacheKey,
      "local",
      "PDF_TEXT",
      analysis,
    );
  }
  const now = new Date().toISOString();
  const pages = analysis.pages.map((page) => {
    const decision = pageDecision(page);
    return {
      documentId: input.documentId,
      pageNumber: page.page,
      ...decision,
      contentHash: contentHash(page.localText ?? ""),
      createdAt: now,
    } satisfies PersistedDocumentPage;
  });

  db.transaction(() => {
    const upsertPage = db.prepare(
      `INSERT INTO document_pages
        (id, document_id, page_number, page_type, pdf_text, ocr_text,
         selected_text, extraction_method, quality_score, warnings_json,
         content_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(document_id, page_number) DO UPDATE SET
         page_type = excluded.page_type,
         pdf_text = excluded.pdf_text,
         ocr_text = excluded.ocr_text,
         selected_text = excluded.selected_text,
         extraction_method = excluded.extraction_method,
         quality_score = excluded.quality_score,
         warnings_json = excluded.warnings_json,
         content_hash = excluded.content_hash`,
    );
    const selectPage = db.prepare(
      "SELECT id FROM document_pages WHERE document_id = ? AND page_number = ?",
    );
    const insertRaw = db.prepare(
      `INSERT OR IGNORE INTO raw_extractions
        (id, document_id, document_page_id, extraction_method, raw_text,
         content_hash, metadata_json, created_at)
       VALUES (?, ?, ?, 'PDF_TEXT', ?, ?, '{}', ?)`,
    );
    const insertWarning = db.prepare(
      `INSERT INTO extraction_warnings
        (id, document_id, document_page_id, code, severity, details_json, created_at)
       VALUES (?, ?, ?, ?, ?, '{}', ?)`,
    );

    for (const page of pages) {
      const pageId = randomUUID();
      upsertPage.run(
        pageId,
        page.documentId,
        page.pageNumber,
        page.pageType,
        page.pdfText,
        page.ocrText,
        page.selectedText,
        page.extractionMethod,
        page.qualityScore,
        JSON.stringify(page.warnings),
        page.contentHash,
        page.createdAt,
      );
      const stored = selectPage.get(page.documentId, page.pageNumber) as {
        id: string;
      };
      if (page.pdfText !== null) {
        insertRaw.run(
          randomUUID(),
          page.documentId,
          stored.id,
          page.pdfText,
          page.contentHash,
          page.createdAt,
        );
      }
      for (const warning of page.warnings) {
        insertWarning.run(
          randomUUID(),
          page.documentId,
          stored.id,
          warning,
          warning === "OCR_REQUIRED" ? "ERROR" : "WARNING",
          page.createdAt,
        );
      }
    }
  })();

  const payload = { analysis, pages };
  writeDocumentStageCache(
    {
      ...cacheIdentity,
      stage: "PDF_EXTRACTED",
    },
    {
      analysis,
      pages: pages.map((page) => ({
        pageNumber: page.pageNumber,
        pdfText: page.pdfText,
        contentHash: page.contentHash,
      })),
    },
  );
  writeDocumentStageCache(cacheIdentity, payload);
  return { ...payload, cacheHit: sharedAnalysis !== null };
}
