import type { SocialSecurityOCRResult } from "./social-security-table";
import {
  isUnitCode,
  stripRegionLabelPrefix,
} from "./company-cleanup";

export type UnitMappingStatus = "mapped" | "needs_review" | "missing";

export type UnitCodeMapping = {
  unitCode: string;
  companyRaw: string | null;
  status: UnitMappingStatus;
  sourceFile?: string;
  sourcePage?: number;
  sourceQuote?: string;
};

export type MonthlyUnitPayment = {
  month: string;
  unitCode: string;
  sourceFile?: string;
  sourcePage?: number;
  sourceQuote?: string;
};

export type UnitCodeMapResult = {
  map: Map<string, UnitCodeMapping>;
  monthly: MonthlyUnitPayment[];
  ambiguous: boolean;
};

const COMPANY_NAME =
  /(?:[\u4e00-\u9fffA-Za-z0-9（）()·•]+?(?:公司|集团|事务所|中心|工厂|银行|学校|医院|合作社)|个人缴费窗口|个人缴费|灵活就业[^\n]{0,12})/u;

function cellText(value: { text?: string; rawText?: string } | string): string {
  if (typeof value === "string") return value.trim();
  return (value.text || value.rawText || "").trim();
}

function lookLikeCompany(text: string): boolean {
  const cleaned = stripRegionLabelPrefix(text);
  return Boolean(cleaned) && !isUnitCode(cleaned) && COMPANY_NAME.test(cleaned);
}

function pairFromRow(cells: string[]): Array<{ unitCode: string; companyRaw: string; quote: string }> {
  const pairs: Array<{ unitCode: string; companyRaw: string; quote: string }> = [];
  for (let index = 0; index < cells.length; index += 1) {
    const left = cells[index];
    const right = cells[index + 1];
    if (isUnitCode(left) && right && lookLikeCompany(right)) {
      pairs.push({
        unitCode: left,
        companyRaw: stripRegionLabelPrefix(right),
        quote: `${left} ${right}`,
      });
    } else if (isUnitCode(right) && lookLikeCompany(left)) {
      pairs.push({
        unitCode: right,
        companyRaw: stripRegionLabelPrefix(left),
        quote: `${left} ${right}`,
      });
    }
  }
  return pairs;
}

function tableRows(ocr: SocialSecurityOCRResult): string[][] {
  return ocr.tables.flatMap((table) => {
    const rows = new Map<number, Map<number, string>>();
    for (const cell of table.cells) {
      const columns = rows.get(cell.row) ?? new Map<number, string>();
      columns.set(cell.column, cellText(cell));
      rows.set(cell.row, columns);
    }
    return [...rows.entries()]
      .sort(([left], [right]) => left - right)
      .map(([, columns]) =>
        [...columns.entries()]
          .sort(([left], [right]) => left - right)
          .map(([, text]) => text)
          .filter(Boolean),
      );
  });
}

function collectLinePairs(text: string): Array<{ unitCode: string; companyRaw: string; quote: string }> {
  const pairs: Array<{ unitCode: string; companyRaw: string; quote: string }> = [];
  for (const line of text.split(/\r?\n/u).map((entry) => entry.trim()).filter(Boolean)) {
    const inline = line.match(
      /^(\d{4,12})\s+(.+)$/u,
    );
    if (inline && lookLikeCompany(inline[2])) {
      pairs.push({
        unitCode: inline[1],
        companyRaw: stripRegionLabelPrefix(inline[2]),
        quote: line,
      });
      continue;
    }
    const reverse = line.match(/^(.+?)\s+(\d{4,12})$/u);
    if (reverse && lookLikeCompany(reverse[1])) {
      pairs.push({
        unitCode: reverse[2],
        companyRaw: stripRegionLabelPrefix(reverse[1]),
        quote: line,
      });
    }
  }
  return pairs;
}

function collectOrderedLists(text: string): Array<{ unitCode: string; companyRaw: string; quote: string }> | null {
  const codes: string[] = [];
  const names: string[] = [];
  for (const line of text.split(/\r?\n/u).map((entry) => entry.trim()).filter(Boolean)) {
    if (isUnitCode(line)) codes.push(line);
    else if (lookLikeCompany(line)) names.push(stripRegionLabelPrefix(line));
  }
  if (!codes.length || !names.length) return null;
  if (codes.length !== names.length) return null;
  return codes.map((unitCode, index) => ({
    unitCode,
    companyRaw: names[index],
    quote: `${unitCode} ${names[index]}`,
  }));
}

