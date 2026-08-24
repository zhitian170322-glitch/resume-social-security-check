/**
 * Standalone domain model for table OCR. Providers can be replaced without
 * coupling the parsers to a particular OCR SDK.
 */
export interface SocialSecurityOCRCell {
  id: string;
  rawText: string;
  text: string;
  row: number;
  column: number;
  rowSpan: number;
  columnSpan: number;
  confidence: number | null;
  bbox: {
    x: number;
    y: number;
    width: number;
    height: number;
  } | null;
  polygon: Array<{ x: number; y: number }> | null;
}

export interface SocialSecurityOCRTable {
  id: string;
  page: number;
  cells: SocialSecurityOCRCell[];
  confidence: number | null;
  provider: string;
  providerVersion: string;
  ocrVersion: string;
  contentHash: string;
  rawProviderResponseRef: string | null;
}

export interface SocialSecurityOCRResult {
  page: number;
  rawText: string;
  tables: SocialSecurityOCRTable[];
  requestId: string | null;
  provider: string;
  providerVersion: string;
  apiType: "GENERAL" | "TABLE";
  ocrVersion: string;
  contentHash: string;
  rawProviderResponseRef: string | null;
}

export interface SocialSecurityOCRProvider {
  readonly provider: string;
  readonly providerVersion: string;
  readonly ocrVersion: string;
  recognizeGeneral(
    input: Buffer,
    mimeType: string,
    page?: number,
  ): Promise<SocialSecurityOCRResult>;
  recognizeTable(
    input: Buffer,
    mimeType: string,
    page?: number,
  ): Promise<SocialSecurityOCRResult>;
}

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === "object"
    ? (value as UnknownRecord)
    : null;
}

function first(record: UnknownRecord | null, ...keys: string[]): unknown {
  if (!record) return undefined;
  for (const key of keys) {
    if (record[key] !== undefined) return record[key];
  }
  return undefined;
}

