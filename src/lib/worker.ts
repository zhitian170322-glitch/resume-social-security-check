import sharp from "sharp";
import { db, type TaskRow } from "./db";
import { config } from "./config";
import { fileStorage } from "./file-storage";
import {
  type DocumentAnalysis,
  extractResumeDocxPages,
  extractResumeDocumentPages,
  extractResumeImagePage,
  renderPdfPage,
  withTemporaryDocument,
} from "./document-processor";
import {
  DOCUMENT_EXTRACTION_VERSION,
  EVIDENCE_TASK_SCHEMA_VERSION,
  extractPdfDocument,
} from "./document-extraction";
import {
  AliyunOCRProvider,
  OCRLimitError,
  assertOCRCapacity,
  recordOCRCall,
  type OCRProvider,
  type OCRResult,
} from "./ocr";
import {
  AliyunSocialSecurityOCRProvider,
  CachedSocialSecurityOCRProvider,
  recognizeSocialSecurityPageDualSource,
  SocialSecurityOCRError,
} from "./social-security-provider";
import type {
  SocialSecurityOCRProvider,
  SocialSecurityOCRResult,
} from "./social-security-table";
import { SocialSecurityPageClassifier } from "./social-security-page-classifier";
import { persistSocialSecurityOCRResult } from "./social-security-evidence";
import { extractSocialRecords } from "./social-records";
import { extractResumeWithEvidence, isPresentMonthRaw } from "./deepseek";
import { detectFieldConflicts } from "./hybrid-text";
import { fileFingerprint, pageFingerprint, shouldSkipDuplicate } from "./material-dedup";
import { buildPaidMonthDetails, monthDetailsText } from "./month-details";
import { buildPageEvidence } from "./page-evidence";
import {
  type SocialRecord,
  verifyResumeAndSocial,
} from "./simple-verification";
import {
  type DocumentPage,
  DocumentPageSchema,
  type ResumeEvidenceExtraction,
  ResumeEvidenceExtractionSchema,
} from "./schemas";
import { safeErrorMessage } from "./errors";
import {
  contentHash,
  readExtractionCache,
  readVersionedStageArtifact,
  writeExtractionCache,
  writeVersionedStageArtifact,
  type PipelineArtifactVersions,
} from "./stage-cache";
import { logSafeEvent, recordApiCall } from "./observability";
import {
  EVIDENCE_VALIDATOR_VERSION,
  PARSER_VERSION,
  PipelineIntegrationError,
  VERIFICATION_ENGINE_VERSION,
  assertPipelineVersions,
} from "./worker-pipeline-integration";

type FileRow = {
  id: string;
  kind: "RESUME" | "SOCIAL_SECURITY";
  original_name: string;
  storage_key: string;
  mime_type: string;
  document_id: string;
  content_hash: string;
};

type OCRStagePayload = {
  resumeSourceFile: string;
  pages: DocumentPage[];
  socialPages: Array<{
    sourceFile: string;
    result: SocialSecurityOCRResult;
  }>;
  duplicateNotice?: string | null;
};

type StructuredPayload = {
  resume: ResumeEvidenceExtraction;
  socialRecords: SocialRecord[];
};

const workerGlobal = globalThis as typeof globalThis & { verificationWorkerRunning?: boolean };
export const PIPELINE_VERSIONS: PipelineArtifactVersions = {
  taskSchemaVersion: EVIDENCE_TASK_SCHEMA_VERSION,
  extractionVersion: DOCUMENT_EXTRACTION_VERSION,
  ocrVersion: config.SOCIAL_SECURITY_OCR_VERSION,
  parserVersion: PARSER_VERSION,
  evidenceValidatorVersion: EVIDENCE_VALIDATOR_VERSION,
  verificationEngineVersion: VERIFICATION_ENGINE_VERSION,
};
const PIPELINE_VERSION = `simple-v2:${JSON.stringify(PIPELINE_VERSIONS)}`;

export function isEvidencePipelineTask(
  task: Pick<TaskRow, "task_schema_version" | "extraction_version">,
) {
  return (
    task.task_schema_version === EVIDENCE_TASK_SCHEMA_VERSION &&
    task.extraction_version === DOCUMENT_EXTRACTION_VERSION
  );
}

function parseStructuredCache(value: StructuredPayload | null): StructuredPayload | null {
  if (!value) return null;
  try {
    return {
      resume: ResumeEvidenceExtractionSchema.parse(value.resume),
      socialRecords: Array.isArray(value.socialRecords) ? value.socialRecords : [],
    };
  } catch {
    return null;
  }
}

function parseOCRStageCache(value: OCRStagePayload | null): OCRStagePayload | null {
  if (!value || !Array.isArray(value.socialPages)) return null;
  try {
    return {
      resumeSourceFile: value.resumeSourceFile,
      pages: DocumentPageSchema.array().parse(value.pages),
      socialPages: value.socialPages,
    };
  } catch {
    return null;
  }
}

