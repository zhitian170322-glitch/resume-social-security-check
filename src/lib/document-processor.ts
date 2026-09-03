import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { config } from "./config";
import type { OCRProvider } from "./ocr";
import { TextQualityEvaluator } from "./text-quality";
import type { DocumentPage } from "./schemas";
import { mergeDualTextSources } from "./hybrid-text";
import { buildPageEvidence } from "./page-evidence";
import { fileFingerprint, pageFingerprint, shouldSkipDuplicate } from "./material-dedup";
import { mapLimit, OCR_RENDER_DPI, preprocessPageImage } from "./ocr-runtime";
import { extractDocxNativeText } from "./docx-text";

const exec = promisify(execFile);

export type DocumentAnalysis = {
  pages: Array<{
    page: number;
    localText: string | null;
    qualityScore: number;
    warnings: string[];
    ocrRecommended: boolean;
  }>;
  estimatedOCRCalls: number;
};

export async function analyzePdf(path: string): Promise<DocumentAnalysis> {
  try {
    const { stdout } = await exec("pdfinfo", [path], { maxBuffer: 1024 * 1024 });
    const pageMatch = stdout.match(/^Pages:\s+(\d+)/m);
    if (!pageMatch) throw new Error("无法读取 PDF 页数");
    const pages = [];
    for (let page = 1; page <= Number(pageMatch[1]); page += 1) {
      const { stdout: text } = await exec(
        "pdftotext",
        ["-f", String(page), "-l", String(page), "-layout", "-enc", "UTF-8", path, "-"],
        { maxBuffer: 8 * 1024 * 1024 },
      );
      const quality = new TextQualityEvaluator({
        ocrScoreThreshold: config.TEXT_QUALITY_MIN_SCORE,
      }).evaluate(text);
      pages.push({
        page,
        localText: text.trim() ? text : null,
        qualityScore: quality.score,
        warnings: quality.warnings,
        ocrRecommended:
          quality.ocrRecommended ||
          quality.warnings.some((warning) =>
            [
              "suspicious_two_column_order",
              "possible_table_structure_loss",
            ].includes(
              warning,
            ),
          ),
      });
    }
    return {
      pages,
      estimatedOCRCalls: pages.length,
    };
  } catch (error) {
    throw new Error(`PDF_PARSE_FAILED: ${error instanceof Error ? error.message : "PDF 解析失败"}`);
  }
}

function criticalTokens(text: string) {
  const dates =
    text.match(/(?:19|20)\d{2}\s*(?:[.\-/年]?\s*(?:0?[1-9]|1[0-2]))/g) ?? [];
  const companies = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /公司|集团|企业|事务所|研究院|中心|厂/.test(line));
  return new Set([...dates, ...companies].map((value) => value.replace(/\s/g, "")));
}

function extractionConflict(pdfText: string, ocrText: string) {
  const pdf = criticalTokens(pdfText);
  const ocr = criticalTokens(ocrText);
  if (!pdf.size || !ocr.size) return true;
  const shared = [...pdf].filter((token) => ocr.has(token)).length;
  return 1 - shared / Math.max(pdf.size, ocr.size) > config.EXTRACTION_CONFLICT_THRESHOLD;
}

function buildResumePage(input: {
  page: number;
  sourceFile: string;
  pdfText: string | null;
  ocrText: string | null;
  pdfQualityScore: number;
  ocrQualityScore: number | null;
  ocrConfidence: number | null;
  ocrRequestId: string | null;
  extraWarnings?: string[];
}): DocumentPage {
  const merged = mergeDualTextSources({
    nativeText: input.pdfText,
    ocrText: input.ocrText,
  });
  let extractionMethod: DocumentPage["extractionMethod"] = "hybrid";
  if (merged.decision === "native" || merged.decision === "agreed") {
    extractionMethod = input.ocrText ? "hybrid" : "pdf_text";
  }
  if (merged.decision === "native" && !input.ocrText) extractionMethod = "pdf_text";
  if (merged.decision === "ocr") extractionMethod = "ocr";
  if (merged.decision === "conflict" || merged.decision === "empty") {
    extractionMethod = "manual_required";
  }
  const warnings = [...(input.extraWarnings ?? [])];
  if (merged.decision === "conflict") warnings.push("SOURCE_CONFLICT");
  if (
    input.pdfText &&
    input.ocrText &&
    extractionConflict(input.pdfText, input.ocrText)
  ) {
    warnings.push("EXTRACTION_CONFLICT");
  }
  if (
    input.ocrText &&
    input.ocrConfidence !== null &&
    input.ocrConfidence < config.OCR_MIN_CONFIDENCE
  ) {
    warnings.push("OCR_CONFIDENCE_LOW");
  }
  return {
    page: input.page,
    sourceFile: input.sourceFile,
    pdfText: input.pdfText,
    ocrText: input.ocrText,
    selectedText: merged.selectedText,
    extractionMethod,
    qualityScore: Math.max(input.pdfQualityScore, input.ocrQualityScore ?? 0),
    ocrConfidence: input.ocrConfidence,
    warnings: [...new Set(warnings)],
    mergeDecision: merged.decision,
    sourceConflicts: merged.conflicts,
    pageEvidence: [
      buildPageEvidence({
        source: "native_text",
        pageNumber: input.page,
        rawText: input.pdfText,
        sourceFileId: input.sourceFile,
      }),
      buildPageEvidence({
        source: "general_ocr",
        pageNumber: input.page,
        rawText: input.ocrText,
        requestId: input.ocrRequestId,
        confidence: input.ocrConfidence,
        sourceFileId: input.sourceFile,
      }),
    ],
  };
}