function finiteNumber(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function nonNegativeInteger(value: unknown, fallback: number): number {
  const number = finiteNumber(value);
  return number !== null && number >= 0 ? Math.trunc(number) : fallback;
}

/**
 * Aliyun reports probability as either 0..1 or 0..100. Expose a consistent
 * 0..1 score while retaining null when no probability was returned.
 */
function confidence(value: unknown): number | null {
  const number = finiteNumber(value);
  if (number === null || number < 0) return null;
  return Math.min(1, number > 1 ? number / 100 : number);
}

function point(value: unknown): { x: number; y: number } | null {
  const record = asRecord(value);
  if (!record) return null;
  const x = finiteNumber(first(record, "x", "X"));
  const y = finiteNumber(first(record, "y", "Y"));
  return x === null || y === null ? null : { x, y };
}

function polygon(value: unknown): Array<{ x: number; y: number }> | null {
  if (!Array.isArray(value)) return null;
  const points = value.map(point).filter((entry): entry is { x: number; y: number } => entry !== null);
  return points.length >= 2 ? points : null;
}

function boundingBox(
  value: unknown,
  points: Array<{ x: number; y: number }> | null,
): SocialSecurityOCRCell["bbox"] {
  const record = asRecord(value);
  if (record) {
    const x = finiteNumber(first(record, "x", "left"));
    const y = finiteNumber(first(record, "y", "top"));
    const width = finiteNumber(first(record, "width", "w"));
    const height = finiteNumber(first(record, "height", "h"));
    if (x !== null && y !== null && width !== null && height !== null) {
      return { x, y, width, height };
    }
  }
  if (!points?.length) return null;
  const xs = points.map((entry) => entry.x);
  const ys = points.map((entry) => entry.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return {
    x,
    y,
    width: Math.max(...xs) - x,
    height: Math.max(...ys) - y,
  };
}

function parseData(value: unknown): UnknownRecord {
  if (typeof value === "string") {
    try {
      return asRecord(JSON.parse(value)) ?? {};
    } catch {
      return {};
    }
  }
  return asRecord(value) ?? {};
}

function mean(values: Array<number | null>): number | null {
  const known = values.filter((value): value is number => value !== null);
  return known.length
    ? known.reduce((total, value) => total + value, 0) / known.length
    : null;
}

function wordConfidenceMap(data: UnknownRecord) {
  const result = new Map<string, number[]>();
  const words = first(data, "prism_wordsInfo", "prismWordsInfo");
  if (!Array.isArray(words)) return result;

  for (const value of words) {
    const word = asRecord(value);
    const cellId = first(word, "tableCellId", "table_cell_id");
    if (cellId === undefined || Number(cellId) < 0) continue;
    const tableId = first(word, "tableId", "table_id") ?? 0;
    const score = confidence(first(word, "prob", "confidence"));
    if (score === null) continue;
    const key = `${String(tableId)}:${String(cellId)}`;
    result.set(key, [...(result.get(key) ?? []), score]);
  }
  return result;
}

function decodeCell(
  value: unknown,
  tableId: string,
  scores: Map<string, number[]>,
): SocialSecurityOCRCell | null {
  const cell = asRecord(value);
  if (!cell) return null;

  const row = nonNegativeInteger(first(cell, "ysc", "row", "rowIndex"), 0);
  const column = nonNegativeInteger(first(cell, "xsc", "column", "columnIndex"), 0);
  const endRow = nonNegativeInteger(first(cell, "yec", "endRow"), row);
  const endColumn = nonNegativeInteger(first(cell, "xec", "endColumn"), column);
  const cellId = first(cell, "tableCellId", "cellId");
  const directScore = confidence(first(cell, "prob", "confidence"));
  const derivedScores =
    cellId === undefined ? [] : (scores.get(`${tableId}:${String(cellId)}`) ?? []);

  const rawText = String(first(cell, "word", "text", "content") ?? "");
  const cellPolygon = polygon(first(cell, "pos", "polygon", "points"));
  return {
    id: cellId === undefined ? `${tableId}:${row}:${column}` : String(cellId),
    rawText,
    text: rawText,
    row,
    column,
    rowSpan: Math.max(
      1,
      nonNegativeInteger(first(cell, "rowSpan"), endRow - row + 1),
    ),
    columnSpan: Math.max(
      1,
      nonNegativeInteger(first(cell, "columnSpan", "colSpan"), endColumn - column + 1),
    ),
    confidence: directScore ?? mean(derivedScores),
    bbox: boundingBox(first(cell, "bbox", "box"), cellPolygon),
    polygon: cellPolygon,
  };
}

function rawText(data: UnknownRecord, tables: SocialSecurityOCRTable[]): string {
  const content = first(data, "content", "rawText");
  if (typeof content === "string" && content.trim()) return content;

  const words = first(data, "prism_wordsInfo", "prismWordsInfo");
  if (Array.isArray(words)) {
    const text = words
      .map((value) => {
        const word = asRecord(value);
        return String(first(word, "word", "text", "content") ?? "");
      })
      .filter(Boolean)
      .join("\n");
    if (text) return text;
  }

  return tables
    .flatMap((table) =>
      [...table.cells]
        .sort((left, right) => left.row - right.row || left.column - right.column)
        .map((cell) => cell.text),
    )
    .filter(Boolean)
    .join("\n");
}

/**
 * Decode the wire response returned by Aliyun RecognizeTableOcr. Both the SDK
 * envelope (`body.data`) and an already-decoded `data` object are accepted.
 * This function intentionally has no dependency on or construction of an SDK.
 */
export function decodeAliyunRecognizeTableOcrResponse(
  response: unknown,
  page = 1,
  metadata: {
    contentHash?: string;
    providerVersion?: string;
    ocrVersion?: string;
  } = {},
): SocialSecurityOCRResult {
  const envelope = asRecord(response);
  const body = asRecord(first(envelope, "body", "Body")) ?? envelope;
  const dataValue = first(body, "data", "Data") ?? body;
  const data = parseData(dataValue);
  const scores = wordConfidenceMap(data);
  const rawTables = first(data, "prism_tablesInfo", "prismTablesInfo");
  const tables: SocialSecurityOCRTable[] = [];

  if (Array.isArray(rawTables)) {
    rawTables.forEach((value, index) => {
      const table = asRecord(value);
      if (!table) return;
      const id = String(first(table, "tableId", "id") ?? index);
      const rawCells = first(table, "cellInfos", "cells");
      const cells = Array.isArray(rawCells)
        ? rawCells
            .map((cell) => decodeCell(cell, id, scores))
            .filter((cell): cell is SocialSecurityOCRCell => cell !== null)
        : [];
      tables.push({
        id,
        page,
        cells,
        confidence: confidence(first(table, "prob", "confidence")) ??
          mean(cells.map((cell) => cell.confidence)),
        provider: "aliyun",
        providerVersion: metadata.providerVersion ?? "ocr-api20210707",
        ocrVersion: metadata.ocrVersion ?? "aliyun-table-v1",
        contentHash: metadata.contentHash ?? "",
        rawProviderResponseRef: null,
      });
    });
  }

  const requestId =
    first(body, "requestId", "RequestId") ??
    first(envelope, "requestId", "RequestId") ??
    first(data, "requestId", "RequestId");
  for (const table of tables) {
    table.rawProviderResponseRef =
      requestId === undefined || requestId === null ? null : String(requestId);
  }

  return {
    page,
    rawText: rawText(data, tables),
    tables,
    requestId: requestId === undefined || requestId === null
      ? null
      : String(requestId),
    provider: "aliyun",
    providerVersion: metadata.providerVersion ?? "ocr-api20210707",
    apiType: "TABLE",
    ocrVersion: metadata.ocrVersion ?? "aliyun-table-v1",
    contentHash: metadata.contentHash ?? "",
    rawProviderResponseRef:
      requestId === undefined || requestId === null ? null : String(requestId),
  };
}