function updateTask(id: string, values: Record<string, string | number | null>) {
  const keys = Object.keys(values);
  db.prepare(
    `UPDATE verification_tasks SET ${keys.map((key) => `${key} = ?`).join(", ")} WHERE id = ?`,
  ).run(...keys.map((key) => values[key]), id);
}

function claimNextTask(): TaskRow | null {
  return db.transaction(() => {
    const task = db
      .prepare(
        `SELECT * FROM verification_tasks
         WHERE status = 'PENDING' AND stage = 'FILES_SAVED'
           AND task_schema_version = ?
           AND extraction_version = ?
         ORDER BY created_at LIMIT 1`,
      )
      .get(
        EVIDENCE_TASK_SCHEMA_VERSION,
        DOCUMENT_EXTRACTION_VERSION,
      ) as TaskRow | undefined;
    if (!task) return null;
    const changed = db
      .prepare(
        `UPDATE verification_tasks SET status = 'PROCESSING', updated_at = ?
         WHERE id = ? AND status = 'PENDING'`,
      )
      .run(new Date().toISOString(), task.id);
    return changed.changes ? { ...task, status: "PROCESSING" as const } : null;
  })();
}

function generalOCR(task: TaskRow): OCRProvider {
  let provider: AliyunOCRProvider | null = null;
  return {
    async recognize(input: Buffer, mimeType: string): Promise<OCRResult> {
      void mimeType;
      const key = contentHash(
        `${PIPELINE_VERSION}:aliyun:RecognizeGeneral:${contentHash(input)}`,
      );
      const cached = readExtractionCache<OCRResult>(key);
      if (cached) {
        recordApiCall({
          taskId: task.id,
          provider: "aliyun",
          apiType: "RecognizeGeneral",
          durationMs: 0,
          cacheHit: true,
          estimatedCost: 0,
        });
        return cached;
      }
      provider ??= new AliyunOCRProvider();
      const started = Date.now();
      try {
        const result = await provider.recognize(input);
        recordOCRCall(task.id, Boolean(task.paid_override), "RecognizeGeneral");
        recordApiCall({
          taskId: task.id,
          provider: "aliyun",
          apiType: "RecognizeGeneral",
          durationMs: Date.now() - started,
          requestId: result.requestId,
          cacheHit: false,
          estimatedCost: config.OCR_GENERAL_ESTIMATED_COST,
        });
        writeExtractionCache(key, "aliyun", "RecognizeGeneral", result);
        return result;
      } catch (error) {
        recordApiCall({
          taskId: task.id,
          provider: "aliyun",
          apiType: "RecognizeGeneral",
          durationMs: Date.now() - started,
          errorCode: "OCR_FAILED",
          cacheHit: false,
          estimatedCost: 0,
        });
        throw error;
      }
    },
  };
}

async function socialSecurityPageOCR(
  task: TaskRow,
  documentId: string,
  input: Buffer,
  mimeType: string,
  page: number,
): Promise<{
  selected: SocialSecurityOCRResult;
  attempts: SocialSecurityOCRResult[];
  tableUsed: boolean;
  generalUsed: boolean;
}> {
  let prepared = input;
  if (input.length > 9 * 1024 * 1024) {
    prepared = await sharp(input)
      .rotate()
      .resize({ width: 2500, withoutEnlargement: true })
      .png({ compressionLevel: 9 })
      .toBuffer();
    if (prepared.length > 9 * 1024 * 1024) {
      prepared = await sharp(prepared).jpeg({ quality: 90 }).toBuffer();
    }
  }
  const provider = socialSecurityOCRProvider(task, documentId, page);
  const outcome = await recognizeSocialSecurityPageDualSource({
    provider,
    data: prepared,
    mimeType,
    page,
  });
  for (const result of outcome.attempts) {
    persistSocialSecurityOCRResult({ taskId: task.id, documentId, result });
  }
  return {
    selected: outcome.selected,
    attempts: outcome.attempts,
    tableUsed: outcome.tableUsed,
    generalUsed: outcome.generalUsed,
  };
}

