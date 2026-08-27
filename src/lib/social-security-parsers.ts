import {
  type SocialSecurityOCRCell,
  type SocialSecurityOCRResult,
  type SocialSecurityOCRTable,
} from "./social-security-table";
import {
  buildSocialSecurityCellEvidence,
  derivePaidMonthFacts,
  inclusiveMonthRange,
  monthIndex,
  type EvidenceReference,
  type SocialSecurityCellEvidence,
  type SocialSecurityIntervalEvidence,
  type SocialSecurityMonthlyRecord,
  type SocialSecurityRawRecord,
  type ValueTransformation,
} from "./social-security-evidence";

export type SocialSecurityTemplate =
  | "SHENZHEN"
  | "GUANGDONG"
  | "GENERIC"
  | "UNKNOWN";

export interface SocialSecurityRecordSource {
  file: string;
  page: number;
  quote: string;
  confidence: number | null;
}

export interface ParsedSocialSecurityRecord {
  companyRaw: string;
  companyNormalized: string;
  startMonth: string;
  endMonth: string;
  paidMonths: string[] | null;
  statedPaidMonthCount: number | null;
  pensionMonths: number | null;
  injuryMonths: number | null;
  unemploymentMonths: number | null;
  fieldConfidence: {
    company: number | null;
    startMonth: number | null;
    endMonth: number | null;
    paidMonths: number | null;
    pensionMonths: number | null;
    injuryMonths: number | null;
    unemploymentMonths: number | null;
  };
  source: SocialSecurityRecordSource;
  rawRecord?: SocialSecurityRawRecord;
}

export interface SocialSecurityParseResult {
  template: SocialSecurityTemplate;
  status: "parsed" | "manual-required";
  autoVerifiable: boolean;
  records: ParsedSocialSecurityRecord[];
  rawRecords: SocialSecurityRawRecord[];
  reasons: string[];
  sameMonthMultiCompany?: boolean;
}

export interface SocialSecurityParserInput {
  ocr: SocialSecurityOCRResult;
  sourceFile: string;
  documentId?: string;
  cellEvidence?: SocialSecurityCellEvidence[];
}

export interface SocialSecurityTableParser {
  parse(input: SocialSecurityParserInput): SocialSecurityParseResult;
  parse(ocr: SocialSecurityOCRResult, sourceFile: string): SocialSecurityParseResult;
}

interface TableRow {
  table: SocialSecurityOCRTable;
  tableIndex: number;
  index: number;
  cells: SocialSecurityOCRCell[];
}

interface UnitMonth {
  unit: string;
  unitRaw: string;
  month: string;
  monthRaw: string;
  row: TableRow;
  unitCell: SocialSecurityOCRCell;
  monthCell: SocialSecurityOCRCell;
  columns: Map<string, number>;
  transformations: ValueTransformation[];
  confidence: number | null;
}

const compact = (value: string) =>
  value.normalize("NFKC").replace(/[\s:：()（）[\]【】]/g, "").toLowerCase();

/**
 * Company normalization is deliberately conservative: it only normalizes
 * Unicode width and whitespace. The raw OCR spelling is always retained.
 */
export function normalizeCompanyName(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ");
}

function correctedNumericText(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[Oo]/g, "0")
    .replace(/[Il]/g, "1")
    .replace(/S/g, "5");
}

export function controlledNumericCorrection(value: string): {
  value: string;
  transformations: ValueTransformation[];
} {
  const corrected = correctedNumericText(value);
  return {
    value: corrected,
    transformations:
      corrected === value
        ? []
        : [
            {
              type: "CONTROLLED_NUMERIC_OCR_CORRECTION",
              from: value,
              to: corrected,
            },
          ],
  };
}

