import {
  type SocialSecurityOCRCell,
  type SocialSecurityOCRResult,
  type SocialSecurityOCRTable,
} from "./social-security-table";

export type SocialSecurityTemplate = "shenzhen" | "guangdong" | "unknown";

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
  paidMonths: string[];
  pensionMonths: number | null;
  injuryMonths: number | null;
  unemploymentMonths: number | null;
  source: SocialSecurityRecordSource;
}

export interface SocialSecurityParseResult {
  template: SocialSecurityTemplate;
  status: "parsed" | "manual-required";
  autoVerifiable: boolean;
  records: ParsedSocialSecurityRecord[];
  reasons: string[];
}

export interface SocialSecurityParserInput {
  ocr: SocialSecurityOCRResult;
  sourceFile: string;
}

export interface SocialSecurityTableParser {
  parse(input: SocialSecurityParserInput): SocialSecurityParseResult;
  parse(ocr: SocialSecurityOCRResult, sourceFile: string): SocialSecurityParseResult;
}

interface TableRow {
  table: SocialSecurityOCRTable;
  index: number;
  cells: SocialSecurityOCRCell[];
}

interface UnitMonth {
  unit: string;
  month: string;
  row: TableRow;
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
  return value.normalize("NFKC").replace(/[Oo]/g, "0").replace(/[Il]/g, "1");
}

