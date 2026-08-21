import { extname } from "node:path";
import { db, type TaskRow } from "./db";
import { fileStorage } from "./file-storage";
import {
  analyzePdf,
  processPdf,
  withTemporaryDocument,
  type DocumentAnalysis,
} from "./document-processor";
import {
  AliyunOCRProvider,
  OCRLimitError,
  type OCRProvider,
  assertOCRCapacity,
  recordOCRCall,
} from "./ocr";
import { extractResume, extractSocialSecurity } from "./deepseek";
import { verifyEmployment } from "./verification-engine";
import { createReport } from "./result";
import { safeErrorMessage } from "./errors";

type FileRow = {
  id: string;
  kind: "RESUME" | "SOCIAL_SECURITY";
  original_name: string;
  storage_key: string;
  mime_type: string;
};

const workerGlobal = globalThis as typeof globalThis & { verificationWorkerRunning?: boolean };

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
         ORDER BY created_at LIMIT 1`,
      )
      .get() as TaskRow | undefined;
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

async function analyzeFile(file: FileRow, data: Buffer) {
  if (file.mime_type !== "application/pdf") return null;
  return withTemporaryDocument(data, ".pdf", analyzePdf);
}

async function processTask(task: TaskRow) {
  const files = db
    .prepare("SELECT * FROM task_files WHERE task_id = ? ORDER BY kind, created_at")
    .all(task.id) as FileRow[];
  const resumeFile = files.find((file) => file.kind === "RESUME");
  const socialFiles = files.filter((file) => file.kind === "SOCIAL_SECURITY");
  if (!resumeFile || !socialFiles.length) throw new Error("INVALID_FILE_TYPE");

  updateTask(task.id, { stage: "RESUME_READ", updated_at: new Date().toISOString() });
  updateTask(task.id, { stage: "SOCIAL_SECURITY_READ", updated_at: new Date().toISOString() });

  const analyses = new Map<string, DocumentAnalysis>();
  let estimatedOCRCalls = 0;
  for (const file of files) {
    const analysis = await analyzeFile(file, await fileStorage.read(file.storage_key));
    if (analysis) {
      analyses.set(file.id, analysis);
      estimatedOCRCalls += analysis.estimatedOCRCalls;
    } else {
      estimatedOCRCalls += 1;
    }
  }
  updateTask(task.id, { estimated_ocr_calls: estimatedOCRCalls });
  try {
    assertOCRCapacity(estimatedOCRCalls, Boolean(task.paid_override));
  } catch (error) {
    if (error instanceof OCRLimitError && error.code === "OCR_CONFIRM_REQUIRED") {
      updateTask(task.id, {
        status: "PENDING",
        stage: "AWAITING_OCR_CONFIRMATION",
        error_code: error.code,
        error_message: error.message,
        updated_at: new Date().toISOString(),
      });
      return;
    }
    throw error;
  }

  const ocr: OCRProvider | null = estimatedOCRCalls ? new AliyunOCRProvider() : null;
  const readText = async (file: FileRow) => {
    const data = await fileStorage.read(file.storage_key);
    if (file.mime_type !== "application/pdf") {
      if (!ocr) throw new Error("阿里云 OCR 凭证未配置");
      const result = await ocr.recognize(data, file.mime_type);
      recordOCRCall(task.id, Boolean(task.paid_override));
      return result.text;
    }
    return withTemporaryDocument(data, extname(file.original_name) || ".pdf", (path) =>
      processPdf(path, analyses.get(file.id)!, ocr, () =>
        recordOCRCall(task.id, Boolean(task.paid_override)),
      ),
    );
  };

  updateTask(task.id, { stage: "OCR_PROCESSING", updated_at: new Date().toISOString() });
  const resumeText = await readText(resumeFile);
  const socialTexts = [];
  for (const file of socialFiles) {
    socialTexts.push({ sourceFile: file.original_name, text: await readText(file) });
  }

  updateTask(task.id, { stage: "EXTRACTING", updated_at: new Date().toISOString() });
  const resume = await extractResume(resumeText);
  const social = await extractSocialSecurity(socialTexts);
  updateTask(task.id, {
    candidate_name: resume.candidateName,
    resume_json: JSON.stringify(resume),
    social_security_json: JSON.stringify(social),
    stage: "VERIFYING",
    updated_at: new Date().toISOString(),
  });
  const items = verifyEmployment({
    resumeExperiences: resume.resumeExperiences,
    socialSecurityRecords: social.socialSecurityRecords,
  });
  const report = createReport(
    resume.candidateName,
    resume.resumeExperiences.length,
    new Set(
      social.socialSecurityRecords.map((record) => record.verifiedSocialSecurityCompany),
    ).size,
    items,
  );
  const now = new Date().toISOString();
  updateTask(task.id, {
    status: "COMPLETED",
    stage: "COMPLETED",
    result_json: JSON.stringify(report),
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
  if (error instanceof OCRLimitError) return "OCR_FAILED";
  if (text.includes("OCR") || text.includes("阿里云")) return "OCR_FAILED";
  return "VERIFICATION_FAILED";
}

async function runWorker() {
  try {
    let task = claimNextTask();
    while (task) {
      try {
        await processTask(task);
      } catch (error) {
        const code = classifyError(error);
        const detail = error instanceof Error ? error.message : "";
        const missingCredential =
          detail.includes("OCR 凭证未配置") || detail.includes("API Key 未配置");
        updateTask(task.id, {
          status: "FAILED",
          stage: "FAILED",
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
        "SELECT 1 FROM verification_tasks WHERE status = 'PENDING' AND stage = 'FILES_SAVED' LIMIT 1",
      )
      .get();
    if (pending) kickWorker();
  }
}

export function kickWorker() {
  if (workerGlobal.verificationWorkerRunning) return;
  workerGlobal.verificationWorkerRunning = true;
  setImmediate(() => void runWorker());
}
