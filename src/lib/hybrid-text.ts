export type HybridSourceKind = "native_text" | "general_ocr" | "table_ocr" | "manual";

export type HybridMergeDecision =
  | "agreed"
  | "native"
  | "ocr"
  | "merged"
  | "conflict"
  | "empty";

export type SourceQualityMetrics = {
  usefulCharacters: number;
  chineseRatio: number;
  latinRatio: number;
  digitRatio: number;
  nonPrintableRatio: number;
  replacementCount: number;
  repeatedGarbageRatio: number;
  lineStructureScore: number;
  datePatternCount: number;
  companyKeywordCount: number;
  garbage: boolean;
  complete: boolean;
  score: number;
};

export type FieldConflict = {
  field: "company" | "name" | "position" | "month";
  nativeValues: string[];
  ocrValues: string[];
};

export type HybridMergeResult = {
  selectedText: string | null;
  decision: HybridMergeDecision;
  conflicts: FieldConflict[];
  nativeQuality: SourceQualityMetrics;
  ocrQuality: SourceQualityMetrics;
};

const COMPANY_LINE =
  /(?:公司|集团|事务所|中心|工厂|银行|学校|医院|合作社|企业|研究院)/u;
const DATE_PATTERN =
  /(?:19|20)\d{2}\s*(?:[.\-/年]\s*)?(?:0?[1-9]|1[0-2])/gu;
const POSITION_PATTERN = /(?:工程师|经理|总监|专员|助理|主管|开发|设计|会计|顾问)/u;
const NAME_PATTERN = /姓名[:：]\s*([^\s,，。]{1,20})/u;

export function normalizeComparableText(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[\u3000]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

export function normalizePageLines(value: string): string[] {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const raw of value.split(/\r?\n/u)) {
    const line = normalizeComparableText(raw);
    if (!line || seen.has(line)) continue;
    seen.add(line);
    lines.push(line);
  }
  return lines;
}

export function evaluateSourceQuality(text: string): SourceQualityMetrics {
  const raw = text ?? "";
  const useful = raw.replace(/\s+/gu, "");
  const usefulCharacters = useful.length;
  const chinese = (useful.match(/[\u4e00-\u9fff]/gu) ?? []).length;
  const latin = (useful.match(/[A-Za-z]/gu) ?? []).length;
  const digit = (useful.match(/\d/gu) ?? []).length;
  const nonPrintable = (raw.match(/[^\P{C}\n\t]/gu) ?? []).length;
  const replacementCount = (raw.match(/�/gu) ?? []).length;
  const lines = raw.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  const uniqueLines = new Set(lines.map((line) => normalizeComparableText(line)));
  const repeatedGarbageRatio =
    lines.length === 0 ? 0 : 1 - uniqueLines.size / lines.length;
  const datePatternCount = raw.match(DATE_PATTERN)?.length ?? 0;
  const companyKeywordCount = lines.filter((line) => COMPANY_LINE.test(line)).length;
  const longLines = lines.filter((line) => line.length >= 6).length;
  const lineStructureScore = lines.length
    ? Math.round((longLines / lines.length) * 100)
    : 0;
  const garbage =
    usefulCharacters < 12 ||
    replacementCount >= 2 ||
    nonPrintable / Math.max(raw.length, 1) > 0.08 ||
    repeatedGarbageRatio > 0.55 ||
    (replacementCount >= 1 && companyKeywordCount === 0 && datePatternCount === 0);
  const complete =
    !garbage &&
    usefulCharacters >= 40 &&
    (companyKeywordCount > 0 || datePatternCount > 0);
  const score = Math.max(
    0,
    Math.min(
      100,
      usefulCharacters / 2 +
        companyKeywordCount * 8 +
        datePatternCount * 6 +
        lineStructureScore / 4 -
        replacementCount * 15 -
        repeatedGarbageRatio * 40,
    ),
  );
  return {
    usefulCharacters,
    chineseRatio: usefulCharacters ? chinese / usefulCharacters : 0,
    latinRatio: usefulCharacters ? latin / usefulCharacters : 0,
    digitRatio: usefulCharacters ? digit / usefulCharacters : 0,
    nonPrintableRatio: raw.length ? nonPrintable / raw.length : 0,
    replacementCount,
    repeatedGarbageRatio,
    lineStructureScore,
    datePatternCount,
    companyKeywordCount,
    garbage,
    complete,
    score,
  };
}