export async function extractResumeDocumentPages(input: {
  path: string;
  sourceFile: string;
  ocr: OCRProvider | null;
  analysis?: DocumentAnalysis;
  seenFingerprints?: Set<string>;
  onDuplicatePage?: (page: number) => void;
  onOCRCall?: (page: number, result: Awaited<ReturnType<OCRProvider["recognize"]>>) => void;
}): Promise<DocumentPage[]> {
  const analysis = input.analysis ?? (await analyzePdf(input.path));
  const evaluator = new TextQualityEvaluator({
    ocrScoreThreshold: config.TEXT_QUALITY_MIN_SCORE,
  });
  const seen = input.seenFingerprints ?? new Set<string>();
  const plans = analysis.pages.map((page) => {
    const pdfText = page.localText;
    const pdfQuality = evaluator.evaluate(pdfText ?? "");
    const usefulNative = (pdfText ?? "").replace(/\s+/gu, "").length >= 20;
    const nativeFp = pageFingerprint(pdfText ?? "");
    const duplicateNative = usefulNative && seen.has(nativeFp);
    if (usefulNative) seen.add(nativeFp);
    return { page, pdfText, pdfQuality, duplicateNative };
  });
  const ocrByPage = new Map<
    number,
    {
      text: string | null;
      confidence: number | null;
      requestId: string | null;
      qualityScore: number | null;
      failed: boolean;
      skipped: boolean;
    }
  >();
  const ocrTargets = plans.filter((plan) => !plan.duplicateNative && input.ocr);
  await mapLimit(ocrTargets, config.OCR_MAX_CONCURRENCY, async (plan) => {
    try {
      const rendered = await renderPdfPage(
        input.path,
        plan.page.page,
        config.OCR_RENDER_DPI || OCR_RENDER_DPI,
      );
      const image = await preprocessPageImage(rendered);
      if (shouldSkipDuplicate(seen, fileFingerprint(image))) {
        ocrByPage.set(plan.page.page, {
          text: null,
          confidence: null,
          requestId: null,
          qualityScore: null,
          failed: false,
          skipped: true,
        });
        input.onDuplicatePage?.(plan.page.page);
        return;
      }
      const result = await input.ocr!.recognize(image, "image/png");
      input.onOCRCall?.(plan.page.page, result);
      ocrByPage.set(plan.page.page, {
        text: result.text || null,
        confidence: result.confidence,
        requestId: result.requestId ?? null,
        qualityScore: evaluator.evaluate(result.text).score,
        failed: false,
        skipped: false,
      });
    } catch {
      ocrByPage.set(plan.page.page, {
        text: null,
        confidence: null,
        requestId: null,
        qualityScore: null,
        failed: true,
        skipped: false,
      });
    }
  });
  const pages: DocumentPage[] = [];
  for (const plan of plans) {
    if (plan.duplicateNative) {
      input.onDuplicatePage?.(plan.page.page);
      continue;
    }
    const ocr = ocrByPage.get(plan.page.page);
    if (ocr?.skipped) continue;
    if (!input.ocr && !plan.pdfText) {
      throw new Error("阿里云 OCR 凭证未配置");
    }
    pages.push(
      buildResumePage({
        page: plan.page.page,
        sourceFile: input.sourceFile,
        pdfText: plan.pdfText,
        ocrText: ocr?.text ?? null,
        pdfQualityScore: plan.pdfQuality.score,
        ocrQualityScore: ocr?.qualityScore ?? null,
        ocrConfidence: ocr?.confidence ?? null,
        ocrRequestId: ocr?.requestId ?? null,
        extraWarnings: [
          ...plan.pdfQuality.warnings,
          ...(ocr?.failed ? ["OCR_PAGE_FAILED"] : []),
        ],
      }),
    );
  }
  return pages;
}

