import { describe, expect, it } from "vitest";
import {
  GenericSocialSecurityParser,
  GuangdongSocialSecurityParser,
  ShenzhenSocialSecurityParser,
  detectSocialSecurityTemplate,
  parseSocialSecurityTable,
} from "./social-security-parsers";
import {
  decodeAliyunRecognizeTableOcrResponse,
  type SocialSecurityOCRCell,
  type SocialSecurityOCRResult,
  type SocialSecurityOCRTable,
} from "./social-security-table";

const cell = (
  text: string,
  row: number,
  column: number,
  confidence = 0.9,
): SocialSecurityOCRCell => ({
  id: `${row}-${column}-${text}`,
  rawText: text,
  text,
  row,
  column,
  rowSpan: 1,
  columnSpan: 1,
  confidence,
  bbox: null,
  polygon: null,
});

const table = (
  id: string,
  cells: SocialSecurityOCRCell[],
  page = 1,
): SocialSecurityOCRTable => ({
  id,
  page,
  cells,
  confidence: 0.9,
  provider: "mock",
  providerVersion: "1",
  ocrVersion: "test-v1",
  contentHash: `page-${page}-hash`,
  rawProviderResponseRef: "request-1",
});

const ocr = (
  rawText: string,
  tables: SocialSecurityOCRTable[],
): SocialSecurityOCRResult => ({
  page: 1,
  rawText,
  tables,
  requestId: "request-1",
  provider: "mock",
  providerVersion: "1",
  apiType: "TABLE",
  ocrVersion: "test-v1",
  contentHash: "page-hash",
  rawProviderResponseRef: "request-1",
});