export function parseOCRNumber(value: string): number | null {
  const match = correctedNumericText(value).match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const number = Number(match[0]);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

export function parseOCRMonth(value: string): string | null {
  return parseOCRMonthWithTransformations(value).value;
}

export function parseOCRMonthWithTransformations(value: string): {
  value: string | null;
  transformations: ValueTransformation[];
} {
  const correction = controlledNumericCorrection(value);
  const corrected = correction.value;
  const match = corrected.match(
    /(?:^|[^\d])((?:19|20)\d{2})\s*(?:年|[-/.])?\s*(\d{1,2})(?:\s*月)?(?:[^\d]|$)/,
  );
  if (!match) return { value: null, transformations: correction.transformations };
  const month = Number(match[2]);
  if (month < 1 || month > 12) {
    return { value: null, transformations: correction.transformations };
  }
  const normalized = `${match[1]}-${String(month).padStart(2, "0")}`;
  return {
    value: normalized,
    transformations: [
      ...correction.transformations,
      ...(normalized === corrected
        ? []
        : [
            {
              type: "DATE_FORMAT_NORMALIZATION" as const,
              from: corrected,
              to: normalized,
            },
          ]),
    ],
  };
}

function rows(ocr: SocialSecurityOCRResult): TableRow[] {
  return ocr.tables.flatMap((table, tableIndex) => {
    const grouped = new Map<number, SocialSecurityOCRCell[]>();
    for (const cell of table.cells) {
      grouped.set(cell.row, [...(grouped.get(cell.row) ?? []), cell]);
    }
    return [...grouped.entries()]
      .sort(([left], [right]) => left - right)
      .map(([index, cells]) => ({
        table,
        tableIndex,
        index,
        cells: [...cells].sort((left, right) => left.column - right.column),
      }));
  });
}

function rowQuote(row: TableRow): string {
  return row.cells.map((cell) => cell.text.trim()).filter(Boolean).join(" | ");
}

function rowConfidence(row: TableRow): number | null {
  const known = row.cells
    .map((cell) => cell.confidence)
    .filter((value): value is number => value !== null);
  return known.length
    ? known.reduce((total, value) => total + value, 0) / known.length
    : row.table.confidence;
}

function combinedSource(
  sourceFile: string,
  sourceRows: TableRow[],
): SocialSecurityRecordSource {
  const confidence = sourceRows
    .map(rowConfidence)
    .filter((value): value is number => value !== null);
  return {
    file: sourceFile,
    page: sourceRows[0]?.table.page ?? 1,
    quote: sourceRows.map(rowQuote).filter(Boolean).join("\n"),
    confidence: confidence.length
      ? confidence.reduce((total, value) => total + value, 0) / confidence.length
      : null,
  };
}

function unpackInput(
  input: SocialSecurityParserInput | SocialSecurityOCRResult,
  sourceFile?: string,
): SocialSecurityParserInput {
  if ("ocr" in input) return input;
  return { ocr: input, sourceFile: sourceFile ?? "" };
}

function headerColumns(row: TableRow, aliases: Record<string, string[]>): Map<string, number> {
  const result = new Map<string, number>();
  for (const cell of row.cells) {
    const value = compact(cell.text);
    for (const [field, names] of Object.entries(aliases)) {
      if (!result.has(field) && names.some((name) => value.includes(compact(name)))) {
        result.set(field, cell.column);
      }
    }
  }
  return result;
}

function cellAt(row: TableRow, column: number | undefined): SocialSecurityOCRCell | undefined {
  if (column === undefined) return undefined;
  return row.cells.find(
    (cell) => column >= cell.column && column < cell.column + cell.columnSpan,
  );
}

function cellEvidence(
  evidence: SocialSecurityCellEvidence[],
  row: TableRow,
  cell: SocialSecurityOCRCell | undefined,
): SocialSecurityCellEvidence | null {
  if (!cell) return null;
  return (
    evidence.find(
      (entry) =>
        entry.tableIndex === row.tableIndex &&
        entry.rowIndex === cell.row &&
        entry.columnIndex === cell.column &&
        entry.sourceCellId === cell.id,
    ) ?? null
  );
}

function reference<T>(
  rawValue: string | null,
  value: T | null,
  evidence: SocialSecurityCellEvidence | null,
  transformations: ValueTransformation[] = [],
): EvidenceReference<T> {
  return {
    rawValue,
    value,
    evidenceIds: evidence ? [evidence.id] : [],
    transformations,
  };
}

function paidFlag(
  row: TableRow,
  column: number | undefined,
  evidence: SocialSecurityCellEvidence[],
): EvidenceReference<boolean> | null {
  const cell = cellAt(row, column);
  if (!cell || !cell.text.trim()) return null;
  const value = /^(?:1|是|已缴|正常|√|✓)$/u.test(cell.text.trim());
  return reference(
    cell.rawText,
    value,
    cellEvidence(evidence, row, cell),
  );
}

function tableTopologyValid(ocr: SocialSecurityOCRResult): boolean {
  return ocr.tables.every((table) => {
    const coordinates = new Set<string>();
    for (const cell of table.cells) {
      const key = `${cell.row}:${cell.column}`;
      if (coordinates.has(key)) return false;
      coordinates.add(key);
    }
    return true;
  });
}

function evidenceForInput(
  input: SocialSecurityParserInput,
): SocialSecurityCellEvidence[] {
  return (
    input.cellEvidence ??
    buildSocialSecurityCellEvidence(input.documentId ?? input.sourceFile, input.ocr)
  );
}

function followingRows(allRows: TableRow[], header: TableRow): TableRow[] {
  return allRows.filter(
    (row) => row.table === header.table && row.index > header.index,
  );
}

const SHENZHEN_UNIT_HEADERS = {
  unit: ["单位编号", "单位号", "参保单位编号"],
  company: ["单位名称", "参保单位名称", "缴费单位"],
};

const SHENZHEN_MONTH_HEADERS = {
  unit: ["单位编号", "单位号", "参保单位编号"],
  month: ["缴费年月", "费款所属期", "参保年月", "缴费月份"],
  pension: ["养老", "养老保险"],
  medical: ["医疗", "医疗保险"],
  injury: ["工伤", "工伤保险"],
  unemployment: ["失业", "失业保险"],
  maternity: ["生育", "生育保险"],
};

const GUANGDONG_HEADERS = {
  company: ["单位名称", "参保单位", "缴费单位", "公司名称"],
  start: ["开始年月", "起始年月", "参保开始年月", "缴费起始年月"],
  end: ["结束年月", "终止年月", "截止年月", "参保结束年月", "缴费终止年月"],
  pension: ["养老", "养老保险"],
  injury: ["工伤", "工伤保险"],
  unemployment: ["失业", "失业保险"],
  medical: ["医疗", "医疗保险"],
  maternity: ["生育", "生育保险"],
};

function corpus(ocr: SocialSecurityOCRResult): string {
  return compact(
    [ocr.rawText, ...ocr.tables.flatMap((table) => table.cells.map((cell) => cell.text))]
      .join("\n"),
  );
}

export class SocialSecurityTemplateDetector {
  detect(ocr: SocialSecurityOCRResult): SocialSecurityTemplate {
    return this.detectWithReasons(ocr).template;
  }

  detectWithReasons(ocr: SocialSecurityOCRResult): {
    template: SocialSecurityTemplate;
    confidence: number;
    reasons: string[];
  } {
    const text = corpus(ocr);
    const shenzhenStructure =
      text.includes("单位编号") &&
      (text.includes("缴费年月") || text.includes("费款所属期"));
    if ((text.includes("深圳") && shenzhenStructure) || text.includes("深圳市社会保险")) {
      return {
        template: "SHENZHEN",
        confidence: shenzhenStructure ? 0.98 : 0.8,
        reasons: ["SHENZHEN_TITLE_OR_STRUCTURE"],
      };
    }

    const guangdongStructure =
      ["养老", "工伤", "失业"].every((keyword) => text.includes(keyword)) &&
      ["开始年月", "起始年月", "参保开始年月"].some((keyword) =>
        text.includes(compact(keyword)),
      ) &&
      ["结束年月", "终止年月", "截止年月"].some((keyword) =>
        text.includes(compact(keyword)),
      );
    if ((text.includes("广东") && guangdongStructure) || guangdongStructure) {
      return {
        template: "GUANGDONG",
        confidence: text.includes("广东") ? 0.98 : 0.85,
        reasons: ["GUANGDONG_PERIOD_AND_INSURANCE_HEADERS"],
      };
    }
    const genericStructure =
      ["单位名称", "参保单位", "缴费单位"].some((keyword) =>
        text.includes(compact(keyword)),
      ) &&
      ["缴费年月", "参保年月", "缴费月份"].some((keyword) =>
        text.includes(compact(keyword)),
      );
    if (genericStructure) {
      return {
        template: "GENERIC",
        confidence: 0.65,
        reasons: ["GENERIC_EXPLICIT_COMPANY_MONTH_HEADERS"],
      };
    }
    return {
      template: "UNKNOWN",
      confidence: 1,
      reasons: ["NO_RELIABLE_TEMPLATE_SIGNATURE"],
    };
  }
}

export function detectSocialSecurityTemplate(
  ocr: SocialSecurityOCRResult,
): SocialSecurityTemplate {
  return new SocialSecurityTemplateDetector().detect(ocr);
}

export class ShenzhenSocialSecurityParser implements SocialSecurityTableParser {
  parse(input: SocialSecurityParserInput): SocialSecurityParseResult;
  parse(ocr: SocialSecurityOCRResult, sourceFile: string): SocialSecurityParseResult;
  parse(
    input: SocialSecurityParserInput | SocialSecurityOCRResult,
    sourceFile?: string,
  ): SocialSecurityParseResult {
    const unpacked = unpackInput(input, sourceFile);
    const { ocr, sourceFile: file } = unpacked;
    const evidence = evidenceForInput(unpacked);
    if (!tableTopologyValid(ocr)) {
      return {
        template: "SHENZHEN",
        status: "manual-required",
        autoVerifiable: false,
        records: [],
        rawRecords: [],
        reasons: ["TABLE_CELL_ORDER_CONFLICT"],
      };
    }
    const allRows = rows(ocr);
    const companies = new Map<
      string,
      {
        name: string;
        row: TableRow;
        unitCell: SocialSecurityOCRCell;
        companyCell: SocialSecurityOCRCell;
        transformations: ValueTransformation[];
        confidence: number | null;
      }
    >();
    const months: UnitMonth[] = [];

    for (const header of allRows) {
      const mapping = headerColumns(header, SHENZHEN_UNIT_HEADERS);
      if (mapping.has("unit") && mapping.has("company")) {
        for (const row of followingRows(allRows, header)) {
          const unitCell = cellAt(row, mapping.get("unit"));
          const unit = unitCell?.text.trim() ?? "";
          const companyCell = cellAt(row, mapping.get("company"));
          const company = companyCell?.text ?? "";
          const correctedUnit = controlledNumericCorrection(unit);
          if (
            unitCell &&
            companyCell &&
            unit &&
            company.trim() &&
            !parseOCRMonth(unit) &&
            !parseOCRMonth(company)
          ) {
            companies.set(correctedUnit.value.replace(/\s/g, ""), {
              name: company,
              row,
              unitCell,
              companyCell,
              transformations: correctedUnit.transformations,
              confidence: companyCell?.confidence ?? null,
            });
          }
        }
      }

      const monthly = headerColumns(header, SHENZHEN_MONTH_HEADERS);
      if (monthly.has("unit") && monthly.has("month")) {
        for (const row of followingRows(allRows, header)) {
          const unitCell = cellAt(row, monthly.get("unit"));
          const unit = unitCell?.text.trim() ?? "";
          const monthCell = cellAt(row, monthly.get("month"));
          const month = parseOCRMonthWithTransformations(monthCell?.text ?? "");
          const correctedUnit = controlledNumericCorrection(unit);
          if (unitCell && monthCell && unit && month.value) {
            months.push({
              unit: correctedUnit.value.replace(/\s/g, ""),
              unitRaw: unit,
              month: month.value,
              monthRaw: monthCell.rawText,
              row,
              unitCell,
              monthCell,
              columns: monthly,
              transformations: month.transformations,
              confidence: monthCell?.confidence ?? null,
            });
          }
        }
      }
    }

    const byUnit = new Map<string, UnitMonth[]>();
    for (const item of months) {
      byUnit.set(item.unit, [...(byUnit.get(item.unit) ?? []), item]);
    }

    const records: ParsedSocialSecurityRecord[] = [];
    const rawRecords: SocialSecurityRawRecord[] = [];
    const missingUnits: string[] = [];
    for (const [unit, items] of byUnit) {
      const company = companies.get(unit);
      if (!company) {
        missingUnits.push(unit);
        continue;
      }
      const paidMonths = [...new Set(items.map((item) => item.month))].sort(
        (left, right) => monthIndex(left) - monthIndex(right),
      );
      const monthConfidences = items
        .map((item) => item.confidence)
        .filter((value): value is number => value !== null);
      const paidMonthConfidence = monthConfidences.length
        ? Math.min(...monthConfidences)
        : null;
      const companyEvidence = cellEvidence(
        evidence,
        company.row,
        company.companyCell,
      );
      const mappingUnitEvidence = cellEvidence(
        evidence,
        company.row,
        company.unitCell,
      );
      const monthlyRecords: SocialSecurityMonthlyRecord[] = items.map((item) => {
        const unitEvidence = cellEvidence(evidence, item.row, item.unitCell);
        const monthEvidence = cellEvidence(evidence, item.row, item.monthCell);
        const evidenceIds = [
          companyEvidence?.id,
          mappingUnitEvidence?.id,
          unitEvidence?.id,
          monthEvidence?.id,
        ].filter((value): value is string => Boolean(value));
        return {
          month: reference(
            item.monthRaw,
            item.month,
            monthEvidence,
            item.transformations,
          ),
          unitCode: reference(
            item.unitRaw,
            unit,
            unitEvidence,
            controlledNumericCorrection(item.unitRaw).transformations,
          ),
          companyRaw: reference(
            company.name,
            company.name,
            companyEvidence,
          ),
          pension: paidFlag(
            item.row,
            item.columns.get("pension"),
            evidence,
          ),
          medical: paidFlag(
            item.row,
            item.columns.get("medical"),
            evidence,
          ),
          injury: paidFlag(item.row, item.columns.get("injury"), evidence),
          unemployment: paidFlag(
            item.row,
            item.columns.get("unemployment"),
            evidence,
          ),
          maternity: paidFlag(
            item.row,
            item.columns.get("maternity"),
            evidence,
          ),
          evidenceIds,
        };
      });
      const mappingEvidenceIds = [
        mappingUnitEvidence?.id,
        companyEvidence?.id,
      ].filter((value): value is string => Boolean(value));
      const rawRecord: SocialSecurityRawRecord = {
        companyRaw: reference(
          company.name,
          company.name,
          companyEvidence,
        ),
        companyNormalized: normalizeCompanyName(company.name),
        unitCode: reference(
          company.unitCell.rawText,
          unit,
          mappingUnitEvidence,
          company.transformations,
        ),
        monthlyRecords,
        paidMonths,
        paidMonthEvidence: monthlyRecords.map((monthly) => ({
          month: monthly.month.value!,
          status: "EXTRACTED",
          evidenceIds: [...monthly.month.evidenceIds],
          derivedFrom: null,
        })),
        rawPeriod: null,
        intervalEvidence: null,
        derivedPaidMonths: null,
        statedPaidMonthCount: null,
        pensionMonths: null,
        medicalMonths: null,
        injuryMonths: null,
        unemploymentMonths: null,
        maternityMonths: null,
        derived: derivePaidMonthFacts(paidMonths),
        evidenceIds: [
          ...mappingEvidenceIds,
          ...monthlyRecords.flatMap((record) => record.evidenceIds),
        ],
        status: "PARSED",
        warnings: [],
      };
      rawRecords.push(rawRecord);
      records.push({
        companyRaw: company.name,
        companyNormalized: normalizeCompanyName(company.name),
        startMonth: rawRecord.derived.startMonth!,
        endMonth: rawRecord.derived.endMonth!,
        paidMonths,
        statedPaidMonthCount: null,
        pensionMonths: null,
        injuryMonths: null,
        unemploymentMonths: null,
        fieldConfidence: {
          company: company.confidence,
          startMonth: paidMonthConfidence,
          endMonth: paidMonthConfidence,
          paidMonths: paidMonthConfidence,
          pensionMonths: null,
          injuryMonths: null,
          unemploymentMonths: null,
        },
        source: combinedSource(file, [company.row, ...items.map((item) => item.row)]),
        rawRecord,
      });
    }

    const reasons: string[] = [];
    if (!records.length) reasons.push("未找到可关联的单位编号、单位名称和缴费年月");
    if (missingUnits.length) {
      reasons.push(`以下单位编号缺少单位名称映射：${[...new Set(missingUnits)].join("、")}`);
    }
    return {
      template: "SHENZHEN",
      status: records.length && !missingUnits.length ? "parsed" : "manual-required",
      autoVerifiable: records.length > 0 && missingUnits.length === 0,
      records,
      rawRecords,
      reasons,
    };
  }
}

export class GuangdongSocialSecurityParser implements SocialSecurityTableParser {
  parse(input: SocialSecurityParserInput): SocialSecurityParseResult;
  parse(ocr: SocialSecurityOCRResult, sourceFile: string): SocialSecurityParseResult;
  parse(
    input: SocialSecurityParserInput | SocialSecurityOCRResult,
    sourceFile?: string,
  ): SocialSecurityParseResult {
    const unpacked = unpackInput(input, sourceFile);
    const { ocr, sourceFile: file } = unpacked;
    const evidence = evidenceForInput(unpacked);
    if (!tableTopologyValid(ocr)) {
      return {
        template: "GUANGDONG",
        status: "manual-required",
        autoVerifiable: false,
        records: [],
        rawRecords: [],
        reasons: ["TABLE_CELL_ORDER_CONFLICT"],
      };
    }
    const allRows = rows(ocr);
    const records: ParsedSocialSecurityRecord[] = [];
    const rawRecords: SocialSecurityRawRecord[] = [];

    for (const header of allRows) {
      const columns = headerColumns(header, GUANGDONG_HEADERS);
      if (
        !["company", "start", "end", "pension", "injury", "unemployment"].every(
          (field) => columns.has(field),
        )
      ) {
        continue;
      }

      for (const row of followingRows(allRows, header)) {
        const companyCell = cellAt(row, columns.get("company"));
        const startCell = cellAt(row, columns.get("start"));
        const endCell = cellAt(row, columns.get("end"));
        const pensionCell = cellAt(row, columns.get("pension"));
        const injuryCell = cellAt(row, columns.get("injury"));
        const unemploymentCell = cellAt(row, columns.get("unemployment"));
        const companyRaw = companyCell?.text ?? "";
        const start = parseOCRMonthWithTransformations(startCell?.text ?? "");
        const end = parseOCRMonthWithTransformations(endCell?.text ?? "");
        const startMonth = start.value;
        const endMonth = end.value;
        if (
          !companyRaw.trim() ||
          !startMonth ||
          !endMonth ||
          monthIndex(endMonth) < monthIndex(startMonth)
        ) {
          continue;
        }
        const pensionMonths = parseOCRNumber(
          pensionCell?.text ?? "",
        );
        const injuryMonths = parseOCRNumber(
          injuryCell?.text ?? "",
        );
        const unemploymentMonths = parseOCRNumber(
          unemploymentCell?.text ?? "",
        );
        const companyEvidence = cellEvidence(evidence, row, companyCell);
        const startEvidence = cellEvidence(evidence, row, startCell);
        const endEvidence = cellEvidence(evidence, row, endCell);
        const pensionEvidence = cellEvidence(evidence, row, pensionCell);
        const injuryEvidence = cellEvidence(evidence, row, injuryCell);
        const unemploymentEvidence = cellEvidence(
          evidence,
          row,
          unemploymentCell,
        );
        const rawPeriod = `${startCell?.rawText ?? ""}～${endCell?.rawText ?? ""}`;
        const periodEvidenceIds = [
          startEvidence?.id,
          endEvidence?.id,
        ].filter((value): value is string => Boolean(value));
        const rawRecord: SocialSecurityRawRecord = {
          companyRaw: reference(
            companyCell?.rawText ?? companyRaw,
            companyRaw,
            companyEvidence,
          ),
          companyNormalized: normalizeCompanyName(companyRaw),
          unitCode: null,
          monthlyRecords: [],
          paidMonths: null,
          paidMonthEvidence: [],
          rawPeriod: {
            rawValue: rawPeriod,
            value: `${startMonth}/${endMonth}`,
            evidenceIds: periodEvidenceIds,
            transformations: [
              ...start.transformations,
              ...end.transformations,
            ],
          },
          intervalEvidence: null,
          derivedPaidMonths: null,
          statedPaidMonthCount: null,
          pensionMonths: reference(
            pensionCell?.rawText ?? null,
            pensionMonths,
            pensionEvidence,
            controlledNumericCorrection(pensionCell?.rawText ?? "")
              .transformations,
          ),
          medicalMonths: null,
          injuryMonths: reference(
            injuryCell?.rawText ?? null,
            injuryMonths,
            injuryEvidence,
            controlledNumericCorrection(injuryCell?.rawText ?? "")
              .transformations,
          ),
          unemploymentMonths: reference(
            unemploymentCell?.rawText ?? null,
            unemploymentMonths,
            unemploymentEvidence,
            controlledNumericCorrection(unemploymentCell?.rawText ?? "")
              .transformations,
          ),
          maternityMonths: null,
          derived: derivePaidMonthFacts(null),
          evidenceIds: [
            companyEvidence?.id,
            ...periodEvidenceIds,
            pensionEvidence?.id,
            injuryEvidence?.id,
            unemploymentEvidence?.id,
          ].filter((value): value is string => Boolean(value)),
          status: "MANUAL_REVIEW_REQUIRED",
          warnings: ["MONTH_DETAIL_UNAVAILABLE"],
        };
        rawRecords.push(rawRecord);
        records.push({
          companyRaw,
          companyNormalized: normalizeCompanyName(companyRaw),
          startMonth,
          endMonth,
          paidMonths: null,
          statedPaidMonthCount: null,
          pensionMonths,
          injuryMonths,
          unemploymentMonths,
          fieldConfidence: {
            company: companyCell?.confidence ?? null,
            startMonth: startCell?.confidence ?? null,
            endMonth: endCell?.confidence ?? null,
            paidMonths: null,
            pensionMonths: pensionCell?.confidence ?? null,
            injuryMonths: injuryCell?.confidence ?? null,
            unemploymentMonths: unemploymentCell?.confidence ?? null,
          },
          source: combinedSource(file, [row]),
          rawRecord,
        });
      }
    }

    const allPeriodsSupported = false;
    return {
      template: "GUANGDONG",
      status: allPeriodsSupported ? "parsed" : "manual-required",
      autoVerifiable: allPeriodsSupported,
      records,
      rawRecords,
      reasons: !records.length
        ? ["未找到完整的单位、起止年月和险种列"]
        : allPeriodsSupported
          ? []
          : [
              "MONTH_DETAIL_UNAVAILABLE",
              "险种月数无法证明起止区间内每月均有缴费，必须人工复核",
            ],
    };
  }
}

interface GenericMonthFact {
  value: string;
  cell: SocialSecurityOCRCell;
  row: TableRow;
  confidence: number | null;
  transformations: ValueTransformation[];
  explicit: boolean;
}

interface GenericCompanyFact {
  companyCell: SocialSecurityOCRCell;
  companyRow: TableRow;
  months: GenericMonthFact[];
  period: EvidenceReference<string> | null;
  intervalEvidence: SocialSecurityIntervalEvidence | null;
  statedPaidMonthCount: EvidenceReference<number> | null;
  requiresManualReview: boolean;
}

function companyCandidate(cell: SocialSecurityOCRCell) {
  const text = cell.rawText.trim();
  if (
    text.length < 4 ||
    /^(?:单位|单位名称|单位全称|参保单位|缴费单位|公司名称)$/u.test(text) ||
    /参保险种|缴费基数|缴费状态|养老保险|工伤保险|失业保险/u.test(text) ||
    /^\d+(?:\.\d+)?$/u.test(text)
  ) {
    return false;
  }
  return /公司|集团|事务所|中心|工厂|银行|学校|医院|合作社|个人参保|个人缴费|灵活就业/u.test(
    text,
  );
}

export function ocrResultFromRawText(
  source: SocialSecurityOCRResult,
  rawText = source.rawText,
): SocialSecurityOCRResult {
  const lines = rawText
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  const cells: SocialSecurityOCRCell[] = [];
  lines.forEach((line, row) => {
    const parts = line
      .split(/\s*\|\s*|\t/u)
      .map((part) => part.trim())
      .filter(Boolean);
    const pieces = parts.length ? parts : [line];
    pieces.forEach((text, column) => {
      cells.push({
        id: `raw:${row}:${column}`,
        rawText: text,
        text,
        row,
        column,
        rowSpan: 1,
        columnSpan: 1,
        confidence: null,
        bbox: null,
        polygon: null,
      });
    });
  });
  return {
    ...source,
    rawText,
    tables: cells.length
      ? [
          {
            id: "raw-text",
            page: source.page,
            cells,
            confidence: null,
            provider: source.provider,
            providerVersion: source.providerVersion,
            ocrVersion: source.ocrVersion,
            contentHash: source.contentHash,
            rawProviderResponseRef: source.rawProviderResponseRef,
          },
        ]
      : [],
  };
}

function ocrHasUsableTables(ocr: SocialSecurityOCRResult): boolean {
  return (
    tableTopologyValid(ocr) &&
    ocr.tables.some((table) => table.cells.some((cell) => cell.rawText.trim()))
  );
}

function fullMonthFacts(row: TableRow): GenericMonthFact[] {
  const result: GenericMonthFact[] = [];
  for (const cell of row.cells) {
    const correction = controlledNumericCorrection(cell.rawText);
    const corrected = correction.value;
    const matches = [
      ...corrected.matchAll(
        /(?:^|[^\d])((?:19|20)\d{2})\s*(?:年|[-/.])?\s*(0?[1-9]|1[0-2])\s*(?:月)?(?=[^\d]|$)/gu,
      ),
    ];
    for (const match of matches) {
      const rawMatch = match[0].trim().replace(/^[^\d]+|[^\d月]+$/gu, "");
      const parsed = parseOCRMonthWithTransformations(rawMatch);
      if (!parsed.value) continue;
      const substringTransformations: ValueTransformation[] =
        corrected.trim() === rawMatch
          ? []
          : [
              {
                type: "DATE_SUBSTRING_EXTRACTION",
                from: corrected,
                to: rawMatch,
              },
            ];
      result.push({
        value: parsed.value,
        cell,
        row,
        confidence: cell.confidence,
        transformations: [
          ...correction.transformations,
          ...substringTransformations,
          ...parsed.transformations,
        ],
        explicit: true,
      });
    }
  }
  if (result.length) return result;

  for (let index = 0; index < row.cells.length - 1; index += 1) {
    const yearCell = row.cells[index];
    const monthCell = row.cells[index + 1];
    const year = correctedNumericText(yearCell.rawText).trim();
    const month = Number(correctedNumericText(monthCell.rawText).trim());
    if (!/^(?:19|20)\d{2}$/u.test(year) || month < 1 || month > 12) continue;
    result.push({
      value: `${year}-${String(month).padStart(2, "0")}`,
      cell: monthCell,
      row,
      confidence:
        yearCell.confidence === null || monthCell.confidence === null
          ? null
          : Math.min(yearCell.confidence, monthCell.confidence),
      transformations: [],
      explicit: false,
    });
  }
  return result;
}

function nearestCompany(
  month: GenericMonthFact,
  companies: SocialSecurityOCRCell[],
) {
  return [...companies].sort(
    (left, right) =>
      Math.abs(left.column - month.cell.column) -
      Math.abs(right.column - month.cell.column),
  )[0];
}

function intervalLayoutCells(allRows: TableRow[], row: TableRow) {
  return allRows
    .filter(
      (candidate) =>
        candidate.tableIndex === row.tableIndex &&
        candidate.index <= row.index,
    )
    .flatMap((candidate) => candidate.cells)
    .filter((cell) =>
      /起止|开始.*结束|起始.*终止|缴费(?:期间|区间)/u.test(
        cell.rawText,
      ),
    );
}

function statedPaidMonthCount(
  tableRows: TableRow[],
  row: TableRow,
  evidence: SocialSecurityCellEvidence[],
): EvidenceReference<number> | null {
  const nearbyRows = tableRows
    .filter(
      (candidate) =>
        candidate.tableIndex === row.tableIndex &&
        Math.abs(candidate.index - row.index) <= 2,
    )
    .sort(
      (left, right) =>
        Math.abs(left.index - row.index) - Math.abs(right.index - row.index),
    );
  for (const candidateRow of nearbyRows) {
    for (const cell of candidateRow.cells) {
    const corrected = controlledNumericCorrection(cell.rawText);
    const match = corrected.value.match(
      /(?:累计|缴费月数|累计月数)\D*(\d+)\s*(?:个?月)?/u,
    );
    if (!match) continue;
    const value = Number(match[1]);
    if (!Number.isSafeInteger(value) || value < 0) continue;
    return reference(
      cell.rawText,
      value,
      cellEvidence(evidence, candidateRow, cell),
      corrected.transformations,
    );
    }
  }
  return null;
}

function collectGenericFacts(
  tableRows: TableRow[],
  evidence: SocialSecurityCellEvidence[],
): GenericCompanyFact[] {
  const grouped = new Map<string, GenericCompanyFact>();
  for (const row of tableRows) {
    const companies = row.cells.filter(companyCandidate);
    const months = fullMonthFacts(row);
    if (!companies.length || !months.length) continue;

    const intervalCells = intervalLayoutCells(tableRows, row);
    const statedCount = statedPaidMonthCount(tableRows, row, evidence);
    const hasRangeNotation = row.cells.some((cell) =>
      /(?:~|～|至|—|–)/u.test(cell.rawText),
    );
    if (
      companies.length === 1 &&
      months.length >= 2 &&
      (intervalCells.length || statedCount !== null || hasRangeNotation)
    ) {
      const start = months[0];
      const end = months.at(-1)!;
      if (monthIndex(end.value) < monthIndex(start.value)) continue;
      const company = companies[0];
      const companyKey = company.rawText.trim();
      const startEvidence = cellEvidence(evidence, row, start.cell);
      const endEvidence = cellEvidence(evidence, row, end.cell);
      const periodEvidenceIds = [
        startEvidence?.id,
        endEvidence?.id,
      ].filter((value): value is string => Boolean(value));
      const range = inclusiveMonthRange(start.value, end.value);
      const intervalEvidence =
        startEvidence &&
        endEvidence &&
        statedCount?.value !== null &&
        statedCount?.value === range.length
          ? {
              semantics: "INTERVAL_WITH_STATED_MONTH_COUNT" as const,
              startMonth: reference(
                start.cell.rawText,
                start.value,
                startEvidence,
                start.transformations,
              ),
              endMonth: reference(
                end.cell.rawText,
                end.value,
                endEvidence,
                end.transformations,
              ),
              statedPaidMonthCount: statedCount,
            }
          : null;
      const expanded = (intervalEvidence
        ? inclusiveMonthRange(start.value, end.value)
        : [start.value, end.value]
      ).map((value) => ({
        value,
        cell: value === end.value ? end.cell : start.cell,
        row,
        confidence:
          start.confidence === null || end.confidence === null
            ? null
            : Math.min(start.confidence, end.confidence),
        transformations:
          value === start.value
            ? start.transformations
            : value === end.value
              ? end.transformations
              : [],
        explicit: value === start.value || value === end.value,
      }));
      const current = grouped.get(companyKey);
      grouped.set(companyKey, {
        companyCell: current?.companyCell ?? company,
        companyRow: current?.companyRow ?? row,
        months: [...(current?.months ?? []), ...expanded],
        period: {
          rawValue: `${start.cell.rawText}/${end.cell.rawText}`,
          value: `${start.value}/${end.value}`,
          evidenceIds: [...new Set(periodEvidenceIds)],
          transformations: [
            ...start.transformations,
            ...end.transformations,
          ],
        },
        intervalEvidence:
          current?.intervalEvidence || current?.period
            ? null
            : intervalEvidence,
        statedPaidMonthCount: statedCount ?? current?.statedPaidMonthCount ?? null,
        requiresManualReview:
          Boolean(current?.requiresManualReview) ||
          Boolean(current?.period),
      });
      continue;
    }

    for (const month of months) {
      const company = nearestCompany(month, companies);
      if (!company) continue;
      const companyKey = company.rawText.trim();
      const current = grouped.get(companyKey);
      grouped.set(companyKey, {
        companyCell: current?.companyCell ?? company,
        companyRow: current?.companyRow ?? row,
        months: [...(current?.months ?? []), month],
        period: current?.period ?? null,
        intervalEvidence: current?.intervalEvidence ?? null,
        statedPaidMonthCount: current?.statedPaidMonthCount ?? null,
        requiresManualReview:
          Boolean(current?.requiresManualReview) || !month.explicit,
      });
    }
  }
  return [...grouped.values()];
}

function mergeGenericFacts(
  tableFacts: GenericCompanyFact[],
  textFacts: GenericCompanyFact[],
): GenericCompanyFact[] {
  const merged = new Map<string, GenericCompanyFact>();
  for (const fact of [...tableFacts, ...textFacts]) {
    const key = fact.companyCell.rawText.trim();
    const current = merged.get(key);
    if (!current) {
      merged.set(key, fact);
      continue;
    }
    const richer =
      fact.months.length > current.months.length ? fact : current;
    merged.set(key, {
      ...richer,
      months: [...current.months, ...fact.months].filter(
        (month, index, all) =>
          all.findIndex((entry) => entry.value === month.value) === index,
      ),
      statedPaidMonthCount:
        current.statedPaidMonthCount ?? fact.statedPaidMonthCount,
      intervalEvidence: current.intervalEvidence ?? fact.intervalEvidence,
    });
  }
  return [...merged.values()];
}

export class GenericSocialSecurityParser implements SocialSecurityTableParser {
  parse(input: SocialSecurityParserInput): SocialSecurityParseResult;
  parse(ocr: SocialSecurityOCRResult, sourceFile: string): SocialSecurityParseResult;
  parse(
    input: SocialSecurityParserInput | SocialSecurityOCRResult,
    sourceFile?: string,
  ): SocialSecurityParseResult {
    const unpacked = unpackInput(input, sourceFile);
    const workingOcr = ocrHasUsableTables(unpacked.ocr)
      ? unpacked.ocr
      : ocrResultFromRawText(unpacked.ocr);
    const workingInput = { ...unpacked, ocr: workingOcr };
    if (!workingOcr.rawText.trim() && !ocrHasUsableTables(workingOcr)) {
      return {
        template: "GENERIC",
        status: "manual-required",
        autoVerifiable: false,
        records: [],
        rawRecords: [],
        reasons: ["NO_USABLE_OCR_TEXT"],
      };
    }
    const evidence = evidenceForInput(workingInput);
    const parsedRecords: ParsedSocialSecurityRecord[] = [];
    const rawRecords: SocialSecurityRawRecord[] = [];
    const tableFacts = ocrHasUsableTables(unpacked.ocr)
      ? collectGenericFacts(rows(unpacked.ocr), evidence)
      : [];
    const textFacts = collectGenericFacts(rows(ocrResultFromRawText(unpacked.ocr)), evidence);
    const facts = mergeGenericFacts(tableFacts, textFacts);
    for (const fact of facts) {
      const candidateMonths = [
        ...new Set(fact.months.map((month) => month.value)),
      ].sort((left, right) => monthIndex(left) - monthIndex(right));
      if (!candidateMonths.length) continue;
      const paidMonths = fact.period
        ? fact.intervalEvidence
          ? inclusiveMonthRange(
              fact.intervalEvidence.startMonth.value!,
              fact.intervalEvidence.endMonth.value!,
            )
          : null
        : candidateMonths;
      const statedCount = fact.statedPaidMonthCount?.value ?? null;
      const periodMonths = fact.period?.value?.split("/") ?? [];
      const interval =
        periodMonths.length === 2
          ? { startMonth: periodMonths[0], endMonth: periodMonths[1] }
          : null;
      const derived = derivePaidMonthFacts(paidMonths, statedCount, interval);
      const sourceRows = [...new Set(fact.months.map((month) => month.row))];
      const confidenceValues = [
        fact.companyCell.confidence,
        ...fact.months.map((month) => month.confidence),
      ].filter((value): value is number => value !== null);
      const minimumConfidence = confidenceValues.length
        ? Math.min(...confidenceValues)
        : null;
      const companyEvidence = cellEvidence(
        evidence,
        fact.companyRow,
        fact.companyCell,
      );
      const monthlyRecords: SocialSecurityMonthlyRecord[] = fact.period
        ? []
        : fact.months
        .filter((month) => month.explicit)
        .map((month) => {
          const monthEvidence = cellEvidence(
            evidence,
            month.row,
            month.cell,
          );
          return {
            month: reference(
              month.cell.rawText,
              month.value,
              monthEvidence,
              month.transformations,
            ),
            unitCode: reference<string>(null, null, null),
            companyRaw: reference(
              fact.companyCell.rawText,
              fact.companyCell.rawText,
              companyEvidence,
            ),
            pension: null,
            medical: null,
            injury: null,
            unemployment: null,
            maternity: null,
            evidenceIds: [companyEvidence?.id, monthEvidence?.id].filter(
              (value): value is string => Boolean(value),
            ),
          };
        });
      const paidMonthEvidence = fact.intervalEvidence && paidMonths
        ? paidMonths.map((month) => ({
            month,
            status: "DERIVED_FROM_VALIDATED_INTERVAL" as const,
            evidenceIds: [],
            derivedFrom: {
              startMonth: fact.intervalEvidence!.startMonth,
              endMonth: fact.intervalEvidence!.endMonth,
              statedPaidMonthCount:
                fact.intervalEvidence!.statedPaidMonthCount,
            },
          }))
        : monthlyRecords
            .filter((monthly) => monthly.month.value !== null)
            .map((monthly) => ({
              month: monthly.month.value!,
              status: "EXTRACTED" as const,
              evidenceIds: [...monthly.month.evidenceIds],
              derivedFrom: null,
            }));
      const evidenceIds = [
        companyEvidence?.id,
        ...monthlyRecords.flatMap((record) => record.evidenceIds),
        ...(fact.period?.evidenceIds ?? []),
        ...(fact.statedPaidMonthCount?.evidenceIds ?? []),
      ].filter((value): value is string => Boolean(value));
      const countMismatch = derived.monthCountCrosscheck === "MISMATCH";
      const requiresManualReview =
        fact.requiresManualReview || countMismatch;
      const rawRecord: SocialSecurityRawRecord = {
        companyRaw: reference(
          fact.companyCell.rawText,
          fact.companyCell.rawText,
          companyEvidence,
        ),
        companyNormalized: normalizeCompanyName(fact.companyCell.rawText),
        unitCode: null,
        monthlyRecords,
        paidMonths,
        paidMonthEvidence,
        rawPeriod: fact.period,
        intervalEvidence: fact.intervalEvidence,
        derivedPaidMonths: fact.intervalEvidence ? paidMonths : null,
        statedPaidMonthCount: fact.statedPaidMonthCount,
        pensionMonths: null,
        medicalMonths: null,
        injuryMonths: null,
        unemploymentMonths: null,
        maternityMonths: null,
        derived,
        evidenceIds,
        status: requiresManualReview ? "MANUAL_REVIEW_REQUIRED" : "PARSED",
        warnings: countMismatch ? ["MONTH_COUNT_MISMATCH"] : [],
      };
      rawRecords.push(rawRecord);
      const baseSource = combinedSource(
        unpacked.sourceFile,
        [fact.companyRow, ...sourceRows],
      );
      parsedRecords.push({
        companyRaw: fact.companyCell.rawText,
        companyNormalized: normalizeCompanyName(fact.companyCell.rawText),
        startMonth: derived.startMonth ?? candidateMonths[0],
        endMonth: derived.endMonth ?? candidateMonths.at(-1)!,
        paidMonths,
        statedPaidMonthCount: statedCount,
        pensionMonths: null,
        injuryMonths: null,
        unemploymentMonths: null,
        fieldConfidence: {
          company: fact.companyCell.confidence,
          startMonth: minimumConfidence,
          endMonth: minimumConfidence,
          paidMonths: requiresManualReview ? null : minimumConfidence,
          pensionMonths: null,
          injuryMonths: null,
          unemploymentMonths: null,
        },
        source: {
          ...baseSource,
          quote: baseSource.quote,
        },
        rawRecord,
      });
    }
    const autoVerifiable =
      parsedRecords.length > 0 &&
      rawRecords.every((record) => record.status === "PARSED");
    const companiesByMonth = new Map<string, Set<string>>();
    for (const record of rawRecords) {
      for (const month of record.paidMonths ?? []) {
        const companies = companiesByMonth.get(month) ?? new Set<string>();
        if (record.companyRaw.value) companies.add(record.companyRaw.value);
        companiesByMonth.set(month, companies);
      }
    }
    const sameMonthMultiCompany = [...companiesByMonth.values()].some(
      (companies) => companies.size > 1,
    );
    return {
      template: "GENERIC",
      status: autoVerifiable ? "parsed" : "manual-required",
      autoVerifiable,
      records: parsedRecords,
      rawRecords,
      sameMonthMultiCompany,
      reasons: parsedRecords.length
        ? [...new Set(rawRecords.flatMap((record) => record.warnings))]
        : ["PARSER_FAILED"],
    };
  }
}

export function parseSocialSecurityTable(
  input: SocialSecurityParserInput,
): SocialSecurityParseResult {
  return new GenericSocialSecurityParser().parse(input);
}
