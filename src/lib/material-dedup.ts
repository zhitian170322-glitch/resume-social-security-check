import { createHash } from "node:crypto";

export function normalizePageText(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/(?:第\s*\d+\s*页|\d+\s*\/\s*\d+)/gu, " ")
    .replace(/[ \t\f\v]+/gu, " ")
    .replace(/\s*\n\s*/gu, "\n")
    .replace(/\n{2,}/gu, "\n")
    .trim();
}

export function pageFingerprint(text: string): string {
  return createHash("sha256").update(normalizePageText(text)).digest("hex");
}

export function fileFingerprint(content: Buffer | string): string {
  return createHash("sha256").update(content).digest("hex");
}

export function shouldSkipDuplicate(seen: Set<string>, fingerprint: string): boolean {
  if (seen.has(fingerprint)) return true;
  seen.add(fingerprint);
  return false;
}