function socialSecurityOCRProvider(
  task: TaskRow,
  documentId: string,
  page: number,
): SocialSecurityOCRProvider {
  const provider = new AliyunSocialSecurityOCRProvider((metric) => {
    const apiType =
      metric.apiType === "TABLE" ? "RecognizeTableOcr" : "RecognizeGeneral";
    if (!metric.errorCode) {
      recordOCRCall(task.id, Boolean(task.paid_override), apiType);
    }
    recordApiCall({
      taskId: task.id,
      documentId,
      provider: "aliyun",
      apiType,
      sourcePage: page,
      httpStatus: metric.httpStatus,
      errorCode: metric.errorCode,
      requestId: metric.requestId,
      durationMs: metric.durationMs,
      cacheHit: false,
      estimatedCost: metric.errorCode
        ? 0
        : metric.apiType === "TABLE"
          ? config.OCR_TABLE_ESTIMATED_COST
          : config.OCR_GENERAL_ESTIMATED_COST,
    });
    logSafeEvent(metric.errorCode ? "error" : "info", {
      taskId: task.id,
      documentId,
      stage: "OCR_COMPLETE",
      provider: "aliyun",
      apiType,
      page,
      httpStatus: metric.httpStatus,
      errorCode: metric.errorCode,
      requestId: metric.requestId,
      durationMs: metric.durationMs,
    });
  });
  return new CachedSocialSecurityOCRProvider(
    provider,
    undefined,
    (identity) => {
      recordApiCall({
        taskId: task.id,
        documentId,
        provider: identity.provider,
        apiType:
          identity.apiType === "TABLE"
            ? "RecognizeTableOcr"
            : "RecognizeGeneral",
        sourcePage: identity.pageNumber,
        durationMs: 0,
        cacheHit: true,
        estimatedCost: 0,
      });
    },
  );
}

async function estimateOCRCalls(
  files: FileRow[],
  pdfAnalyses: ReadonlyMap<string, DocumentAnalysis>,
) {
  let count = 0;
  const classifier = new SocialSecurityPageClassifier();
  for (const file of files) {
    const data = await fileStorage.read(file.storage_key);
    const fileCacheKey = contentHash(
      `${PIPELINE_VERSION}:file-ocr:${file.kind}:${contentHash(data)}`,
    );
    if (readExtractionCache(fileCacheKey)) continue;
    if (file.mime_type !== "application/pdf") {
      count += file.kind === "SOCIAL_SECURITY" ? 2 : 1;
      continue;
    }
    const analysis = pdfAnalyses.get(file.id);
    if (!analysis) throw new Error("PDF_PARSE_FAILED: 缺少已缓存的 PDF 提取结果");
    if (file.kind === "SOCIAL_SECURITY") {
      count += analysis.pages.reduce((total, page) => {
        classifier.classify({
          mimeType: file.mime_type,
          text: page.localText,
          source: "PDF_TEXT",
        });
        // Reserve for Table OCR plus a possible General OCR fallback.
        return total + 2;
      }, 0);
    } else {
      count += analysis.estimatedOCRCalls;
    }
  }
  return count;
}

function socialPageEvidence(
  outcome: {
    selected: SocialSecurityOCRResult;
    attempts: SocialSecurityOCRResult[];
    tableUsed: boolean;
    generalUsed: boolean;
  },
  pageNumber: number,
  sourceFile: string,
  pdfText: string | null,
): Pick<DocumentPage, "pageEvidence" | "sourceConflicts" | "warnings" | "mergeDecision"> {
  const table = outcome.attempts.find((item) => item.apiType === "TABLE");
  const general = outcome.attempts.find((item) => item.apiType === "GENERAL");
  const conflicts =
    table && general
      ? detectFieldConflicts(table.rawText, general.rawText)
      : [];
  const warnings: string[] = [];
  if (!outcome.tableUsed && !outcome.generalUsed) warnings.push("OCR_BOTH_SOURCES_EMPTY");
  else if (!outcome.tableUsed) warnings.push("OCR_TABLE_FAILED");
  else if (!outcome.generalUsed) warnings.push("OCR_GENERAL_FAILED");
  if (conflicts.length) warnings.push("SOURCE_CONFLICT");
  return {
    mergeDecision: conflicts.length
      ? "conflict"
      : outcome.tableUsed && outcome.generalUsed
        ? "merged"
        : outcome.tableUsed || outcome.generalUsed
          ? "ocr"
          : "empty",
    sourceConflicts: conflicts,
    warnings,
    pageEvidence: [
      buildPageEvidence({
        source: "native_text",
        pageNumber,
        rawText: pdfText,
        sourceFileId: sourceFile,
      }),
      buildPageEvidence({
        source: "table_ocr",
        pageNumber,
        rawText: table?.rawText ?? null,
        requestId: table?.requestId ?? null,
        sourceFileId: sourceFile,
      }),
      buildPageEvidence({
        source: "general_ocr",
        pageNumber,
        rawText: general?.rawText ?? outcome.selected.rawText,
        requestId: general?.requestId ?? outcome.selected.requestId,
        sourceFileId: sourceFile,
      }),
    ],
  };
}

function tableRowsText(result: SocialSecurityOCRResult) {
  return result.tables
    .flatMap((table) => {
      const rows = new Map<number, string[]>();
      for (const cell of table.cells) {
        const values = rows.get(cell.row) ?? [];
        values[cell.column] = cell.text;
        rows.set(cell.row, values);
      }
      return [...rows.entries()]
        .sort(([left], [right]) => left - right)
        .map(([, cells]) => cells.filter(Boolean).join(" | "));
    })
    .join("\n");
}

