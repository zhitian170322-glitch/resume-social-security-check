import {
  ocrResultFromRawText,
  parseOCRMonth,
  parseSocialSecurityTable,
} from "./social-security-parsers";
import type { SocialSecurityOCRResult } from "./social-security-table";
import {
  inferPaymentType,
  uniquePaidMonths,
  type SocialRecord,
} from "./simple-verification";
import { inclusiveMonthRange } from "./social-security-evidence";

const COMPANY_PATTERN =
  /(?:[\u4e00-\u9fffA-Za-z0-9（）()·•]+?(?:公司|集团|事务所|中心|工厂|银行|学校|医院|合作社)|(?:个人参保|个人缴费窗口|灵活就业)[^\n]{0,20})/u;

function quoteFor(record: {
  companyRaw: string | null;
  startMonth: string | null;
  endMonth: string | null;
}): string {
  return [record.companyRaw, record.startMonth, record.endMonth]
    .filter(Boolean)
    .join(" ");
}

function statedCount(text: string): number | null {
  const match = text.match(/(?:累计|缴费月数|累计月数)\D*(\d+)\s*(?:个?月)?/u);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export function extractSocialRecordsFromRawText(
  rawText: string,
  sourceFile: string,
  sourcePage = 1,
): SocialRecord[] {
  const records: SocialRecord[] = [];
  const lines = rawText
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  const blob = lines.join("\n");
  const count = statedCount(blob);

  for (const line of lines) {
    const companyMatch = line.match(COMPANY_PATTERN);
    const companyRaw = companyMatch?.[0]?.trim() || null;
    const months = [
      ...line.matchAll(
        /(?:19|20)\d{2}\s*(?:年|[-/.])\s*(?:0?[1-9]|1[0-2])\s*月?/gu,
      ),
    ]
      .map((match) => parseOCRMonth(match[0]))
      .filter((month): month is string => Boolean(month));
    const unique = uniquePaidMonths(months);
    if (!companyRaw && !unique.length) continue;
    const startMonth = unique[0] ?? null;
    const endMonth = unique.at(-1) ?? null;
    const hasRange = /(?:~|～|至|—|–)/u.test(line);
    const paidMonths =
      hasRange && startMonth && endMonth
        ? unique.length === 2 && count === inclusiveMonthRange(startMonth, endMonth).length
          ? inclusiveMonthRange(startMonth, endMonth)
          : unique
        : unique;
    records.push({
      companyRaw,
      startMonth,
      endMonth,
      paidMonths,
      paymentType: inferPaymentType(companyRaw),
      sourceFile,
      sourcePage,
      sourceQuote: line.slice(0, 240),
    });
  }

  if (!records.length && (blob.trim() || count !== null)) {
    records.push({
      companyRaw: null,
      startMonth: null,
      endMonth: null,
      paidMonths: [],
      paymentType: "unknown",
      sourceFile,
      sourcePage,
      sourceQuote: blob.slice(0, 240) || undefined,
    });
  }
  return records;
}

function fromParser(
  ocr: SocialSecurityOCRResult,
  sourceFile: string,
): SocialRecord[] {
  const parsed = parseSocialSecurityTable({
    ocr: ocr.tables.some((table) => table.cells.length)
      ? ocr
      : ocrResultFromRawText(ocr),
    sourceFile,
  });
  return parsed.records.map((record) => ({
    companyRaw: record.companyRaw?.trim() || null,
    startMonth: record.startMonth || null,
    endMonth: record.endMonth || null,
    paidMonths: uniquePaidMonths(record.paidMonths ?? []),
    paymentType: inferPaymentType(record.companyRaw),
    sourceFile: record.source.file,
    sourcePage: record.source.page,
    sourceQuote: record.source.quote || quoteFor(record),
  }));
}

function recordKey(record: SocialRecord) {
  return [
    record.companyRaw?.trim() || "",
    record.startMonth || "",
    record.endMonth || "",
  ].join("|");
}

export function mergeSocialRecords(groups: SocialRecord[][]): SocialRecord[] {
  const merged = new Map<string, SocialRecord>();
  for (const group of groups) {
    for (const record of group) {
      const key = recordKey(record);
      const current = merged.get(key);
      if (!current) {
        merged.set(key, record);
        continue;
      }
      merged.set(key, {
        ...current,
        companyRaw: current.companyRaw ?? record.companyRaw,
        startMonth: current.startMonth ?? record.startMonth,
        endMonth: current.endMonth ?? record.endMonth,
        paidMonths: uniquePaidMonths([
          ...current.paidMonths,
          ...record.paidMonths,
        ]),
        sourceQuote: current.sourceQuote || record.sourceQuote,
        sourceFile: current.sourceFile ?? record.sourceFile,
        sourcePage: current.sourcePage ?? record.sourcePage,
        paymentType:
          current.paymentType === "unknown" ? record.paymentType : current.paymentType,
      });
    }
  }
  return [...merged.values()];
}

export function extractSocialRecords(input: {
  ocr: SocialSecurityOCRResult;
  sourceFile: string;
}): SocialRecord[] {
  const fromTablesAndText = fromParser(input.ocr, input.sourceFile);
  const fromRawText = extractSocialRecordsFromRawText(
    input.ocr.rawText,
    input.sourceFile,
    input.ocr.page,
  );
  const merged = mergeSocialRecords([fromTablesAndText, fromRawText]);
  return merged.filter(
    (record) =>
      record.companyRaw ||
      record.startMonth ||
      record.endMonth ||
      record.paidMonths.length,
  );
}
