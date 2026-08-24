import sharp from "sharp";
import { db, type TaskRow } from "./db";
import { config } from "./config";
import { fileStorage } from "./file-storage";
import {
  type DocumentAnalysis,
  extractResumeDocumentPages,
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
import { AliyunSocialSecurityOCRProvider } from "./social-security-provider";
import type { SocialSecurityOCRResult } from "./social-security-table";
import {
  parseSocialSecurityTable,
  type ParsedSocialSecurityRecord,
  type SocialSecurityParseResult,
} from "./social-security-parsers";
import { extractResumeWithEvidence } from "./deepseek";
import {
  normalizeCompanyCandidate,
  validateResumeEvidence,
  validateSocialEvidence,
  type EvidenceIssue,
} from "./evidence-validator";
import {
  type DocumentPage,
  DocumentPageSchema,
  type EvidenceMonthField,
  type EvidenceMonthsField,
  type EvidenceNumberField,
  type EvidenceStringField,
  type ResumeEvidenceExtraction,
  ResumeEvidenceExtractionSchema,
  type SocialSecurityEvidenceRecord,
  SocialSecurityEvidenceRecordSchema,
} from "./schemas";
import { verifyEvidenceRecords, type VerificationV2Item } from "./verification-engine-v2";
import { createEvidenceReport } from "./result";
import { safeErrorMessage } from "./errors";
import {
  contentHash,
  readExtractionCache,
  readStageArtifact,
  writeExtractionCache,
  writeStageArtifact,
} from "./stage-cache";
import { logSafeEvent, recordApiCall } from "./observability";

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
};

type StructuredPayload = {
  resume: ResumeEvidenceExtraction;
  social: SocialSecurityEvidenceRecord[];
  issues: EvidenceIssue[];
};

const workerGlobal = globalThis as typeof globalThis & { verificationWorkerRunning?: boolean };
const PIPELINE_VERSION = "evidence-v2.1";

export function isEvidencePipelineTask(
  task: Pick<TaskRow, "task_schema_version" | "extraction_version">,
) {
  return (
    task.task_schema_version >= EVIDENCE_TASK_SCHEMA_VERSION &&
    task.extraction_version === DOCUMENT_EXTRACTION_VERSION
  );
}