export async function extractResumeImagePage(input: {
  data: Buffer;
  sourceFile: string;
  ocr: OCRProvider | null;
  seenFingerprints?: Set<string>;
  onDuplicatePage?: (page: number) => void;
  onOCRCall?: (page: number, result: Awaited<ReturnType<OCRProvider["recognize"]>>) => void;
}): Promise<DocumentPage[]> {
  const imageFp = fileFingerprint(input.data);
  if (input.seenFingerprints && shouldSkipDuplicate(input.seenFingerprints, imageFp)) {
    input.onDuplicatePage?.(1);
    return [];
  }
  input.seenFingerprints?.add(imageFp);
  if (!input.ocr) throw new Error("阿里云 OCR 凭证未配置");
  const warnings: string[] = [];
  let ocrText: string | null = null;
  let ocrConfidence: number | null = null;
  let ocrRequestId: string | null = null;
  let ocrQualityScore: number | null = null;
  try {
    const image = await preprocessPageImage(input.data);
    const result = await input.ocr.recognize(image, "image/png");
    input.onOCRCall?.(1, result);
    ocrText = result.text || null;
    ocrConfidence = result.confidence;
    ocrRequestId = result.requestId ?? null;
    ocrQualityScore = new TextQualityEvaluator({
      ocrScoreThreshold: config.TEXT_QUALITY_MIN_SCORE,
    }).evaluate(result.text).score;
  } catch {
    warnings.push("OCR_PAGE_FAILED");
  }
  return [
    buildResumePage({
      page: 1,
      sourceFile: input.sourceFile,
      pdfText: null,
      ocrText,
      pdfQualityScore: 0,
      ocrQualityScore,
      ocrConfidence,
      ocrRequestId,
      extraWarnings: warnings,
    }),
  ];
}

export async function extractResumeDocxPages(input: {
  path: string;
  sourceFile: string;
}): Promise<DocumentPage[]> {
  const native = await extractDocxNativeText(input.path);
  return [
    buildResumePage({
      page: 1,
      sourceFile: input.sourceFile,
      pdfText: native || null,
      ocrText: null,
      pdfQualityScore: native ? 90 : 0,
      ocrQualityScore: null,
      ocrConfidence: null,
      ocrRequestId: null,
      extraWarnings: native ? [] : ["NATIVE_TEXT_EMPTY"],
    }),
  ];
}

export async function processPdf(
  path: string,
  analysis: DocumentAnalysis,
  ocr: OCRProvider | null,
  onOCRCall: () => void,
): Promise<string> {
  const output: string[] = [];
  for (const page of analysis.pages) {
    if (page.localText !== null) {
      output.push(page.localText);
      continue;
    }
    if (!ocr) throw new Error("阿里云 OCR 凭证未配置");
    const prefix = join(config.PROCESSING_DIR, `${randomUUID()}-page`);
    try {
      await exec(
        "pdftoppm",
        ["-f", String(page.page), "-l", String(page.page), "-r", "150", "-singlefile", "-png", path, prefix],
        { maxBuffer: 1024 * 1024, timeout: 60_000 },
      );
      const image = await readFile(`${prefix}.png`);
      const result = await ocr.recognize(image, "image/png");
      onOCRCall();
      output.push(result.text);
    } finally {
      await rm(`${prefix}.png`, { force: true });
    }
  }
  return output.join("\n\n");
}

export async function renderPdfPage(
  path: string,
  page: number,
  dpi = OCR_RENDER_DPI,
): Promise<Buffer> {
  const prefix = join(config.PROCESSING_DIR, `${randomUUID()}-page`);
  try {
    await exec(
      "pdftoppm",
      [
        "-f",
        String(page),
        "-l",
        String(page),
        "-r",
        String(dpi),
        "-singlefile",
        "-png",
        path,
        prefix,
      ],
      { maxBuffer: 1024 * 1024, timeout: 60_000 },
    );
    return await readFile(`${prefix}.png`);
  } finally {
    await rm(`${prefix}.png`, { force: true });
  }
}

export async function withTemporaryDocument<T>(
  data: Buffer,
  extension: string,
  operation: (path: string) => Promise<T>,
): Promise<T> {
  await mkdir(config.PROCESSING_DIR, { recursive: true });
  const path = join(config.PROCESSING_DIR, `${randomUUID()}${extension}`);
  await writeFile(path, data, { mode: 0o600 });
  try {
    return await operation(path);
  } finally {
    await rm(path, { force: true });
  }
}
