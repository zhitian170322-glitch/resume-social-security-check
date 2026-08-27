export type OcrTableCell = {
  row: number;
  column: number;
  text: string;
};

export type OcrTable = {
  cells: OcrTableCell[];
};

export type OcrPage = {
  page: number;
  rawText: string;
  tables: OcrTable[];
  requestId?: string;
};

export type OcrAdapterNote = {
  topLevelKeys: string[];
  requestId?: string;
};

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function first(record: UnknownRecord | null, ...keys: string[]): unknown {
  if (!record) return undefined;
  for (const key of keys) {
    if (record[key] !== undefined && record[key] !== null) return record[key];
  }
  return undefined;
}

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed || (!trimmed.startsWith("{") && !trimmed.startsWith("["))) {
    return value;
  }
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return value;
  }
}

function recordKeys(value: unknown): string[] {
  const record = asRecord(value);
  return record ? Object.keys(record).sort() : [];
}

function requestIdFrom(value: unknown): string | undefined {
  const record = asRecord(value);
  const found = first(record, "requestId", "RequestId", "request_id");
  return found === undefined ? undefined : String(found);
}

function wordText(value: unknown): string {
  if (typeof value === "string") return value;
  const record = asRecord(value);
  const text = first(record, "word", "text", "content", "Word", "Text");
  return text === undefined || text === null ? "" : String(text);
}

function collectWordLines(data: UnknownRecord): string {
  for (const key of [
    "prism_wordsInfo",
    "prismWordsInfo",
    "wordsInfo",
    "WordsInfo",
    "words",
    "lines",
  ]) {
    const words = data[key];
    if (!Array.isArray(words) || !words.length) continue;
    const text = words.map(wordText).map((line) => line.trim()).filter(Boolean).join("\n");
    if (text) return text;
  }
  return "";
}

function nonNegativeInteger(value: unknown, fallback: number): number {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.trunc(number) : fallback;
}

function decodeCells(rawCells: unknown): OcrTableCell[] {
  if (!Array.isArray(rawCells)) return [];
  return rawCells
    .map((value) => {
      const cell = asRecord(value);
      if (!cell) return null;
      const text = wordText(cell).trim();
      if (!text) return null;
      return {
        row: nonNegativeInteger(first(cell, "ysc", "row", "rowIndex", "Row"), 0),
        column: nonNegativeInteger(
          first(cell, "xsc", "column", "columnIndex", "Column"),
          0,
        ),
        text,
      };
    })
    .filter((cell): cell is OcrTableCell => cell !== null);
}

function decodeTables(data: UnknownRecord): OcrTable[] {
  const rawTables = first(
    data,
    "prism_tablesInfo",
    "prismTablesInfo",
    "tables",
    "Tables",
  );
  if (!Array.isArray(rawTables)) return [];
  return rawTables
    .map((value) => {
      const table = asRecord(value);
      const cells = decodeCells(first(table, "cellInfos", "cells", "Cells"));
      return cells.length ? { cells } : null;
    })
    .filter((table): table is OcrTable => table !== null);
}

function tableText(tables: OcrTable[]): string {
  return tables
    .flatMap((table) =>
      [...table.cells]
        .sort((left, right) => left.row - right.row || left.column - right.column)
        .map((cell) => cell.text),
    )
    .filter(Boolean)
    .join("\n");
}

export function describeOcrEnvelope(response: unknown): OcrAdapterNote {
  const envelope = asRecord(response) ?? {};
  const body = asRecord(first(envelope, "body", "Body")) ?? envelope;
  return {
    topLevelKeys: [...new Set([...recordKeys(envelope), ...recordKeys(body)])],
    requestId: requestIdFrom(body) ?? requestIdFrom(envelope),
  };
}

export function hasUsableOcrPage(page: OcrPage): boolean {
  return Boolean(page.rawText.trim()) || page.tables.some((table) => table.cells.length > 0);
}

export function mergeOcrPages(
  pages: Array<OcrPage | null | undefined>,
  page: number,
): OcrPage {
  const usable = pages.filter((entry): entry is OcrPage => Boolean(entry));
  const rawText = usable
    .map((entry) => entry.rawText.trim())
    .filter(Boolean)
    .join("\n");
  const tables = usable.flatMap((entry) => entry.tables);
  const requestId = usable.find((entry) => entry.requestId)?.requestId;
  return { page, rawText, tables, requestId };
}

/**
 * Adapt Aliyun OCR (and similar) envelopes into a single page shape.
 * Never throws for unknown field layouts. Missing text/tables become empty.
 */
export function adaptAliyunOcrResponse(response: unknown, page = 1): OcrPage {
  const envelope = asRecord(response);
  const body = asRecord(first(envelope, "body", "Body")) ?? envelope;
  const rawData = first(body, "data", "Data") ?? body;
  const parsed = parseMaybeJson(rawData);
  const data = asRecord(parsed) ?? {};
  const tables = decodeTables(data);
  const content = first(data, "content", "rawText", "Content", "text", "Text");
  const contentText = typeof content === "string" ? content.trim() : "";
  const wordTextValue = collectWordLines(data);
  const rawText = contentText || wordTextValue || tableText(tables);
  const requestId =
    requestIdFrom(body) ?? requestIdFrom(envelope) ?? requestIdFrom(data);
  return {
    page,
    rawText,
    tables,
    requestId,
  };
}
