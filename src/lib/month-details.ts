import type { SocialRecord } from "./simple-verification";
import { uniquePaidMonths } from "./simple-verification";

export type PaidMonthDetail = {
  month: string;
  unitCode: string | null;
  companyRaw: string | null;
  paymentType: SocialRecord["paymentType"];
  sourceFile?: string;
  sourcePage?: number;
  origin: "system" | "manual";
};

export function buildPaidMonthDetails(
  records: SocialRecord[],
  origin: "system" | "manual" = "system",
): PaidMonthDetail[] {
  const details: PaidMonthDetail[] = [];
  const seen = new Set<string>();
  for (const record of records) {
    for (const month of uniquePaidMonths(record.paidMonths)) {
      const key = [month, record.unitCode ?? "", record.companyRaw ?? "", record.paymentType].join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      details.push({
        month,
        unitCode: record.unitCode ?? null,
        companyRaw: record.companyRaw,
        paymentType: record.paymentType,
        sourceFile: record.sourceFile,
        sourcePage: record.sourcePage,
        origin,
      });
    }
  }
  return details.sort((left, right) => left.month.localeCompare(right.month));
}

export function monthDetailsText(details: PaidMonthDetail[]): string {
  if (!details.length) return "待人工确认";
  return details
    .map((item) =>
      [
        item.month,
        item.unitCode ?? "待人工确认",
        item.companyRaw ?? "待人工确认",
        item.paymentType === "personal"
          ? "个人缴纳"
          : item.paymentType === "company"
            ? "公司缴纳"
            : "缴费类型待确认",
        item.sourceFile ?? "待人工确认",
        item.sourcePage ? `第${item.sourcePage}页` : "待人工确认",
        item.origin === "manual" ? "人工修正" : "系统识别",
      ].join("\t"),
    )
    .join("\n");
}