function tokens(text: string, kind: FieldConflict["field"]): string[] {
  const lines = normalizePageLines(text);
  if (kind === "company") {
    return lines.filter((line) => COMPANY_LINE.test(line));
  }
  if (kind === "month") {
    return [...text.matchAll(DATE_PATTERN)].map((match) =>
      normalizeComparableText(match[0]),
    );
  }
  if (kind === "position") {
    return lines.filter((line) => POSITION_PATTERN.test(line));
  }
  const names = [...text.matchAll(new RegExp(NAME_PATTERN, "gu"))].map((match) =>
    normalizeComparableText(match[1] ?? ""),
  );
  return names.filter(Boolean);
}

function conflictFor(
  field: FieldConflict["field"],
  native: string,
  ocr: string,
): FieldConflict | null {
  const nativeValues = [...new Set(tokens(native, field))];
  const ocrValues = [...new Set(tokens(ocr, field))];
  if (!nativeValues.length || !ocrValues.length) return null;
  if (field === "month") {
    const same =
      nativeValues.length === ocrValues.length &&
      nativeValues.every((value) => ocrValues.includes(value));
    return same ? null : { field, nativeValues, ocrValues };
  }
  const overlap = nativeValues.filter((value) => ocrValues.includes(value));
  if (overlap.length) return null;
  return { field, nativeValues, ocrValues };
}

export function detectFieldConflicts(native: string, ocr: string): FieldConflict[] {
  return (["company", "name", "position", "month"] as const)
    .map((field) => conflictFor(field, native, ocr))
    .filter((item): item is FieldConflict => Boolean(item));
}

export function mergeDualTextSources(input: {
  nativeText: string | null;
  ocrText: string | null;
}): HybridMergeResult {
  const native = input.nativeText?.trim() ? input.nativeText : "";
  const ocr = input.ocrText?.trim() ? input.ocrText : "";
  const nativeQuality = evaluateSourceQuality(native);
  const ocrQuality = evaluateSourceQuality(ocr);
  if (!native && !ocr) {
    return {
      selectedText: null,
      decision: "empty",
      conflicts: [],
      nativeQuality,
      ocrQuality,
    };
  }
  if (native && ocr && normalizeComparableText(native) === normalizeComparableText(ocr)) {
    return {
      selectedText: native,
      decision: "agreed",
      conflicts: [],
      nativeQuality,
      ocrQuality,
    };
  }
  if (native && !nativeQuality.garbage && (ocrQuality.garbage || !ocr)) {
    return {
      selectedText: native,
      decision: "native",
      conflicts: [],
      nativeQuality,
      ocrQuality,
    };
  }
  if (ocr && !ocrQuality.garbage && (nativeQuality.garbage || !native)) {
    return {
      selectedText: ocr,
      decision: "ocr",
      conflicts: [],
      nativeQuality,
      ocrQuality,
    };
  }
  const conflicts = native && ocr ? detectFieldConflicts(native, ocr) : [];
  if (conflicts.length) {
    return {
      selectedText: native || ocr,
      decision: "conflict",
      conflicts,
      nativeQuality,
      ocrQuality,
    };
  }
  if (native && ocr) {
    const merged = [...normalizePageLines(native), ...normalizePageLines(ocr)];
    const unique = [...new Set(merged)];
    return {
      selectedText: unique.join("\n"),
      decision: "merged",
      conflicts: [],
      nativeQuality,
      ocrQuality,
    };
  }
  return {
    selectedText: native || ocr || null,
    decision: native ? "native" : "ocr",
    conflicts: [],
    nativeQuality,
    ocrQuality,
  };
}