async function extractOCRStage(
  task: TaskRow,
  resumeFile: FileRow,
  socialFiles: FileRow[],
  pdfAnalyses: ReadonlyMap<string, DocumentAnalysis>,
): Promise<OCRStagePayload> {
  const pages: DocumentPage[] = [];
  const socialPages: OCRStagePayload["socialPages"] = [];
  const socialPageClassifier = new SocialSecurityPageClassifier();
  const resumeData = await fileStorage.read(resumeFile.storage_key);
  const resumeFileCacheKey = contentHash(
    `${PIPELINE_VERSION}:file-ocr:${resumeFile.kind}:${contentHash(resumeData)}`,
  );
  const cachedResumePages = readExtractionCache<DocumentPage[]>(resumeFileCacheKey);
  let duplicateFound = false;
  if (cachedResumePages) {
    pages.push(
      ...cachedResumePages.map((page) => ({
        ...page,
        sourceFile: resumeFile.original_name,
      })),
    );
  } else {
    const resumeSeen = new Set<string>();
    const onResumeDuplicate = () => {
      duplicateFound = true;
    };
    const onResumeOcr = (page: number, result: OCRResult) => {
      logSafeEvent("info", {
        taskId: task.id,
        stage: "OCR_COMPLETE",
        provider: "aliyun-general",
        page,
        requestId: result.requestId,
      });
    };
    if (resumeFile.mime_type === "application/pdf") {
      await withTemporaryDocument(resumeData, ".pdf", async (path) => {
        pages.push(
          ...(await extractResumeDocumentPages({
            path,
            sourceFile: resumeFile.original_name,
            ocr: generalOCR(task),
            analysis: pdfAnalyses.get(resumeFile.id),
            seenFingerprints: resumeSeen,
            onDuplicatePage: onResumeDuplicate,
            onOCRCall: onResumeOcr,
          })),
        );
      });
    } else if (
      resumeFile.mime_type === "image/jpeg" ||
      resumeFile.mime_type === "image/png"
    ) {
      pages.push(
        ...(await extractResumeImagePage({
          data: resumeData,
          sourceFile: resumeFile.original_name,
          ocr: generalOCR(task),
          seenFingerprints: resumeSeen,
          onDuplicatePage: onResumeDuplicate,
          onOCRCall: onResumeOcr,
        })),
      );
    } else if (
      resumeFile.mime_type ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ) {
      await withTemporaryDocument(resumeData, ".docx", async (path) => {
        pages.push(
          ...(await extractResumeDocxPages({
            path,
            sourceFile: resumeFile.original_name,
          })),
        );
      });
    } else {
      throw new Error("INVALID_FILE_TYPE");
    }
    writeExtractionCache(
      resumeFileCacheKey,
      "hybrid",
      "resume-document-pages",
      pages.filter((page) => page.sourceFile === resumeFile.original_name),
    );
  }
  const seenFileHashes = new Set<string>();
  const seenPageFingerprints = new Set<string>();
  const seenImageHashes = new Set<string>();
  for (const file of socialFiles) {
    const data = await fileStorage.read(file.storage_key);
    if (shouldSkipDuplicate(seenFileHashes, contentHash(data))) {
      duplicateFound = true;
      continue;
    }
    const socialFileCacheKey = contentHash(
      `${PIPELINE_VERSION}:file-ocr:${file.kind}:${contentHash(data)}`,
    );
    const cachedSocial = readExtractionCache<{
      pages: DocumentPage[];
      results: SocialSecurityOCRResult[];
    }>(socialFileCacheKey);
    if (cachedSocial) {
      for (const [index, result] of cachedSocial.results.entries()) {
        const selectedText = `${result.rawText}\n${tableRowsText(result)}`;
        const fingerprint = pageFingerprint(selectedText);
        if (
          selectedText.replace(/\s+/g, "").length >= 20 &&
          shouldSkipDuplicate(seenPageFingerprints, fingerprint)
        ) {
          duplicateFound = true;
          continue;
        }
        const page = cachedSocial.pages[index];
        if (page) {
          pages.push({ ...page, sourceFile: file.original_name });
        }
        socialPages.push({ sourceFile: file.original_name, result });
      }
      continue;
    }
    const fileDocumentPages: DocumentPage[] = [];
    const fileResults: SocialSecurityOCRResult[] = [];
    if (file.mime_type === "application/pdf") {
      await withTemporaryDocument(data, ".pdf", async (path) => {
        const analysis = pdfAnalyses.get(file.id);
        if (!analysis) {
          throw new Error("PDF_PARSE_FAILED: 缺少已缓存的 PDF 提取结果");
        }
        for (const page of analysis.pages) {
          const classification = socialPageClassifier.classify({
            mimeType: file.mime_type,
            text: page.localText,
            source: "PDF_TEXT",
          });
          const image = await renderPdfPage(path, page.page);
          if (shouldSkipDuplicate(seenImageHashes, fileFingerprint(image))) {
            duplicateFound = true;
            continue;
          }
          const outcome = await socialSecurityPageOCR(
            task,
            file.document_id,
            image,
            "image/png",
            page.page,
          );
          const result = outcome.selected;
          const selectedText = `${result.rawText}\n${tableRowsText(result)}`;
          const fingerprint = pageFingerprint(selectedText);
          if (selectedText.replace(/\s+/g, "").length >= 20 && shouldSkipDuplicate(seenPageFingerprints, fingerprint)) {
            duplicateFound = true;
            continue;
          }
          const confidences = result.tables
            .map((table) => table.confidence)
            .filter((value): value is number => value !== null);
          const confidence = confidences.length
            ? confidences.reduce((sum, value) => sum + value, 0) / confidences.length
            : null;
          const extra = socialPageEvidence(
            outcome,
            page.page,
            file.original_name,
            page.localText,
          );
          const documentPage: DocumentPage = {
            page: page.page,
            sourceFile: file.original_name,
            pdfText: page.localText,
            ocrText: selectedText,
            selectedText,
            extractionMethod:
              result.provider === "local-pdftotext"
                ? "pdf_text"
                : extra.mergeDecision === "conflict" || extra.mergeDecision === "empty"
                  ? "manual_required"
                  : confidence !== null &&
                      confidence >= config.OCR_MIN_CONFIDENCE
                    ? "ocr"
                    : "manual_required",
            qualityScore:
              result.provider === "local-pdftotext"
                ? page.qualityScore
                : confidence === null
                  ? 0
                  : Math.round(confidence * 100),
            ocrConfidence: confidence,
            warnings: [
              ...classification.reasons.map(
                (reason) => `CLASSIFIER_HINT:${reason}`,
              ),
              ...extra.warnings,
              ...(confidence !== null &&
              confidence >= config.OCR_MIN_CONFIDENCE
                ? []
                : ["OCR_CONFIDENCE_LOW"]),
            ],
            mergeDecision: extra.mergeDecision,
            sourceConflicts: extra.sourceConflicts,
            pageEvidence: extra.pageEvidence,
          };
          pages.push(documentPage);
          fileDocumentPages.push(documentPage);
          socialPages.push({ sourceFile: file.original_name, result });
          fileResults.push(result);
        }
      });
    } else {
      if (shouldSkipDuplicate(seenImageHashes, fileFingerprint(data))) {
        duplicateFound = true;
        continue;
      }
      const outcome = await socialSecurityPageOCR(
        task,
        file.document_id,
        data,
        file.mime_type,
        1,
      );
      const result = outcome.selected;
      const selectedText = `${result.rawText}\n${tableRowsText(result)}`;
      const fingerprint = pageFingerprint(selectedText);
      if (
        selectedText.replace(/\s+/g, "").length >= 20 &&
        shouldSkipDuplicate(seenPageFingerprints, fingerprint)
      ) {
        duplicateFound = true;
        continue;
      }
      const confidences = result.tables
        .map((table) => table.confidence)
        .filter((value): value is number => value !== null);
      const confidence = confidences.length
        ? confidences.reduce((sum, value) => sum + value, 0) / confidences.length
        : null;
      const extra = socialPageEvidence(outcome, 1, file.original_name, null);
      const documentPage: DocumentPage = {
        page: 1,
        sourceFile: file.original_name,
        pdfText: null,
        ocrText: selectedText,
        selectedText,
        extractionMethod:
          extra.mergeDecision === "conflict" || extra.mergeDecision === "empty"
            ? "manual_required"
            : confidence !== null && confidence >= config.OCR_MIN_CONFIDENCE
              ? "ocr"
              : "manual_required",
        qualityScore: confidence === null ? 0 : Math.round(confidence * 100),
        ocrConfidence: confidence,
        warnings: [
          ...extra.warnings,
          ...(confidence !== null && confidence >= config.OCR_MIN_CONFIDENCE
            ? []
            : ["OCR_CONFIDENCE_LOW"]),
        ],
        mergeDecision: extra.mergeDecision,
        sourceConflicts: extra.sourceConflicts,
        pageEvidence: extra.pageEvidence,
      };
      pages.push(documentPage);
      fileDocumentPages.push(documentPage);
      socialPages.push({ sourceFile: file.original_name, result });
      fileResults.push(result);
    }
    writeExtractionCache(socialFileCacheKey, "aliyun", "social-security-file", {
      pages: fileDocumentPages,
      results: fileResults,
    });
  }
  return {
    resumeSourceFile: resumeFile.original_name,
    pages,
    socialPages,
    duplicateNotice: duplicateFound
      ? "检测到重复材料，已排除重复计算"
      : null,
  };
}

