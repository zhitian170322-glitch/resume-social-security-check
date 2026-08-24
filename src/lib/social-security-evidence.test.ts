import { describe, expect, it } from "vitest";
import {
  buildSocialSecurityCellEvidence,
  derivePaidMonthFacts,
} from "./social-security-evidence";
import type { SocialSecurityOCRResult } from "./social-security-table";

describe("social-security cell evidence and paid-month facts", () => {
  it("derives gaps and multiple periods without filling missing months", () => {
    expect(
      derivePaidMonthFacts([
        "2022-08",
        "2022-09",
        "2022-10",
        "2022-12",
      ]),
    ).toEqual({
      startMonth: "2022-08",
      endMonth: "2022-12",
      paidMonthCount: 4,
      gapMonths: ["2022-11"],
      periods: [
        {
          startMonth: "2022-08",
          endMonth: "2022-10",
          paidMonthCount: 3,
        },
        {
          startMonth: "2022-12",
          endMonth: "2022-12",
          paidMonthCount: 1,
        },
      ],
    });
  });

  it("retains cell coordinates, geometry, confidence, provider and raw value", () => {
    const result: SocialSecurityOCRResult = {
      page: 1,
      rawText: "30078648",
      requestId: "request-1",
      provider: "aliyun",
      providerVersion: "ocr-api20210707",
      apiType: "TABLE",
      ocrVersion: "social-security-ocr-v1",
      contentHash: "page-content-hash",
      rawProviderResponseRef: "request-1",
      tables: [
        {
          id: "table-0",
          page: 2,
          confidence: 0.98,
          provider: "aliyun",
          providerVersion: "ocr-api20210707",
          ocrVersion: "social-security-ocr-v1",
          contentHash: "page-content-hash",
          rawProviderResponseRef: "request-1",
          cells: [
            {
              id: "cell-7",
              rawText: "30078648",
              text: "30078648",
              row: 3,
              column: 1,
              rowSpan: 1,
              columnSpan: 1,
              confidence: 0.97,
              bbox: { x: 10, y: 20, width: 100, height: 30 },
              polygon: [
                { x: 10, y: 20 },
                { x: 110, y: 20 },
                { x: 110, y: 50 },
                { x: 10, y: 50 },
              ],
            },
          ],
        },
      ],
    };

    expect(buildSocialSecurityCellEvidence("document-1", result)).toEqual([
      expect.objectContaining({
        documentId: "document-1",
        pageNumber: 2,
        tableIndex: 0,
        rowIndex: 3,
        columnIndex: 1,
        sourceCellId: "cell-7",
        rawValue: "30078648",
        bbox: { x: 10, y: 20, width: 100, height: 30 },
        confidence: 0.97,
        extractionMethod: "OCR_TABLE",
        provider: "aliyun",
        providerVersion: "ocr-api20210707",
        contentHash: "page-content-hash",
        ocrVersion: "social-security-ocr-v1",
      }),
    ]);
  });
});
