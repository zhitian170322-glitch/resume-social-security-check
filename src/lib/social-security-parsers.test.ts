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
  text,
  row,
  column,
  rowSpan: 1,
  columnSpan: 1,
  confidence,
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
});

const ocr = (
  rawText: string,
  tables: SocialSecurityOCRTable[],
): SocialSecurityOCRResult => ({
  page: 1,
  rawText,
  tables,
  requestId: "request-1",
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
      tables: [
        {
          id: "7",
          page: 2,
          confidence: 0.98,
          cells: [
            {
              text: "单位名称",
              row: 3,
              column: 1,
              rowSpan: 2,
              columnSpan: 2,
              confidence: 0.98,
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
    ]),
  ]);

  it("maps unit ids and preserves non-continuous paid months for gap detection", () => {
    expect(detectSocialSecurityTemplate(input)).toBe("shenzhen");
    const result = new ShenzhenSocialSecurityParser().parse(input, "深圳社保.pdf");

    expect(result).toMatchObject({
      status: "parsed",
      autoVerifiable: true,
      template: "shenzhen",
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
    expect(detectSocialSecurityTemplate(input)).toBe("guangdong");
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
        paidMonths: [],
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

    expect(detectSocialSecurityTemplate(input)).toBe("unknown");
    expect(direct).toMatchObject({
      status: "manual-required",
      autoVerifiable: false,
      records: [],
    });
    expect(selected).toEqual(direct);
  });
});
