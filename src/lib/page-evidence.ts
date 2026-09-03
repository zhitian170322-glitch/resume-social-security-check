import { pageFingerprint } from "./material-dedup";
import { normalizeComparableText, type HybridSourceKind } from "./hybrid-text";

export type PageEvidence = {
  source: HybridSourceKind;
  pageNumber: number;
  rawText: string;
  normalizedText: string;
  requestId: string | null;
  confidence: number | null;
  bbox: { x: number; y: number; width: number; height: number } | null;
  sourceFileId: string;
  pageFingerprint: string;
};

export function buildPageEvidence(input: {
  source: HybridSourceKind;
  pageNumber: number;
  rawText: string | null;
  requestId?: string | null;
  confidence?: number | null;
  bbox?: PageEvidence["bbox"];
  sourceFileId: string;
}): PageEvidence {
  const rawText = input.rawText ?? "";
  return {
    source: input.source,
    pageNumber: input.pageNumber,
    rawText,
    normalizedText: normalizeComparableText(rawText),
    requestId: input.requestId ?? null,
    confidence: input.confidence ?? null,
    bbox: input.bbox ?? null,
    sourceFileId: input.sourceFileId,
    pageFingerprint: pageFingerprint(rawText),
  };
}

export function sourceLabel(source: HybridSourceKind | "pdf_text" | "ocr" | "hybrid" | "manual_required") {
  if (source === "native_text" || source === "pdf_text") return "原生文字";
  if (source === "general_ocr" || source === "ocr") return "General OCR";
  if (source === "table_ocr") return "Table OCR";
  if (source === "manual" || source === "manual_required") return "人工修正";
  return "混合来源";
}
