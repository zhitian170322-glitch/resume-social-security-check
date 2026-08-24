import { randomUUID } from "node:crypto";
import { db } from "./db";
import { contentHash } from "./stage-cache";
import type {
  SocialSecurityOCRCell,
  SocialSecurityOCRResult,
} from "./social-security-table";

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ValueTransformation {
  type: "CONTROLLED_NUMERIC_OCR_CORRECTION" | "DATE_FORMAT_NORMALIZATION";
  from: string;
  to: string;
}

export interface SocialSecurityCellEvidence {
  id: string;
  documentId: string;
  pageNumber: number;
  tableIndex: number;
  rowIndex: number;
  columnIndex: number;
  sourceCellId: string;
  rawValue: string;
  bbox: BoundingBox | null;
  polygon: Array<{ x: number; y: number }> | null;
  confidence: number | null;
  extractionMethod: "OCR_TABLE";
  provider: string;
  providerVersion: string;
  contentHash: string;
  ocrVersion: string;
  transformations: ValueTransformation[];
}

export interface EvidenceReference<T> {
  rawValue: string | null;
  value: T | null;
  evidenceIds: string[];
  transformations: ValueTransformation[];
}

export interface SocialSecurityMonthlyRecord {
  month: EvidenceReference<string>;
  unitCode: EvidenceReference<string>;
  companyRaw: EvidenceReference<string>;
  pension: EvidenceReference<boolean> | null;
  medical: EvidenceReference<boolean> | null;
  injury: EvidenceReference<boolean> | null;
  unemployment: EvidenceReference<boolean> | null;
  maternity: EvidenceReference<boolean> | null;
  evidenceIds: string[];
}

export interface SocialSecurityDerivedPeriod {
  startMonth: string;
  endMonth: string;
  paidMonthCount: number;
}

export interface SocialSecurityRawRecord {
  companyRaw: EvidenceReference<string>;
  companyNormalized: string | null;
  unitCode: EvidenceReference<string> | null;
  monthlyRecords: SocialSecurityMonthlyRecord[];
  paidMonths: string[] | null;
  rawPeriod: EvidenceReference<string> | null;
  derivedPaidMonths: string[] | null;
  pensionMonths: EvidenceReference<number> | null;
  medicalMonths: EvidenceReference<number> | null;
  injuryMonths: EvidenceReference<number> | null;
  unemploymentMonths: EvidenceReference<number> | null;
  maternityMonths: EvidenceReference<number> | null;
  derived: {
    startMonth: string | null;
    endMonth: string | null;
    paidMonthCount: number | null;
    gapMonths: string[];
    periods: SocialSecurityDerivedPeriod[];
  };
  evidenceIds: string[];
  status: "PARSED" | "UNCERTAIN" | "MANUAL_REVIEW_REQUIRED";
  warnings: string[];
}

function monthIndex(value: string) {
  const [year, month] = value.split("-").map(Number);
  return year * 12 + month - 1;
}

function monthFromIndex(value: number) {
  const year = Math.floor(value / 12);
  return `${year}-${String((value % 12) + 1).padStart(2, "0")}`;
}

export function derivePaidMonthFacts(
  paidMonths: string[] | null,
): SocialSecurityRawRecord["derived"] {
  if (!paidMonths?.length) {
    return {
      startMonth: null,
      endMonth: null,
      paidMonthCount: null,
      gapMonths: [],
      periods: [],
    };
  }
  const sorted = [...new Set(paidMonths)].sort(
    (left, right) => monthIndex(left) - monthIndex(right),
  );
  const periods: SocialSecurityDerivedPeriod[] = [];
  for (const month of sorted) {
    const current = periods.at(-1);
    if (
      !current ||
      monthIndex(month) !== monthIndex(current.endMonth) + 1
    ) {
      periods.push({
        startMonth: month,
        endMonth: month,
        paidMonthCount: 1,
      });
    } else {
      current.endMonth = month;
      current.paidMonthCount += 1;
    }
  }
  const present = new Set(sorted);
  const gapMonths: string[] = [];
  for (
    let index = monthIndex(sorted[0]);
    index <= monthIndex(sorted.at(-1)!);
    index += 1
  ) {
    const month = monthFromIndex(index);
    if (!present.has(month)) gapMonths.push(month);
  }
  return {
    startMonth: sorted[0],
    endMonth: sorted.at(-1)!,
    paidMonthCount: sorted.length,
    gapMonths,
    periods,
  };
}