async function structureStage(
  task: TaskRow,
  payload: OCRStagePayload,
): Promise<StructuredPayload> {
  const resumePages = payload.pages.filter(
    (page) => page.sourceFile === payload.resumeSourceFile,
  );
  const deepSeekCacheKey = contentHash(
    `${PIPELINE_VERSION}:deepseek-resume:${JSON.stringify(
      resumePages.map((page) => [
        page.pdfText,
        page.qualityScore,
        page.ocrText,
        page.ocrConfidence,
      ]),
    )}`,
  );
  const cachedResume = readExtractionCache<ResumeEvidenceExtraction>(deepSeekCacheKey);
  let resume = ResumeEvidenceExtractionSchema.safeParse(cachedResume).success
    ? ResumeEvidenceExtractionSchema.parse(cachedResume)
    : null;
  if (!resume) {
    resume = await extractResumeWithEvidence(resumePages, (metric) => {
        recordApiCall({
          taskId: task.id,
          provider: "deepseek",
          apiType: "chat.completions",
          httpStatus: metric.httpStatus,
          errorCode: metric.errorCode,
          durationMs: metric.durationMs,
          cacheHit: false,
          estimatedCost: config.DEEPSEEK_ESTIMATED_COST_PER_CALL,
        });
      });
    writeExtractionCache(deepSeekCacheKey, "deepseek", "resume-field-evidence-v1", resume);
  } else {
    recordApiCall({
      taskId: task.id,
      provider: "deepseek",
      apiType: "chat.completions",
      durationMs: 0,
      cacheHit: true,
      estimatedCost: 0,
    });
  }
  const socialRecords: SocialRecord[] = [];
  const socialByFile = new Map<string, SocialSecurityOCRResult[]>();
  for (const page of payload.socialPages) {
    socialByFile.set(page.sourceFile, [
      ...(socialByFile.get(page.sourceFile) ?? []),
      page.result,
    ]);
  }
  for (const [sourceFile, filePages] of socialByFile) {
    const merged: SocialSecurityOCRResult = {
      page: filePages[0]?.page ?? 1,
      rawText: filePages.map((page) => page.rawText).join("\n"),
      tables: filePages.flatMap((page) => page.tables),
      requestId: filePages.map((page) => page.requestId).filter(Boolean).join(",") || null,
      provider: filePages[0]?.provider ?? "unknown",
      providerVersion: filePages[0]?.providerVersion ?? "unknown",
      apiType: filePages.some((page) => page.apiType === "TABLE")
        ? "TABLE"
        : "GENERAL",
      ocrVersion: filePages[0]?.ocrVersion ?? "unknown",
      contentHash: contentHash(
        filePages.map((page) => page.contentHash).join("|"),
      ),
      rawProviderResponseRef:
        filePages
          .map((page) => page.rawProviderResponseRef)
          .filter(Boolean)
          .join(",") || null,
    };
    socialRecords.push(...extractSocialRecords({ ocr: merged, sourceFile }));
  }
  return { resume, socialRecords };
}