describe("Aliyun RecognizeTableOcr decoder", () => {
  it("decodes the SDK envelope, topology, text, confidence, and request id", () => {
    const response = {
      body: {
        requestId: "aliyun-42",
        data: JSON.stringify({
          prism_wordsInfo: [
            { tableId: 7, tableCellId: 10, word: "单位名称", prob: 98 },
          ],
          prism_tablesInfo: [
            {
              tableId: 7,
              cellInfos: [
                {
                  tableCellId: 10,
                  word: "单位名称",
                  xsc: 1,
                  xec: 2,
                  ysc: 3,
                  yec: 4,
                  pos: [
                    { x: 10, y: 20 },
                    { x: 110, y: 20 },
                    { x: 110, y: 50 },
                    { x: 10, y: 50 },
                  ],
                },
              ],
            },
          ],
        }),
      },
    };

    expect(decodeAliyunRecognizeTableOcrResponse(response, 2)).toEqual({
      page: 2,
      rawText: "单位名称",
      requestId: "aliyun-42",
      provider: "aliyun",
      providerVersion: "ocr-api20210707",
      apiType: "TABLE",
      ocrVersion: "aliyun-table-v1",
      contentHash: "",
      rawProviderResponseRef: "aliyun-42",
      tables: [
        {
          id: "7",
          page: 2,
          confidence: 0.98,
          provider: "aliyun",
          providerVersion: "ocr-api20210707",
          ocrVersion: "aliyun-table-v1",
          contentHash: "",
          rawProviderResponseRef: "aliyun-42",
          cells: [
            {
              text: "单位名称",
              rawText: "单位名称",
              id: "10",
              row: 3,
              column: 1,
              rowSpan: 2,
              columnSpan: 2,
              confidence: 0.98,
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
    });
  });
});

describe("Shenzhen social-security parser", () => {
  const input = ocr("深圳市社会保险 单位编号 缴费年月", [
    table("units", [
      cell("单位编号", 0, 0),
      cell("单位名称", 0, 1),
      cell("001", 1, 0),
      cell("深圳 OI 科技有限公司", 1, 1),
    ]),
    table("months", [
      cell("单位编号", 0, 0),
      cell("缴费年月", 0, 1),
      cell("OO1", 1, 0),
      cell("2O23年O1月", 1, 1),
      cell("001", 2, 0),
      cell("2023-02", 2, 1),
      cell("001", 3, 0),
      cell("2023-O4", 3, 1),
    ], 2),
  ]);

  it("maps unit ids and preserves non-continuous paid months for gap detection", () => {
    expect(detectSocialSecurityTemplate(input)).toBe("SHENZHEN");
    const result = new ShenzhenSocialSecurityParser().parse(input, "深圳社保.pdf");

    expect(result).toMatchObject({
      status: "parsed",
      autoVerifiable: true,
      template: "SHENZHEN",
    });
    expect(result.records).toHaveLength(1);
    expect(result.records[0]).toMatchObject({
      companyRaw: "深圳 OI 科技有限公司",
      companyNormalized: "深圳 OI 科技有限公司",
      startMonth: "2023-01",
      endMonth: "2023-04",
      paidMonths: ["2023-01", "2023-02", "2023-04"],
      pensionMonths: null,
      source: {
        file: "深圳社保.pdf",
        page: 1,
        confidence: 0.9,
      },
    });
    expect(result.records[0].source.quote).toContain("深圳 OI 科技有限公司");
    expect(result.rawRecords[0]).toMatchObject({
      unitCode: { value: "001" },
      companyRaw: { value: "深圳 OI 科技有限公司" },
      paidMonths: ["2023-01", "2023-02", "2023-04"],
      derived: {
        paidMonthCount: 3,
        gapMonths: ["2023-03"],
        periods: [
          { startMonth: "2023-01", endMonth: "2023-02", paidMonthCount: 2 },
          { startMonth: "2023-04", endMonth: "2023-04", paidMonthCount: 1 },
        ],
      },
    });
    expect(result.rawRecords[0].unitCode?.evidenceIds).toHaveLength(1);
    expect(result.rawRecords[0].companyRaw.evidenceIds).toHaveLength(1);
    expect(result.rawRecords[0].monthlyRecords[0]).toMatchObject({
      unitCode: {
        rawValue: "OO1",
        value: "001",
        transformations: [
          {
            type: "CONTROLLED_NUMERIC_OCR_CORRECTION",
            from: "OO1",
            to: "001",
          },
        ],
      },
      companyRaw: {
        rawValue: "深圳 OI 科技有限公司",
        value: "深圳 OI 科技有限公司",
        transformations: [],
      },
    });
  });

  it("derives one period from consecutive monthly facts", () => {
    const consecutive = ocr("深圳市社会保险 单位编号 缴费年月", [
      table("units", [
        cell("单位编号", 0, 0),
        cell("单位名称", 0, 1),
        cell("30078648", 1, 0),
        cell("深圳市友点科技有限公司", 1, 1),
      ]),
      table("months", [
        cell("单位编号", 0, 0),
        cell("缴费年月", 0, 1),
        cell("30078648", 1, 0),
        cell("2022-08", 1, 1),
        cell("30078648", 2, 0),
        cell("2022-09", 2, 1),
        cell("30078648", 3, 0),
        cell("2022-10", 3, 1),
      ]),
    ]);

    const result = new ShenzhenSocialSecurityParser().parse(
      consecutive,
      "shenzhen.pdf",
    );
    expect(result.rawRecords[0]).toMatchObject({
      unitCode: { rawValue: "30078648", value: "30078648" },
      companyRaw: {
        rawValue: "深圳市友点科技有限公司",
        value: "深圳市友点科技有限公司",
      },
      paidMonths: ["2022-08", "2022-09", "2022-10"],
      derived: {
        paidMonthCount: 3,
        gapMonths: [],
        periods: [
          {
            startMonth: "2022-08",
            endMonth: "2022-10",
            paidMonthCount: 3,
          },
        ],
      },
    });
  });

  it("rejects duplicate table coordinates instead of trusting cell order", () => {
    const invalid = ocr("深圳市社会保险 单位编号 缴费年月", [
      table("invalid", [
        cell("单位编号", 0, 0),
        cell("缴费年月", 0, 0),
      ]),
    ]);
    expect(
      new ShenzhenSocialSecurityParser().parse(invalid, "invalid.pdf"),
    ).toMatchObject({
      status: "manual-required",
      autoVerifiable: false,
      rawRecords: [],
      reasons: ["TABLE_CELL_ORDER_CONFLICT"],
    });
  });
});

describe("Guangdong social-security parser", () => {
  const input = ocr("广东省社会保险参保证明", [
    table("gd", [
      cell("单位名称", 0, 0),
      cell("开始年月", 0, 1),
      cell("终止年月", 0, 2),
      cell("养老保险", 0, 3),
      cell("工伤保险", 0, 4),
      cell("失业保险", 0, 5),
      cell("广州 OIl 服务有限公司", 1, 0, 0.96),
      cell("2O22年I2月", 1, 1, 0.96),
      cell("2023-O2", 1, 2, 0.96),
      cell("O3个月", 1, 3, 0.96),
      cell("3", 1, 4, 0.96),
      cell("O2", 1, 5, 0.96),
    ]),
  ]);

  it("uses header columns and limits OCR substitutions to numeric fields", () => {
    expect(detectSocialSecurityTemplate(input)).toBe("GUANGDONG");
    const result = new GuangdongSocialSecurityParser().parse({
      ocr: input,
      sourceFile: "广东.png",
    });
    expect(result).toMatchObject({
      status: "manual-required",
      autoVerifiable: false,
    });

    expect(result.records).toEqual([
      expect.objectContaining({
        companyRaw: "广州 OIl 服务有限公司",
        companyNormalized: "广州 OIl 服务有限公司",
        startMonth: "2022-12",
        endMonth: "2023-02",
        paidMonths: null,
        pensionMonths: 3,
        injuryMonths: 3,
        unemploymentMonths: 2,
        source: expect.objectContaining({
          file: "广东.png",
          page: 1,
          confidence: 0.96,
        }),
      }),
    ]);
    expect(result.rawRecords[0]).toMatchObject({
      paidMonths: null,
      derivedPaidMonths: null,
      rawPeriod: {
        value: "2022-12/2023-02",
      },
      warnings: ["MONTH_DETAIL_UNAVAILABLE"],
      status: "MANUAL_REVIEW_REQUIRED",
    });
  });
});

describe("unknown templates", () => {
  it("never emits automatically verifiable records", () => {
    const input = ocr("某地参保证明 自由格式", []);
    const direct = new GenericSocialSecurityParser().parse(input, "unknown.pdf");
    const selected = parseSocialSecurityTable({
      ocr: input,
      sourceFile: "unknown.pdf",
    });

    expect(detectSocialSecurityTemplate(input)).toBe("UNKNOWN");
    expect(direct).toMatchObject({
      status: "manual-required",
      autoVerifiable: false,
      records: [],
      rawRecords: [],
    });
    expect(selected).toEqual(direct);
  });

  it("keeps explicit generic columns uncertain and does not guess fields", () => {
    const input = ocr("单位名称 缴费月份", [
      table("generic", [
        cell("单位名称", 0, 0),
        cell("缴费月份", 0, 1),
        cell("某科技公司", 1, 0),
        cell("2024-01", 1, 1),
      ]),
    ]);
    const result = parseSocialSecurityTable({
      ocr: input,
      sourceFile: "generic.pdf",
    });
    expect(result).toMatchObject({
      template: "GENERIC",
      status: "manual-required",
      autoVerifiable: false,
      records: [],
      rawRecords: [
        {
          companyRaw: { value: "某科技公司" },
          paidMonths: ["2024-01"],
          status: "UNCERTAIN",
          warnings: ["GENERIC_TEMPLATE_REQUIRES_REVIEW"],
        },
      ],
    });
  });
});
