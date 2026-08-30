import { describe, expect, it } from "vitest";
import {
  aggregateMonthlyByUnitCode,
  buildUnitCodeMap,
  extractMonthlyUnitPayments,
} from "./unit-code-map";
import type { SocialSecurityOCRResult } from "./social-security-table";

function ocr(rawText: string, cells: Array<{ row: number; column: number; text: string }> = []): SocialSecurityOCRResult {
  return {
    page: 1,
    rawText,
    tables: cells.length
      ? [
          {
            id: "t",
            page: 1,
            cells: cells.map((cell, index) => ({
              id: String(index),
              rawText: cell.text,
              text: cell.text,
              row: cell.row,
              column: cell.column,
              rowSpan: 1,
              columnSpan: 1,
              confidence: 0.99,
              bbox: null,
              polygon: null,
            })),
            confidence: 0.99,
            provider: "test",
            providerVersion: "t",
            ocrVersion: "t",
            contentHash: "h",
            rawProviderResponseRef: null,
          },
        ]
      : [],
    requestId: "r",
    provider: "test",
    providerVersion: "t",
    apiType: "TABLE",
    ocrVersion: "t",
    contentHash: "h",
    rawProviderResponseRef: null,
  };
}

describe("unit code to company mapping", () => {
  it("maps table cells by row and aggregates consecutive months per code", () => {
    const result = buildUnitCodeMap({
      sourceFile: "social.pdf",
      ocr: ocr(
        [
          "2025-01 470855",
          "2025-09 470855",
          "2025-10 693601",
          "2026-06 693601",
          "2026-07 910017",
          "470855 深圳软通动力信息技术有限公司",
          "693601 中电金信软件有限公司",
          "910017 奥普特科技有限公司",
        ].join("\n"),
        [
          { row: 0, column: 0, text: "470855" },
          { row: 0, column: 1, text: "深圳软通动力信息技术有限公司" },
          { row: 1, column: 0, text: "693601" },
          { row: 1, column: 1, text: "中电金信软件有限公司" },
          { row: 2, column: 0, text: "910017" },
          { row: 2, column: 1, text: "奥普特科技有限公司" },
        ],
      ),
    });
    expect(result.map.get("470855")?.companyRaw).toBe("深圳软通动力信息技术有限公司");
    expect(result.map.get("693601")?.status).toBe("mapped");
    const monthly = extractMonthlyUnitPayments(
      [
        ...Array.from({ length: 9 }, (_, index) => `2025-${String(index + 1).padStart(2, "0")} 470855`),
        ...Array.from({ length: 9 }, (_, index) => {
          const month = index + 10;
          const year = month > 12 ? 2026 : 2025;
          const value = month > 12 ? month - 12 : month;
          return `${year}-${String(value).padStart(2, "0")} 693601`;
        }),
        "2026-07 910017",
      ].join("\n"),
    );
    const aggregated = aggregateMonthlyByUnitCode(monthly, result.map);
    expect(aggregated.map((item) => [item.unitCode, item.paidMonths.length])).toEqual([
      ["470855", 9],
      ["693601", 9],
      ["910017", 1],
    ]);
    expect(aggregated.reduce((sum, item) => sum + item.paidMonths.length, 0)).toBe(19);
  });

  it("maps separated code and name lists in the same order", () => {
    const result = buildUnitCodeMap({
      sourceFile: "social.pdf",
      ocr: ocr(
        ["单位编号", "470855", "693601", "单位名称", "甲科技有限公司", "乙科技有限公司"].join(
          "\n",
        ),
      ),
    });
    expect(result.map.get("470855")?.companyRaw).toBe("甲科技有限公司");
    expect(result.map.get("693601")?.companyRaw).toBe("乙科技有限公司");
  });

  it("marks non-unique mappings for review and keeps the unit code", () => {
    const result = buildUnitCodeMap({
      sourceFile: "social.pdf",
      ocr: ocr(
        ["470855 甲科技有限公司", "470855 乙科技有限公司", "2025-01 470855"].join("\n"),
      ),
    });
    expect(result.map.get("470855")?.status).toBe("needs_review");
    expect(result.map.get("470855")?.companyRaw).toBeNull();
    expect(result.monthly[0]?.unitCode).toBe("470855");
  });

  it("does not merge different unit codes even when months are consecutive", () => {
    const monthly = extractMonthlyUnitPayments("2025-09 470855\n2025-10 693601");
    const aggregated = aggregateMonthlyByUnitCode(monthly, new Map());
    expect(aggregated).toHaveLength(2);
    expect(aggregated.map((item) => item.unitCode)).toEqual(["470855", "693601"]);
  });
});