function usageForTask(taskId: string) {
  const row = db
    .prepare(
      `SELECT
         SUM(CASE WHEN provider = 'aliyun' AND cache_hit = 0 THEN 1 ELSE 0 END) AS ocr_calls,
         SUM(CASE WHEN provider = 'deepseek' AND cache_hit = 0 THEN 1 ELSE 0 END) AS deepseek_calls,
         COALESCE(SUM(estimated_cost), 0) AS estimated_cost
       FROM api_calls WHERE task_id = ?`,
    )
    .get(taskId) as {
    ocr_calls: number | null;
    deepseek_calls: number | null;
    estimated_cost: number;
  };
  return {
    ocrPages: row.ocr_calls ?? 0,
    ocrCalls: row.ocr_calls ?? 0,
    deepseekCalls: row.deepseek_calls ?? 0,
    estimatedCost: row.estimated_cost,
  };
}

async function processTask(task: TaskRow) {
  assertPipelineVersions({
    taskSchemaVersion: task.task_schema_version,
    extractionVersion: task.extraction_version,
    versions: PIPELINE_VERSIONS,
  });
  updateTask(task.id, {
    stage: "DOCUMENT_INGESTED",
    updated_at: new Date().toISOString(),
  });
  const files = db
    .prepare(
      `SELECT task_files.*, documents.id AS document_id,
              documents.content_hash AS content_hash
       FROM task_files
       JOIN documents ON documents.task_file_id = task_files.id
       WHERE task_files.task_id = ?
       ORDER BY task_files.kind, task_files.created_at`,
    )
    .all(task.id) as FileRow[];
  const resumeFile = files.find((file) => file.kind === "RESUME");
  const socialFiles = files.filter((file) => file.kind === "SOCIAL_SECURITY");
  if (!resumeFile || !socialFiles.length) throw new Error("INVALID_FILE_TYPE");
  const fileHashes = [];
  const pdfAnalyses = new Map<string, DocumentAnalysis>();
  for (const file of files) {
    const data = await fileStorage.read(file.storage_key);
    const actualHash = contentHash(data);
    if (actualHash !== file.content_hash) {
      throw new Error("DOCUMENT_CONTENT_HASH_MISMATCH");
    }
    fileHashes.push(`${file.id}:${actualHash}`);
    if (file.mime_type === "application/pdf") {
      const extraction = await withTemporaryDocument(data, ".pdf", (path) =>
        extractPdfDocument({
          taskId: task.id,
          documentId: file.document_id,
          path,
          contentHash: actualHash,
          extractionVersion: task.extraction_version ?? DOCUMENT_EXTRACTION_VERSION,
        }),
      );
      pdfAnalyses.set(file.id, extraction.analysis);
    }
  }
  const cacheKey = contentHash(`${PIPELINE_VERSION}|${fileHashes.join("|")}`);
  writeVersionedStageArtifact({
    taskId: task.id,
    stage: "DOCUMENT_INGESTED",
    cacheKey,
    versions: PIPELINE_VERSIONS,
    payload: {
      taskSchemaVersion: task.task_schema_version,
      extractionVersion: task.extraction_version,
      fileCount: files.length,
      fileHashes,
    },
  });
  writeVersionedStageArtifact({
    taskId: task.id,
    stage: "EXTRACTION_COMPLETE",
    cacheKey,
    versions: PIPELINE_VERSIONS,
    payload: {
      fileHashes,
      pdfDocumentCount: pdfAnalyses.size,
    },
  });
  updateTask(task.id, {
    stage: "EXTRACTION_COMPLETE",
    updated_at: new Date().toISOString(),
  });
  const estimatedOCRCalls = await estimateOCRCalls(files, pdfAnalyses);
  updateTask(task.id, {
    estimated_ocr_calls: estimatedOCRCalls,
    schema_version: 2,
    updated_at: new Date().toISOString(),
  });
  assertOCRCapacity(estimatedOCRCalls, Boolean(task.paid_override));

  let ocrPayload = parseOCRStageCache(
    readVersionedStageArtifact<OCRStagePayload>({
      taskId: task.id,
      stage: "OCR_COMPLETE",
      cacheKey,
      versions: PIPELINE_VERSIONS,
    }),
  );
  if (!ocrPayload) {
    ocrPayload = await extractOCRStage(
      task,
      resumeFile,
      socialFiles,
      pdfAnalyses,
    );
    writeVersionedStageArtifact({
      taskId: task.id,
      stage: "OCR_COMPLETE",
      cacheKey,
      versions: PIPELINE_VERSIONS,
      payload: ocrPayload,
    });
  }
  updateTask(task.id, {
    stage: "OCR_COMPLETE",
    updated_at: new Date().toISOString(),
  });

  let structured = parseStructuredCache(
    readVersionedStageArtifact<StructuredPayload>({
      taskId: task.id,
      stage: "STRUCTURED",
      cacheKey,
      versions: PIPELINE_VERSIONS,
    }),
  );
  if (!structured) {
    structured = await structureStage(task, ocrPayload);
    writeVersionedStageArtifact({
      taskId: task.id,
      stage: "STRUCTURED",
      cacheKey,
      versions: PIPELINE_VERSIONS,
      payload: structured,
    });
  }
  updateTask(task.id, { stage: "STRUCTURED", updated_at: new Date().toISOString() });

  const experiences = structured.resume.experiences.map((experience, index) => ({
    sourceId: `resume-${index}`,
    companyRaw: experience.resumeCompany.value,
    position: experience.position?.value ?? null,
    startMonth: experience.resumeStartMonth.value,
    endMonth: experience.resumeEndMonth.value,
    endMonthRaw: experience.resumeEndMonth.rawValue ?? null,
    endIsPresent: isPresentMonthRaw(
      experience.resumeEndMonth.rawValue ?? experience.resumeEndMonth.sourceQuote,
    ),
    sourcePage: experience.resumeCompany.sourcePage,
    sourceQuote: experience.resumeCompany.sourceQuote,
    sourceKind:
      experience.resumeCompany.sourceMethod === "pdf_text"
        ? ("native_text" as const)
        : experience.resumeCompany.sourceMethod === "ocr"
          ? ("general_ocr" as const)
          : ("hybrid" as const),
  }));
  const socialRecords = structured.socialRecords.map((record, index) => ({
    ...record,
    sourceId: record.sourceId ?? `social-${index}`,
  }));
  const socialNameMatch = ocrPayload.pages
    .map((page) => page.selectedText || page.ocrText || page.pdfText || "")
    .join("\n")
    .match(/姓名[:：]\s*([^\s,，。]+)/u);
  const details = buildPaidMonthDetails(socialRecords);
  const extracted = {
    candidateName: structured.resume.candidateName.value ?? "姓名待人工确认",
    experiences,
    socialRecords,
    socialName: socialNameMatch?.[1] ?? null,
    duplicateNotice: ocrPayload.duplicateNotice ?? null,
  };
  const resumePages = ocrPayload.pages.filter(
    (page) => page.sourceFile === ocrPayload.resumeSourceFile,
  );
  const sourceConflicts = ocrPayload.pages.flatMap((page) =>
    (page.sourceConflicts ?? []).map((conflict) => ({
      ...conflict,
      pageNumber: page.page,
      sourceFile: page.sourceFile,
    })),
  );
  const hasUnconfirmedFields =
    structured.resume.candidateName.status !== "verified" ||
    structured.resume.experiences.some(
      (experience) =>
        experience.resumeCompany.status === "uncertain" ||
        experience.resumeStartMonth.status === "uncertain" ||
        experience.resumeEndMonth.status === "uncertain",
    ) ||
    ocrPayload.pages.some(
      (page) =>
        page.mergeDecision === "conflict" ||
        page.mergeDecision === "empty" ||
        page.warnings.includes("OCR_BOTH_SOURCES_EMPTY") ||
        page.warnings.includes("SOURCE_CONFLICT"),
    );
  const report = {
    ...verifyResumeAndSocial({
      candidateName: extracted.candidateName,
      socialName: extracted.socialName,
      experiences,
      socialRecords,
      duplicateNotice: extracted.duplicateNotice,
      sourceConflicts,
      hasUnconfirmedFields,
    }),
    monthDetails: details,
    monthDetailsText: monthDetailsText(details),
    fieldOverrides: [],
    systemExtracted: extracted,
  };
  writeVersionedStageArtifact({
    taskId: task.id,
    stage: "VERIFICATION_COMPLETE",
    cacheKey,
    versions: PIPELINE_VERSIONS,
    payload: report,
  });
  updateTask(task.id, {
    stage: "VERIFICATION_COMPLETE",
    updated_at: new Date().toISOString(),
  });
  logSafeEvent("info", {
    taskId: task.id,
    stage: "VERIFICATION_COMPLETE",
    version: PIPELINE_VERSIONS.verificationEngineVersion,
    verificationStatus: report.recruiterSummary.conclusion,
  });
  const usage = usageForTask(task.id);
  const now = new Date().toISOString();
  updateTask(task.id, {
    status: "COMPLETED",
    stage: "COMPLETED",
    candidate_name: report.candidateName,
    resume_json: JSON.stringify(structured.resume),
    social_security_json: JSON.stringify(structured.socialRecords),
    result_json: JSON.stringify(report),
    ocr_pages: usage.ocrPages,
    deepseek_calls: usage.deepseekCalls,
    estimated_cost: usage.estimatedCost,
    completed_at: now,
    updated_at: now,
  });
}

