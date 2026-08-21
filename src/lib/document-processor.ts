import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { config } from "./config";
import type { OCRProvider } from "./ocr";

const exec = promisify(execFile);

export type DocumentAnalysis = {
  pages: Array<{ page: number; localText: string | null }>;
  estimatedOCRCalls: number;
};

function usableText(text: string) {
  const compact = text.replace(/\s/g, "");
  if (compact.length < 20) return false;
  const replacementRatio = (compact.match(/\uFFFD/g)?.length ?? 0) / compact.length;
  return replacementRatio < 0.1;
}

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
      pages.push({ page, localText: usableText(text) ? text : null });
    }
    return {
      pages,
      estimatedOCRCalls: pages.filter((page) => page.localText === null).length,
    };
  } catch (error) {
    throw new Error(`PDF_PARSE_FAILED: ${error instanceof Error ? error.message : "PDF 解析失败"}`);
  }
}

export async function processPdf(
  path: string,
  analysis: DocumentAnalysis,
  ocr: OCRProvider,
  onOCRCall: () => void,
): Promise<string> {
  const output: string[] = [];
  for (const page of analysis.pages) {
    if (page.localText !== null) {
      output.push(page.localText);
      continue;
    }
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