function parseStructuredCache(value: StructuredPayload | null): StructuredPayload | null {
  if (!value) return null;
  try {
    return {
      resume: ResumeEvidenceExtractionSchema.parse(value.resume),
      social: SocialSecurityEvidenceRecordSchema.array().parse(value.social),
      issues: Array.isArray(value.issues) ? value.issues : [],
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
           AND task_schema_version >= ?
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

async function tableOCR(
  task: TaskRow,
  input: Buffer,
  page: number,
): Promise<SocialSecurityOCRResult> {
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
  const key = contentHash(
    `${PIPELINE_VERSION}:aliyun:RecognizeTableOcr:${contentHash(prepared)}`,
  );
  const cached = readExtractionCache<SocialSecurityOCRResult>(key);
  if (cached) {
    recordApiCall({
      taskId: task.id,
      provider: "aliyun",
      apiType: "RecognizeTableOcr",
      sourcePage: page,
      durationMs: 0,
      cacheHit: true,
      estimatedCost: 0,
    });
    return { ...cached, page };
  }
  let metric = { durationMs: 0 } as {
    durationMs: number;
    httpStatus?: number;
    errorCode?: string;
    requestId?: string;
  };
  const provider = new AliyunSocialSecurityOCRProvider((value) => {
    metric = value;
  });
  try {
    const result = await provider.recognize(prepared, "image/png", page);
    recordOCRCall(task.id, Boolean(task.paid_override), "RecognizeTableOcr");
    recordApiCall({
      taskId: task.id,
      provider: "aliyun",
      apiType: "RecognizeTableOcr",
      sourcePage: page,
      httpStatus: metric.httpStatus,
      requestId: result.requestId ?? metric.requestId,
      durationMs: metric.durationMs,
      cacheHit: false,
      estimatedCost: config.OCR_TABLE_ESTIMATED_COST,
    });
    writeExtractionCache(key, "aliyun", "RecognizeTableOcr", result);
    return result;
  } catch (error) {
    recordApiCall({
      taskId: task.id,
      provider: "aliyun",
      apiType: "RecognizeTableOcr",
      sourcePage: page,
      httpStatus: metric.httpStatus,
      errorCode: metric.errorCode ?? "TABLE_OCR_FAILED",
      requestId: metric.requestId,
      durationMs: metric.durationMs,
      cacheHit: false,
      estimatedCost: 0,
    });
    throw error;
  }
}

async function estimateOCRCalls(
  files: FileRow[],
  pdfAnalyses: ReadonlyMap<string, DocumentAnalysis>,
) {
  let count = 0;
  for (const file of files) {
    const data = await fileStorage.read(file.storage_key);
    const fileCacheKey = contentHash(
      `${PIPELINE_VERSION}:file-ocr:${file.kind}:${contentHash(data)}`,
    );
    if (readExtractionCache(fileCacheKey)) continue;
    if (file.mime_type !== "application/pdf") {
      count += 1;
      continue;
    }
    const analysis = pdfAnalyses.get(file.id);
    if (!analysis) throw new Error("PDF_PARSE_FAILED: 缺少已缓存的 PDF 提取结果");
    count +=
      file.kind === "SOCIAL_SECURITY"
        ? analysis.pages.length
        : analysis.estimatedOCRCalls;
  }
  return count;
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
  const resumeData = await fileStorage.read(resumeFile.storage_key);
  const resumeFileCacheKey = contentHash(
    `${PIPELINE_VERSION}:file-ocr:${resumeFile.kind}:${contentHash(resumeData)}`,
  );
  const cachedResumePages = readExtractionCache<DocumentPage[]>(resumeFileCacheKey);
  if (cachedResumePages) {
    pages.push(
      ...cachedResumePages.map((page) => ({
        ...page,
        sourceFile: resumeFile.original_name,
      })),
    );
  } else {
    await withTemporaryDocument(resumeData, ".pdf", async (path) => {
      pages.push(
        ...(await extractResumeDocumentPages({
        path,
        sourceFile: resumeFile.original_name,
        ocr: generalOCR(task),
        analysis: pdfAnalyses.get(resumeFile.id),
        onOCRCall(page, result) {
          logSafeEvent("info", {
            taskId: task.id,
            stage: "OCR_COMPLETED",
            provider: "aliyun-general",
            page,
            requestId: result.requestId,
          });
        },
        })),
      );
    });
    writeExtractionCache(
      resumeFileCacheKey,
      "hybrid",
      "resume-document-pages",
      pages.filter((page) => page.sourceFile === resumeFile.original_name),
    );
  }
  for (const file of socialFiles) {
    const data = await fileStorage.read(file.storage_key);
    const socialFileCacheKey = contentHash(
      `${PIPELINE_VERSION}:file-ocr:${file.kind}:${contentHash(data)}`,
    );
    const cachedSocial = readExtractionCache<{
      pages: DocumentPage[];
      results: SocialSecurityOCRResult[];
    }>(socialFileCacheKey);
    if (cachedSocial) {
      pages.push(...cachedSocial.pages.map((page) => ({ ...page, sourceFile: file.original_name })));
      socialPages.push(
        ...cachedSocial.results.map((result) => ({
          sourceFile: file.original_name,
          result,
        })),
      );
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
          const image = await renderPdfPage(path, page.page);
          const result = await tableOCR(task, image, page.page);
          const selectedText = `${result.rawText}\n${tableRowsText(result)}`;
          const confidences = result.tables
            .map((table) => table.confidence)
            .filter((value): value is number => value !== null);
          const confidence = confidences.length
            ? confidences.reduce((sum, value) => sum + value, 0) / confidences.length
            : null;
          const documentPage: DocumentPage = {
            page: page.page,
            sourceFile: file.original_name,
            pdfText: page.localText,
            ocrText: selectedText,
            selectedText,
            extractionMethod:
              confidence !== null && confidence >= config.OCR_MIN_CONFIDENCE
                ? "ocr"
                : "manual_required",
            qualityScore: confidence === null ? 0 : Math.round(confidence * 100),
            ocrConfidence: confidence,
            warnings:
              confidence !== null && confidence >= config.OCR_MIN_CONFIDENCE
                ? []
                : ["OCR_CONFIDENCE_LOW"],
          };
          pages.push(documentPage);
          fileDocumentPages.push(documentPage);
          socialPages.push({ sourceFile: file.original_name, result });
          fileResults.push(result);
        }
      });
    } else {
      const result = await tableOCR(task, data, 1);
      const selectedText = `${result.rawText}\n${tableRowsText(result)}`;
      const confidences = result.tables
        .map((table) => table.confidence)
        .filter((value): value is number => value !== null);
      const confidence = confidences.length
        ? confidences.reduce((sum, value) => sum + value, 0) / confidences.length
        : null;
      const documentPage: DocumentPage = {
        page: 1,
        sourceFile: file.original_name,
        pdfText: null,
        ocrText: selectedText,
        selectedText,
        extractionMethod:
          confidence !== null && confidence >= config.OCR_MIN_CONFIDENCE
            ? "ocr"
            : "manual_required",
        qualityScore: confidence === null ? 0 : Math.round(confidence * 100),
        ocrConfidence: confidence,
        warnings:
          confidence !== null && confidence >= config.OCR_MIN_CONFIDENCE
            ? []
            : ["OCR_CONFIDENCE_LOW"],
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
  return { resumeSourceFile: resumeFile.original_name, pages, socialPages };
}

function stringEvidence(
  value: string | null,
  record: ParsedSocialSecurityRecord,
  status: EvidenceStringField["status"],
  confidence = record.source.confidence,
): EvidenceStringField {
  return {
    value,
    status,
    sourceFile: record.source.file,
    sourcePage: record.source.page,
    sourceQuote: record.source.quote,
    extractionMethod: "table_ocr",
    confidence: confidence ?? 0,
  };
}

function monthEvidence(
  value: string | null,
  record: ParsedSocialSecurityRecord,
  status: EvidenceMonthField["status"],
  confidence = record.source.confidence,
): EvidenceMonthField {
  return { ...stringEvidence(value, record, status, confidence), value };
}

function numberEvidence(
  value: number | null,
  record: ParsedSocialSecurityRecord,
  status: EvidenceNumberField["status"],
  confidence = record.source.confidence,
): EvidenceNumberField {
  return { ...stringEvidence(null, record, status, confidence), value };
}

function monthsEvidence(
  value: string[] | null,
  record: ParsedSocialSecurityRecord,
  status: EvidenceMonthsField["status"],
  confidence = record.source.confidence,
): EvidenceMonthsField {
  return { ...stringEvidence(null, record, status, confidence), value };
}

function convertParsedRecord(
  record: ParsedSocialSecurityRecord,
  template: "shenzhen" | "guangdong",
): SocialSecurityEvidenceRecord {
  const statusFor = (confidence: number | null) =>
    confidence !== null && confidence >= config.OCR_MIN_CONFIDENCE
      ? ("verified" as const)
      : ("uncertain" as const);
  const companyStatus = statusFor(record.fieldConfidence.company);
  const startStatus = statusFor(record.fieldConfidence.startMonth);
  const endStatus = statusFor(record.fieldConfidence.endMonth);
  const paidStatus = record.paidMonths.length
    ? statusFor(record.fieldConfidence.paidMonths)
    : ("unsupported" as const);
  const companyUncertain = /[OIl]/.test(record.companyRaw);
  const outsourcingOrDispatch = /劳务派遣|人力资源|外包/.test(record.companyRaw);
  return {
    companyRaw: stringEvidence(
      record.companyRaw,
      record,
      companyUncertain ? "uncertain" : companyStatus,
      record.fieldConfidence.company,
    ),
    companyNormalized: normalizeCompanyCandidate(record.companyRaw),
    startMonth: monthEvidence(
      record.startMonth,
      record,
      startStatus,
      record.fieldConfidence.startMonth,
    ),
    endMonth: monthEvidence(
      record.endMonth,
      record,
      endStatus,
      record.fieldConfidence.endMonth,
    ),
    paidMonths: monthsEvidence(
      record.paidMonths.length ? record.paidMonths : null,
      record,
      paidStatus,
      record.fieldConfidence.paidMonths,
    ),
    pensionMonths: numberEvidence(
      record.pensionMonths,
      record,
      record.pensionMonths === null
        ? "unsupported"
        : statusFor(record.fieldConfidence.pensionMonths),
      record.fieldConfidence.pensionMonths,
    ),
    injuryMonths: numberEvidence(
      record.injuryMonths,
      record,
      record.injuryMonths === null
        ? "unsupported"
        : statusFor(record.fieldConfidence.injuryMonths),
      record.fieldConfidence.injuryMonths,
    ),
    unemploymentMonths: numberEvidence(
      record.unemploymentMonths,
      record,
      record.unemploymentMonths === null
        ? "unsupported"
        : statusFor(record.fieldConfidence.unemploymentMonths),
      record.fieldConfidence.unemploymentMonths,
    ),
    personalInsurance: /个人参保|个人缴费|灵活就业/.test(record.companyRaw),
    sourceFile: record.source.file,
    sourcePage: record.source.page,
    sourceEvidence: [record.source.quote],
    template,
    warnings: [
      ...([
        companyStatus,
        startStatus,
        endStatus,
        paidStatus,
      ].every((status) => status === "verified")
        ? []
        : ["OCR_CONFIDENCE_LOW"]),
      ...(companyUncertain ? ["OCR_COMPANY_UNCERTAIN"] : []),
      ...(outsourcingOrDispatch ? ["OUTSOURCING_OR_DISPATCH"] : []),
    ],
  };
}

function unsupportedSocialRecord(
  sourceFile: string,
  page: number,
  quote: string,
): SocialSecurityEvidenceRecord {
  const record: ParsedSocialSecurityRecord = {
    companyRaw: "无法确定",
    companyNormalized: "",
    startMonth: "1970-01",
    endMonth: "1970-01",
    paidMonths: [],
    pensionMonths: null,
    injuryMonths: null,
    unemploymentMonths: null,
    fieldConfidence: {
      company: null,
      startMonth: null,
      endMonth: null,
      paidMonths: null,
      pensionMonths: null,
      injuryMonths: null,
      unemploymentMonths: null,
    },
    source: { file: sourceFile, page, quote, confidence: null },
  };
  return {
    ...convertParsedRecord(record, "guangdong"),
    companyRaw: stringEvidence(null, record, "unsupported"),
    companyNormalized: null,
    startMonth: monthEvidence(null, record, "unsupported"),
    endMonth: monthEvidence(null, record, "unsupported"),
    paidMonths: monthsEvidence(null, record, "unsupported"),
    template: "generic",
    warnings: ["TEMPLATE_UNKNOWN"],
  };
}

function missingResume(pages: DocumentPage[]): ResumeEvidenceExtraction {
  const first = pages[0];
  const sourceFile = first?.sourceFile ?? "unknown";
  const sourcePage = first?.page ?? 1;
  const missing: EvidenceStringField = {
    value: null,
    status: "missing",
    sourceFile,
    sourcePage,
    sourceQuote: "",
    extractionMethod: "deepseek",
    confidence: 0,
  };
  return { candidateName: missing, experiences: [] };
}

async function structureStage(
  task: TaskRow,
  payload: OCRStagePayload,
): Promise<StructuredPayload> {
  const resumePages = payload.pages.filter(
    (page) => page.sourceFile === payload.resumeSourceFile,
  );
  const issues: EvidenceIssue[] = [];
  const manualResume = resumePages.some((page) => page.extractionMethod === "manual_required");
  const deepSeekCacheKey = contentHash(
    `${PIPELINE_VERSION}:deepseek-resume:${JSON.stringify(
      resumePages.map((page) => [page.selectedText, page.extractionMethod]),
    )}`,
  );
  const cachedResume = readExtractionCache<ResumeEvidenceExtraction>(deepSeekCacheKey);
  let resume = manualResume
    ? missingResume(resumePages)
    : ResumeEvidenceExtractionSchema.safeParse(cachedResume).success
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
    writeExtractionCache(deepSeekCacheKey, "deepseek", "resume-evidence-v2", resume);
  } else if (!manualResume) {
    recordApiCall({
      taskId: task.id,
      provider: "deepseek",
      apiType: "chat.completions",
      durationMs: 0,
      cacheHit: true,
      estimatedCost: 0,
    });
  }
  if (manualResume) {
    resumePages
      .filter((page) => page.extractionMethod === "manual_required")
      .forEach((page) => {
        issues.push({
          code: page.warnings.includes("EXTRACTION_CONFLICT")
            ? "EXTRACTION_CONFLICT"
            : "OCR_CONFIDENCE_LOW",
          field: "documentPage",
          sourceFile: page.sourceFile,
          sourcePage: page.page,
          message: "简历页面提取来源冲突或 OCR 置信度不足，禁止自动结构化",
        });
      });
  }
  const social: SocialSecurityEvidenceRecord[] = [];
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
    };
    const parsed: SocialSecurityParseResult = parseSocialSecurityTable({
      ocr: merged,
      sourceFile,
    });
    if (parsed.template === "unknown" || !parsed.records.length) {
      social.push(
        unsupportedSocialRecord(
          sourceFile,
          merged.page,
          merged.rawText || "无法识别表格结构",
        ),
      );
      issues.push({
        code: "TEMPLATE_UNKNOWN",
        field: "socialSecurityTemplate",
        sourceFile,
        sourcePage: merged.page,
        message: parsed.reasons.join("；") || "未知社保模板，必须人工复核",
      });
      continue;
    }
    const converted = parsed.records.map((record) =>
      convertParsedRecord(record, parsed.template as "shenzhen" | "guangdong"),
    );
    if (!parsed.autoVerifiable) {
      converted.forEach((record) => record.warnings.push("TEMPLATE_INCOMPLETE"));
      issues.push({
        code: "TEMPLATE_UNKNOWN",
        field: "socialSecurityTemplate",
        sourceFile,
        sourcePage: merged.page,
        message: parsed.reasons.join("；") || "社保模板字段不完整，必须人工复核",
      });
    }
    social.push(...converted);
  }
  return { resume, social, issues };
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
  const estimatedOCRCalls = await estimateOCRCalls(files, pdfAnalyses);
  updateTask(task.id, {
    estimated_ocr_calls: estimatedOCRCalls,
    schema_version: 2,
    updated_at: new Date().toISOString(),
  });
  assertOCRCapacity(estimatedOCRCalls, Boolean(task.paid_override));

  let ocrPayload = parseOCRStageCache(
    readStageArtifact<OCRStagePayload>(task.id, "OCR_COMPLETED", cacheKey),
  );
  if (!ocrPayload) {
    updateTask(task.id, { stage: "DOCUMENT_EXTRACTED", updated_at: new Date().toISOString() });
    ocrPayload = await extractOCRStage(
      task,
      resumeFile,
      socialFiles,
      pdfAnalyses,
    );
    writeStageArtifact(task.id, "DOCUMENT_EXTRACTED", cacheKey, {
      pages: ocrPayload.pages.map((page) => ({ ...page, ocrText: null })),
    });
    writeStageArtifact(task.id, "OCR_COMPLETED", cacheKey, ocrPayload);
  }
  updateTask(task.id, { stage: "OCR_COMPLETED", updated_at: new Date().toISOString() });

  let structured = parseStructuredCache(
    readStageArtifact<StructuredPayload>(task.id, "STRUCTURED", cacheKey),
  );
  if (!structured) {
    structured = await structureStage(task, ocrPayload);
    writeStageArtifact(task.id, "STRUCTURED", cacheKey, structured);
  }
  updateTask(task.id, { stage: "STRUCTURED", updated_at: new Date().toISOString() });

  let validated = parseStructuredCache(
    readStageArtifact<StructuredPayload>(
      task.id,
      "EVIDENCE_VALIDATED",
      cacheKey,
    ),
  );
  if (!validated) {
    const resumeValidation = validateResumeEvidence(structured.resume, ocrPayload.pages);
    const socialValidation = validateSocialEvidence(structured.social, ocrPayload.pages);
    validated = {
      resume: resumeValidation.value,
      social: socialValidation.value,
      issues: [
        ...structured.issues,
        ...resumeValidation.issues,
        ...socialValidation.issues,
      ],
    };
    writeStageArtifact(task.id, "EVIDENCE_VALIDATED", cacheKey, validated);
  }
  updateTask(task.id, { stage: "EVIDENCE_VALIDATED", updated_at: new Date().toISOString() });

  let items = readStageArtifact<VerificationV2Item[]>(task.id, "VERIFIED", cacheKey);
  if (!items) {
    items = verifyEvidenceRecords({
      resumeExperiences: validated.resume.experiences,
      socialSecurityRecords: validated.social,
    });
    if (!items.length || validated.issues.length) {
      items.push({
        status: "MANUAL_REVIEW_REQUIRED",
        description: "存在未通过证据校验的页面或字段，禁止自动形成核验结论",
        rules: ["Evidence Validator 失败必须人工复核"],
      });
    }
    writeStageArtifact(task.id, "VERIFIED", cacheKey, items);
  }
  updateTask(task.id, { stage: "VERIFIED", updated_at: new Date().toISOString() });
  const usage = usageForTask(task.id);
  const report = createEvidenceReport({
    candidateName: validated.resume.candidateName.value ?? "姓名待人工确认",
    documentPages: ocrPayload.pages,
    resumeExtraction: validated.resume,
    socialSecurityRecords: validated.social,
    evidenceIssues: validated.issues,
    items,
    usage,
  });
  const now = new Date().toISOString();
  updateTask(task.id, {
    status: "COMPLETED",
    stage: "COMPLETED",
    candidate_name: report.candidateName,
    resume_json: JSON.stringify(validated.resume),
    social_security_json: JSON.stringify(validated.social),
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
           AND task_schema_version >= ?
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