function classifyError(error: unknown) {
  const text = error instanceof Error ? error.message : "";
  if (error instanceof PipelineIntegrationError) return error.code;
  if (error instanceof SocialSecurityOCRError) return error.code;
  if (text.includes("PDF_PARSE_FAILED")) return "PDF_PARSE_FAILED";
  if (
    text.includes("AI_PARSE_FAILED") ||
    (typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "AI_PARSE_FAILED")
  )
    return "AI_PARSE_FAILED";
  if (error instanceof OCRLimitError || text.includes("OCR") || text.includes("阿里云"))
    return "OCR_FAILED";
  return "VERIFICATION_FAILED";
}

async function runWorker() {
  try {
    let task = claimNextTask();
    while (task) {
      try {
        await processTask(task);
      } catch (error) {
        if (error instanceof OCRLimitError && error.code === "OCR_CONFIRM_REQUIRED") {
          updateTask(task.id, {
            status: "PENDING",
            stage: "AWAITING_OCR_CONFIRMATION",
            error_code: error.code,
            error_message: error.message,
            updated_at: new Date().toISOString(),
          });
          task = claimNextTask();
          continue;
        }
        const code = classifyError(error);
        const detail = error instanceof Error ? error.message : "";
        const missingCredential =
          detail.includes("OCR 凭证未配置") || detail.includes("API Key 未配置");
        const current = db
          .prepare("SELECT stage FROM verification_tasks WHERE id = ?")
          .get(task.id) as { stage: string } | undefined;
        logSafeEvent("error", {
          taskId: task.id,
          stage: current?.stage ?? task.stage,
          errorCode: code,
          version: PIPELINE_VERSION,
        });
        updateTask(task.id, {
          status: "FAILED",
          error_code: code,
          error_message: missingCredential ? detail : safeErrorMessage(code),
          updated_at: new Date().toISOString(),
        });
      }
      task = claimNextTask();
    }
  } finally {
    workerGlobal.verificationWorkerRunning = false;
    const pending = db
      .prepare(
        `SELECT 1 FROM verification_tasks
         WHERE status = 'PENDING' AND stage = 'FILES_SAVED'
           AND task_schema_version = ?
           AND extraction_version = ?
         LIMIT 1`,
      )
      .get(EVIDENCE_TASK_SCHEMA_VERSION, DOCUMENT_EXTRACTION_VERSION);
    if (pending) kickWorker();
  }
}

export function kickWorker() {
  if (workerGlobal.verificationWorkerRunning) return;
  workerGlobal.verificationWorkerRunning = true;
  setImmediate(() => void runWorker());
}