export function extractMonthlyUnitPayments(
  text: string,
  sourceFile?: string,
  sourcePage?: number,
): MonthlyUnitPayment[] {
  const payments: MonthlyUnitPayment[] = [];
  const pattern =
    /((?:19|20)\d{2}[-/.年]\s*(?:0?[1-9]|1[0-2])(?:月)?)\s*[:：]?\s*(\d{4,12})/gu;
  for (const match of text.matchAll(pattern)) {
    const month = match[1]
      .replace(/[年/.]/g, "-")
      .replace(/月/g, "")
      .replace(/\s+/g, "");
    const [year, rawMonth] = month.split("-");
    const padded = `${year}-${String(Number(rawMonth)).padStart(2, "0")}`;
    payments.push({
      month: padded,
      unitCode: match[2],
      sourceFile,
      sourcePage,
      sourceQuote: match[0],
    });
  }
  return payments;
}

function mergeMappings(
  pairs: Array<{ unitCode: string; companyRaw: string; quote: string }>,
  sourceFile?: string,
  sourcePage?: number,
): Map<string, UnitCodeMapping> {
  const names = new Map<string, Set<string>>();
  const quotes = new Map<string, string>();
  for (const pair of pairs) {
    const set = names.get(pair.unitCode) ?? new Set<string>();
    set.add(pair.companyRaw);
    names.set(pair.unitCode, set);
    quotes.set(pair.unitCode, pair.quote);
  }
  const map = new Map<string, UnitCodeMapping>();
  for (const [unitCode, set] of names) {
    const unique = [...set];
    map.set(unitCode, {
      unitCode,
      companyRaw: unique.length === 1 ? unique[0] : null,
      status: unique.length === 1 ? "mapped" : "needs_review",
      sourceFile,
      sourcePage,
      sourceQuote: quotes.get(unitCode),
    });
  }
  return map;
}

export function buildUnitCodeMap(input: {
  ocr: SocialSecurityOCRResult;
  sourceFile: string;
}): UnitCodeMapResult {
  const pairs: Array<{ unitCode: string; companyRaw: string; quote: string }> = [];
  for (const row of tableRows(input.ocr)) {
    pairs.push(...pairFromRow(row));
  }
  if (!pairs.length) {
    pairs.push(...collectLinePairs(input.ocr.rawText));
    const ordered = collectOrderedLists(input.ocr.rawText);
    if (ordered) pairs.push(...ordered);
  }
  const map = mergeMappings(pairs, input.sourceFile, input.ocr.page);
  const monthly = [
    ...extractMonthlyUnitPayments(input.ocr.rawText, input.sourceFile, input.ocr.page),
    ...tableRows(input.ocr).flatMap((row) =>
      extractMonthlyUnitPayments(row.join(" "), input.sourceFile, input.ocr.page),
    ),
  ];
  for (const payment of monthly) {
    if (!map.has(payment.unitCode)) {
      map.set(payment.unitCode, {
        unitCode: payment.unitCode,
        companyRaw: null,
        status: "missing",
        sourceFile: payment.sourceFile,
        sourcePage: payment.sourcePage,
        sourceQuote: payment.sourceQuote,
      });
    }
  }
  return {
    map,
    monthly,
    ambiguous: [...map.values()].some((entry) => entry.status === "needs_review"),
  };
}

export function aggregateMonthlyByUnitCode(
  monthly: MonthlyUnitPayment[],
  map: Map<string, UnitCodeMapping>,
): Array<{
  unitCode: string;
  companyRaw: string | null;
  mappingStatus: UnitMappingStatus;
  paidMonths: string[];
  startMonth: string | null;
  endMonth: string | null;
  sourceFile?: string;
  sourcePage?: number;
  sourceQuote?: string;
}> {
  const grouped = new Map<string, MonthlyUnitPayment[]>();
  for (const payment of monthly) {
    grouped.set(payment.unitCode, [...(grouped.get(payment.unitCode) ?? []), payment]);
  }
  return [...grouped.entries()].map(([unitCode, payments]) => {
    const months = [...new Set(payments.map((item) => item.month))].sort();
    const mapping = map.get(unitCode);
    return {
      unitCode,
      companyRaw: mapping?.companyRaw ?? null,
      mappingStatus: mapping?.status ?? "missing",
      paidMonths: months,
      startMonth: months[0] ?? null,
      endMonth: months.at(-1) ?? null,
      sourceFile: payments[0]?.sourceFile,
      sourcePage: payments[0]?.sourcePage,
      sourceQuote: mapping?.sourceQuote ?? payments.map((item) => item.sourceQuote).filter(Boolean).join("；"),
    };
  });
}
