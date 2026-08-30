import type { SocialSecurityOCRResult } from "@/lib/social-security-table";

function cell(row: number, column: number, text: string, index: number) {
  return {
    id: `c-${index}`,
    rawText: text,
    text,
    row,
    column,
    rowSpan: 1,
    columnSpan: 1,
    confidence: 0.99,
    bbox: { x: column * 80, y: row * 24, width: 70, height: 20 },
    polygon: null,
  };
}

export function anonymizedOcr(
  rawText: string,
  cells: Array<{ row: number; column: number; text: string }> = [],
  page = 1,
): SocialSecurityOCRResult {
  return {
    page,
    rawText,
    tables: cells.length
      ? [
          {
            id: `t-${page}`,
            page,
            cells: cells.map((item, index) => cell(item.row, item.column, item.text, index)),
            confidence: 0.99,
            provider: "fixture",
            providerVersion: "v5",
            ocrVersion: "v5",
            contentHash: "fixture",
            rawProviderResponseRef: null,
          },
        ]
      : [],
    requestId: "fixture",
    provider: "fixture",
    providerVersion: "v5",
    apiType: cells.length ? "TABLE" : "GENERAL",
    ocrVersion: "v5",
    contentHash: "fixture",
    rawProviderResponseRef: null,
  };
}

export const MONTHLY_UNIT_CODE_TEXT = [
  ...Array.from({ length: 9 }, (_, index) => `2025-${String(index + 1).padStart(2, "0")} 470855`),
  ...Array.from({ length: 9 }, (_, index) => {
    const month = index + 10;
    return month <= 12
      ? `2025-${String(month).padStart(2, "0")} 693601`
      : `2026-${String(month - 12).padStart(2, "0")} 693601`;
  }),
  "2026-07 910017",
].join("\n");

export const SEPARATED_CODE_NAME_TEXT = [
  "单位编号",
  "470855",
  "693601",
  "910017",
  "单位名称",
  "深圳示例动力信息技术有限公司",
  "中电示例软件有限公司",
  "示例光电科技有限公司",
].join("\n");

export const TABLE_CODE_NAME_CELLS = [
  { row: 0, column: 0, text: "470855" },
  { row: 0, column: 1, text: "深圳示例动力信息技术有限公司" },
  { row: 1, column: 0, text: "693601" },
  { row: 1, column: 1, text: "中电示例软件有限公司" },
  { row: 2, column: 0, text: "910017" },
  { row: 2, column: 1, text: "示例光电科技有限公司" },
];

export const AMBIGUOUS_CODE_NAME_TEXT = [
  "470855 深圳示例动力信息技术有限公司",
  "470855 另一家同号示例公司",
  "2025-01 470855",
].join("\n");

export const REGION_POLLUTION_TEXT = [
  "广东省：",
  "深圳市： 深圳示例动力信息技术有限公司",
  "东莞市：中电示例软件有限公司",
].join("\n");
