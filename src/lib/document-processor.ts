import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { config } from "./config";
import type { OCRProvider } from "./ocr";
import { TextQualityEvaluator } from "./text-quality";
import type { DocumentPage } from "./schemas";

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
      estimatedOCRCalls: pages.filter(
        (page) => page.localText === null || page.ocrRecommended,
      ).length,
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

export async function extractResumeDocumentPages(input: {
  path: string;
  sourceFile: string;
  ocr: OCRProvider | null;
  analysis?: DocumentAnalysis;
  onOCRCall?: (page: number, result: Awaited<ReturnType<OCRProvider["recognize"]>>) => void;
}): Promise<DocumentPage[]> {
  const analysis = input.analysis ?? (await analyzePdf(input.path));
  const evaluator = new TextQualityEvaluator({
    ocrScoreThreshold: config.TEXT_QUALITY_MIN_SCORE,
  });
  const pages: DocumentPage[] = [];
  for (const page of analysis.pages) {
    const pdfText = page.localText;
    const pdfQuality = evaluator.evaluate(pdfText ?? "");
    const complexLayout = pdfQuality.warnings.some((warning) =>
      [
        "suspicious_two_column_order",
        "possible_table_structure_loss",
      ].includes(
        warning,
      ),
    );
    const shouldOCR =
      !pdfText ||
      pdfQuality.ocrRecommended ||
      (config.RESUME_DUAL_CHANNEL_ON_WARNING && complexLayout);
    let ocrText: string | null = null;
    let ocrConfidence: number | null = null;
    let ocrQualityScore: number | null = null;
    const warnings: string[] = [...pdfQuality.warnings];
    if (shouldOCR) {
      if (!input.ocr) throw new Error("阿里云 OCR 凭证未配置");
      const image = await renderPdfPage(input.path, page.page);
      const result = await input.ocr.recognize(image, "image/png");
      input.onOCRCall?.(page.page, result);
      ocrText = result.text;
      ocrConfidence = result.confidence;
      ocrQualityScore = evaluator.evaluate(result.text).score;
    }
    let selectedText = pdfText;
    let extractionMethod: DocumentPage["extractionMethod"] = "pdf_text";
    if (!pdfText && ocrText) {
      selectedText = ocrText;
      extractionMethod = "ocr";
    } else if (pdfText && ocrText) {
      if (extractionConflict(pdfText, ocrText)) {
        selectedText = null;
        extractionMethod = "manual_required";
        warnings.push("EXTRACTION_CONFLICT");
      } else {
        selectedText =
          complexLayout || pdfQuality.score < config.TEXT_QUALITY_MIN_SCORE
            ? ocrText
            : pdfText;
        extractionMethod = "hybrid";
      }
    }
    if (
      shouldOCR &&
      (ocrConfidence === null ||
        ocrConfidence < config.OCR_MIN_CONFIDENCE ||
        (ocrQualityScore !== null && ocrQualityScore < config.TEXT_QUALITY_MIN_SCORE))
    ) {
      selectedText = null;
      extractionMethod = "manual_required";
      warnings.push("OCR_CONFIDENCE_LOW");
    }
    pages.push({
      page: page.page,
      sourceFile: input.sourceFile,
      pdfText,
      ocrText,
      selectedText,
      extractionMethod,
      qualityScore:
        extractionMethod === "ocr" ||
        (extractionMethod === "hybrid" &&
          (complexLayout || pdfQuality.score < config.TEXT_QUALITY_MIN_SCORE))
          ? (ocrQualityScore ?? 0)
          : pdfQuality.score,
      ocrConfidence,
      warnings: [...new Set(warnings)],
    });
  }
  return pages;
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
  dpi = 200,
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
