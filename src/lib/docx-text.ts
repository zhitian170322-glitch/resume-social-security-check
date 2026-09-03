import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

function xmlToText(xml: string): string {
  return xml
    .replace(/<w:tab\b[^/]*\/>/gu, "\t")
    .replace(/<w:br\b[^/]*\/>/gu, "\n")
    .replace(/<\/w:p>/gu, "\n")
    .replace(/<[^>]+>/gu, "")
    .replace(/&amp;/gu, "&")
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&quot;/gu, '"')
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

export async function extractDocxNativeText(path: string): Promise<string> {
  try {
    const { stdout } = await exec("unzip", ["-p", path, "word/document.xml"], {
      maxBuffer: 8 * 1024 * 1024,
      timeout: 15_000,
    });
    return xmlToText(stdout);
  } catch {
    return "";
  }
}