export function parseOCRNumber(value: string): number | null {
  const match = correctedNumericText(value).match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const number = Number(match[0]);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

export function parseOCRMonth(value: string): string | null {
  const corrected = correctedNumericText(value);
  const match = corrected.match(
    /(?:^|[^\d])((?:19|20)\d{2})\s*(?:年|[-/.])?\s*(\d{1,2})(?:\s*月)?(?:[^\d]|$)/,
  );
  if (!match) return null;
  const month = Number(match[2]);
  return month >= 1 && month <= 12
    ? `${match[1]}-${String(month).padStart(2, "0")}`
    : null;
}

function monthIndex(value: string): number {
  const [year, month] = value.split("-").map(Number);
  return year * 12 + month - 1;
}

function monthFromIndex(value: number): string {
  return `${Math.floor(value / 12)}-${String((value % 12) + 1).padStart(2, "0")}`;
}

function inclusiveMonths(start: string, end: string): string[] {
  const first = monthIndex(start);
  const last = monthIndex(end);
  if (last < first) return [];
  return Array.from({ length: last - first + 1 }, (_, index) =>
    monthFromIndex(first + index),
  );
}

function continuousMonthRuns(months: string[]): string[][] {
  const sorted = [...new Set(months)].sort(
    (left, right) => monthIndex(left) - monthIndex(right),
  );
  const runs: string[][] = [];
  for (const month of sorted) {
    const current = runs.at(-1);
    if (!current || monthIndex(month) !== monthIndex(current.at(-1)!) + 1) {
      runs.push([month]);
    } else {
      current.push(month);
    }
  }
  return runs;
}

function rows(ocr: SocialSecurityOCRResult): TableRow[] {
  return ocr.tables.flatMap((table) => {
    const grouped = new Map<number, SocialSecurityOCRCell[]>();
    for (const cell of table.cells) {
      grouped.set(cell.row, [...(grouped.get(cell.row) ?? []), cell]);
    }
    return [...grouped.entries()]
      .sort(([left], [right]) => left - right)
      .map(([index, cells]) => ({
        table,
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
};

const GUANGDONG_HEADERS = {
  company: ["单位名称", "参保单位", "缴费单位", "公司名称"],
  start: ["开始年月", "起始年月", "参保开始年月", "缴费起始年月"],
  end: ["结束年月", "终止年月", "截止年月", "参保结束年月", "缴费终止年月"],
  pension: ["养老", "养老保险"],
  injury: ["工伤", "工伤保险"],
  unemployment: ["失业", "失业保险"],
};

function corpus(ocr: SocialSecurityOCRResult): string {
  return compact(
    [ocr.rawText, ...ocr.tables.flatMap((table) => table.cells.map((cell) => cell.text))]
      .join("\n"),
  );
}

export class SocialSecurityTemplateDetector {
  detect(ocr: SocialSecurityOCRResult): SocialSecurityTemplate {
    const text = corpus(ocr);
    const shenzhenStructure =
      text.includes("单位编号") &&
      (text.includes("缴费年月") || text.includes("费款所属期"));
    if ((text.includes("深圳") && shenzhenStructure) || text.includes("深圳市社会保险")) {
      return "shenzhen";
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
      return "guangdong";
    }
    return "unknown";
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
    const { ocr, sourceFile: file } = unpackInput(input, sourceFile);
    const allRows = rows(ocr);
    const companies = new Map<string, { name: string; row: TableRow }>();
    const months: UnitMonth[] = [];

    for (const header of allRows) {
      const mapping = headerColumns(header, SHENZHEN_UNIT_HEADERS);
      if (mapping.has("unit") && mapping.has("company")) {
        for (const row of followingRows(allRows, header)) {
          const unit = cellAt(row, mapping.get("unit"))?.text.trim() ?? "";
          const company = cellAt(row, mapping.get("company"))?.text ?? "";
          if (unit && company.trim() && !parseOCRMonth(unit) && !parseOCRMonth(company)) {
            companies.set(correctedNumericText(unit).replace(/\s/g, ""), {
              name: company,
              row,
            });
          }
        }
      }

      const monthly = headerColumns(header, SHENZHEN_MONTH_HEADERS);
      if (monthly.has("unit") && monthly.has("month")) {
        for (const row of followingRows(allRows, header)) {
          const unit = cellAt(row, monthly.get("unit"))?.text.trim() ?? "";
          const month = parseOCRMonth(cellAt(row, monthly.get("month"))?.text ?? "");
          if (unit && month) {
            months.push({
              unit: correctedNumericText(unit).replace(/\s/g, ""),
              month,
              row,
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
    const missingUnits: string[] = [];
    for (const [unit, items] of byUnit) {
      const company = companies.get(unit);
      if (!company) {
        missingUnits.push(unit);
        continue;
      }
      const paidMonths = continuousMonthRuns(items.map((item) => item.month)).flat();
      records.push({
        companyRaw: company.name,
        companyNormalized: normalizeCompanyName(company.name),
        startMonth: paidMonths[0],
        endMonth: paidMonths.at(-1)!,
        paidMonths,
        pensionMonths: null,
        injuryMonths: null,
        unemploymentMonths: null,
        source: combinedSource(file, [company.row, ...items.map((item) => item.row)]),
      });
    }

    const reasons: string[] = [];
    if (!records.length) reasons.push("未找到可关联的单位编号、单位名称和缴费年月");
    if (missingUnits.length) {
      reasons.push(`以下单位编号缺少单位名称映射：${[...new Set(missingUnits)].join("、")}`);
    }
    return {
      template: "shenzhen",
      status: records.length && !missingUnits.length ? "parsed" : "manual-required",
      autoVerifiable: records.length > 0 && missingUnits.length === 0,
      records,
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
    const { ocr, sourceFile: file } = unpackInput(input, sourceFile);
    const allRows = rows(ocr);
    const records: ParsedSocialSecurityRecord[] = [];

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
        const companyRaw = cellAt(row, columns.get("company"))?.text ?? "";
        const startMonth = parseOCRMonth(cellAt(row, columns.get("start"))?.text ?? "");
        const endMonth = parseOCRMonth(cellAt(row, columns.get("end"))?.text ?? "");
        if (
          !companyRaw.trim() ||
          !startMonth ||
          !endMonth ||
          monthIndex(endMonth) < monthIndex(startMonth)
        ) {
          continue;
        }
        const pensionMonths = parseOCRNumber(
          cellAt(row, columns.get("pension"))?.text ?? "",
        );
        const injuryMonths = parseOCRNumber(
          cellAt(row, columns.get("injury"))?.text ?? "",
        );
        const unemploymentMonths = parseOCRNumber(
          cellAt(row, columns.get("unemployment"))?.text ?? "",
        );
        const rangeMonths = inclusiveMonths(startMonth, endMonth);
        records.push({
          companyRaw,
          companyNormalized: normalizeCompanyName(companyRaw),
          startMonth,
          endMonth,
          paidMonths:
            pensionMonths === rangeMonths.length ? rangeMonths : [],
          pensionMonths,
          injuryMonths,
          unemploymentMonths,
          source: combinedSource(file, [row]),
        });
      }
    }

    const allPeriodsSupported =
      records.length > 0 && records.every((record) => record.paidMonths.length > 0);
    return {
      template: "guangdong",
      status: allPeriodsSupported ? "parsed" : "manual-required",
      autoVerifiable: allPeriodsSupported,
      records,
      reasons: !records.length
        ? ["未找到完整的单位、起止年月和险种列"]
        : allPeriodsSupported
          ? []
          : ["险种月数无法证明起止区间内每月均有缴费，必须人工复核"],
    };
  }
}

export class GenericSocialSecurityParser implements SocialSecurityTableParser {
  parse(input: SocialSecurityParserInput): SocialSecurityParseResult;
  parse(ocr: SocialSecurityOCRResult, sourceFile: string): SocialSecurityParseResult;
  parse(
    input: SocialSecurityParserInput | SocialSecurityOCRResult,
    sourceFile?: string,
  ): SocialSecurityParseResult {
    void input;
    void sourceFile;
    return {
      template: "unknown",
      status: "manual-required",
      autoVerifiable: false,
      records: [],
      reasons: ["无法识别社保表格模板，必须人工复核"],
    };
  }
}

export function parseSocialSecurityTable(
  input: SocialSecurityParserInput,
): SocialSecurityParseResult {
  switch (detectSocialSecurityTemplate(input.ocr)) {
    case "shenzhen":
      return new ShenzhenSocialSecurityParser().parse(input);
    case "guangdong":
      return new GuangdongSocialSecurityParser().parse(input);
    default:
      return new GenericSocialSecurityParser().parse(input);
  }
}