function evidenceId(input: {
  documentId: string;
  pageNumber: number;
  tableContentHash: string;
  tableIndex: number;
  cell: SocialSecurityOCRCell;
}) {
  return contentHash(
    [
      input.documentId,
      input.tableContentHash,
      String(input.pageNumber),
      String(input.tableIndex),
      String(input.cell.row),
      String(input.cell.column),
      input.cell.id,
    ].join("\u001f"),
  );
}

export function buildSocialSecurityCellEvidence(
  documentId: string,
  result: SocialSecurityOCRResult,
): SocialSecurityCellEvidence[] {
  return result.tables.flatMap((table, tableIndex) =>
    table.cells.map((cell) => ({
      id: evidenceId({
        documentId,
        pageNumber: table.page,
        tableContentHash: table.contentHash,
        tableIndex,
        cell,
      }),
      documentId,
      pageNumber: table.page,
      tableIndex,
      rowIndex: cell.row,
      columnIndex: cell.column,
      sourceCellId: cell.id,
      rawValue: cell.rawText,
      bbox: cell.bbox,
      polygon: cell.polygon,
      confidence: cell.confidence,
      extractionMethod: "OCR_TABLE" as const,
      provider: table.provider,
      providerVersion: table.providerVersion,
      contentHash: table.contentHash,
      ocrVersion: table.ocrVersion,
      transformations: [],
    })),
  );
}

export function persistSocialSecurityOCRResult(input: {
  taskId: string;
  documentId: string;
  result: SocialSecurityOCRResult;
}) {
  const resultId = randomUUID();
  const now = new Date().toISOString();
  const evidence = buildSocialSecurityCellEvidence(
    input.documentId,
    input.result,
  );
  db.transaction(() => {
    db.prepare(
      `INSERT INTO social_security_ocr_results
        (id, task_id, document_id, page_number, provider, provider_version,
         api_type, ocr_version, content_hash, raw_provider_response_ref,
         result_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(document_id, page_number, provider, api_type, ocr_version, content_hash)
       DO UPDATE SET
         raw_provider_response_ref = excluded.raw_provider_response_ref,
         result_json = excluded.result_json`,
    ).run(
      resultId,
      input.taskId,
      input.documentId,
      input.result.page,
      input.result.provider,
      input.result.providerVersion,
      input.result.apiType,
      input.result.ocrVersion,
      input.result.contentHash,
      input.result.rawProviderResponseRef,
      JSON.stringify(input.result),
      now,
    );
    const stored = db
      .prepare(
        `SELECT id FROM social_security_ocr_results
         WHERE document_id = ? AND page_number = ? AND provider = ?
           AND api_type = ? AND ocr_version = ? AND content_hash = ?`,
      )
      .get(
        input.documentId,
        input.result.page,
        input.result.provider,
        input.result.apiType,
        input.result.ocrVersion,
        input.result.contentHash,
      ) as { id: string };
    const insert = db.prepare(
      `INSERT OR IGNORE INTO social_security_cell_evidence
        (id, ocr_result_id, document_id, page_number, table_index, row_index,
         column_index, source_cell_id, raw_value, bbox_json, polygon_json,
         confidence, extraction_method, provider, provider_version,
         content_hash, ocr_version, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'OCR_TABLE', ?, ?, ?, ?, ?)`,
    );
    for (const cell of evidence) {
      insert.run(
        cell.id,
        stored.id,
        cell.documentId,
        cell.pageNumber,
        cell.tableIndex,
        cell.rowIndex,
        cell.columnIndex,
        cell.sourceCellId,
        cell.rawValue,
        cell.bbox ? JSON.stringify(cell.bbox) : null,
        cell.polygon ? JSON.stringify(cell.polygon) : null,
        cell.confidence,
        cell.provider,
        cell.providerVersion,
        cell.contentHash,
        cell.ocrVersion,
        now,
      );
    }
  })();
  return evidence;
}
