import { describe, expect, it } from "vitest";
import {
  GenericSocialSecurityParser,
  GuangdongSocialSecurityParser,
  ShenzhenSocialSecurityParser,
  detectSocialSecurityTemplate,
  parseSocialSecurityTable,
} from "./social-security-parsers";
import {
  buildSocialSecurityCellEvidence,
} from "./social-security-evidence";
import {
  validateSocialEvidence,
  validateSocialSecurityRawRecords,
} from "./evidence-validator";
import type {
  DocumentPage,
  SocialSecurityEvidenceRecord,
} from "./schemas";
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

describe("template hints and generic extraction", () => {
  it("fails closed when OCR contains no structured facts, not merely because template is unknown", () => {
    const input = ocr("某地参保证明 自由格式", []);
    const direct = new GenericSocialSecurityParser().parse(input, "unknown.pdf");
    const selected = parseSocialSecurityTable({
      ocr: input,
      sourceFile: "unknown.pdf",
    });

    expect(detectSocialSecurityTemplate(input)).toBe("UNKNOWN");
    expect(direct).toMatchObject({
      template: "GENERIC",
      status: "manual-required",
      autoVerifiable: false,
      records: [],
      rawRecords: [],
      reasons: ["PARSER_FAILED"],
    });
    expect(selected).toEqual(direct);
  });

  it("extracts explicit company and monthly cells without a province parser", () => {
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
      status: "parsed",
      autoVerifiable: true,
      records: [
        {
          companyRaw: "某科技公司",
          paidMonths: ["2024-01"],
        },
      ],
      rawRecords: [
        {
          companyRaw: { value: "某科技公司" },
          paidMonths: ["2024-01"],
          status: "PARSED",
          warnings: [],
        },
      ],
    });
  });
});

describe("[anonymized real-layout regression] Generic Structured Extractor", () => {
  it("extracts Jiangsu-style year/month rows and safely marks split date cells for review", () => {
    const input = ocr("社会保险权益记录单 年 月 单位全称", [
      table("jiangsu-layout", [
        cell("年", 0, 0),
        cell("月", 0, 1),
        cell("单位全称", 0, 2),
        cell("2020", 1, 0),
        cell("07", 1, 1),
        cell("匿名数据技术有限公司", 1, 2),
        cell("2020", 2, 0),
        cell("08", 2, 1),
        cell("匿名数据技术有限公司", 2, 2),
      ]),
    ]);

    const result = parseSocialSecurityTable({
      ocr: input,
      sourceFile: "Candidate-03-jiangsu.pdf",
      documentId: "candidate-03-jiangsu",
    });

    expect(result.records).toMatchObject([
      {
        companyRaw: "匿名数据技术有限公司",
        startMonth: "2020-07",
        endMonth: "2020-08",
        paidMonths: ["2020-07", "2020-08"],
      },
    ]);
    expect(result).toMatchObject({
      template: "GENERIC",
      status: "manual-required",
      autoVerifiable: false,
    });
    const validation = validateSocialSecurityRawRecords(
      result.rawRecords,
      buildSocialSecurityCellEvidence("candidate-03-jiangsu", input),
    );
    expect(validation.automaticEligible).toBe(false);
  });

  it("extracts Hubei-style left/right monthly columns by nearest company cell", () => {
    const input = ocr("近36个月参保缴费情况 记录月份 单位名称", [
      table("hubei-layout", [
        cell("记录月份", 0, 0),
        cell("单位名称", 0, 1),
        cell("记录月份", 0, 4),
        cell("单位名称", 0, 5),
        cell("202310", 1, 0),
        cell("匿名甲科技有限公司", 1, 1),
        cell("202208", 1, 4),
        cell("匿名乙科技有限公司", 1, 5),
        cell("202309", 2, 0),
        cell("匿名甲科技有限公司", 2, 1),
        cell("202207", 2, 4),
        cell("匿名乙科技有限公司", 2, 5),
      ]),
    ]);

    const result = parseSocialSecurityTable({
      ocr: input,
      sourceFile: "Candidate-03-hubei.pdf",
      documentId: "candidate-03-hubei",
    });

    expect(result.autoVerifiable).toBe(true);
    expect(result.records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          companyRaw: "匿名甲科技有限公司",
          paidMonths: ["2023-09", "2023-10"],
        }),
        expect.objectContaining({
          companyRaw: "匿名乙科技有限公司",
          paidMonths: ["2022-07", "2022-08"],
        }),
      ]),
    );
    const validation = validateSocialSecurityRawRecords(
      result.rawRecords,
      buildSocialSecurityCellEvidence("candidate-03-hubei", input),
    );
    expect(validation).toMatchObject({
      automaticEligible: true,
      validationStatus: "VALIDATED",
    });
  });

  it("keeps endpoint-only material as a span with unknown paid months", () => {
    const input = ocr("参保起止时间 单位 养老 工伤 失业", [
      table("guangdong-layout", [
        cell("参保起止时间", 0, 0),
        cell("单位", 0, 2),
        cell("202212", 1, 0),
        cell("202302", 1, 1),
        cell("匿名人力资源有限公司", 1, 2),
      ]),
    ]);

    const result = parseSocialSecurityTable({
      ocr: input,
      sourceFile: "Candidate-02-guangdong.pdf",
      documentId: "candidate-02-guangdong",
    });

    expect(result.records).toMatchObject([
      {
        companyRaw: "匿名人力资源有限公司",
        startMonth: "2022-12",
        endMonth: "2023-02",
        paidMonths: null,
      },
    ]);
    expect(result).toMatchObject({
      status: "parsed",
      autoVerifiable: true,
    });
    expect(result.rawRecords[0]).toMatchObject({
      derivedPaidMonths: null,
      intervalEvidence: null,
      status: "PARSED",
      warnings: [],
      derived: {
        startMonth: "2022-12",
        endMonth: "2023-02",
        paidMonthCount: null,
        timeSpanMonths: 3,
      },
    });
    const validation = validateSocialSecurityRawRecords(
      result.rawRecords,
      buildSocialSecurityCellEvidence("candidate-02-guangdong", input),
    );
    expect(validation.automaticEligible).toBe(false);
    expect(validation.validationStatus).not.toBe("VALIDATED");
  });
});

describe("interval and stated month count evidence", () => {
  function continuousIntervalInput(statedMonths = 29) {
    return ocr("缴费区间 2022-12 ～ 2025-04 累计29个月", [
      table("continuous-interval", [
        cell("缴费区间", 0, 0, 0.97),
        cell("单位名称", 0, 2, 0.97),
        cell("累计缴费月数", 0, 3, 0.97),
        cell("2022-12 ～ 2025-04", 1, 0, 0.97),
        cell("原文科技有限公司", 1, 2, 0.97),
        cell(`累计${statedMonths}个月`, 1, 3, 0.97),
      ]),
    ]);
  }

  it("expands an interval with a matching stated count without continuity keywords", () => {
    const input = continuousIntervalInput();
    const documentId = "continuous-29";
    const evidence = buildSocialSecurityCellEvidence(documentId, input);
    const result = parseSocialSecurityTable({
      ocr: input,
      sourceFile: "continuous.pdf",
      documentId,
      cellEvidence: evidence,
    });
    const record = result.rawRecords[0];
    const validation = validateSocialSecurityRawRecords(
      result.rawRecords,
      evidence,
    );

    expect(result).toMatchObject({
      status: "parsed",
      autoVerifiable: true,
      records: [
        {
          companyRaw: "原文科技有限公司",
          startMonth: "2022-12",
          endMonth: "2025-04",
        },
      ],
    });
    expect(record.paidMonths).toHaveLength(29);
    expect(record.paidMonths).toEqual([
      "2022-12",
      "2023-01",
      "2023-02",
      "2023-03",
      "2023-04",
      "2023-05",
      "2023-06",
      "2023-07",
      "2023-08",
      "2023-09",
      "2023-10",
      "2023-11",
      "2023-12",
      "2024-01",
      "2024-02",
      "2024-03",
      "2024-04",
      "2024-05",
      "2024-06",
      "2024-07",
      "2024-08",
      "2024-09",
      "2024-10",
      "2024-11",
      "2024-12",
      "2025-01",
      "2025-02",
      "2025-03",
      "2025-04",
    ]);
    expect(record.derived).toMatchObject({
      paidMonthCount: 29,
      derivedPaidMonthCount: 29,
      statedPaidMonthCount: 29,
      paidYears: 2,
      paidRemainingMonths: 5,
      paidDuration: "2年5个月",
      timeSpanMonths: 29,
      monthCountCrosscheck: "PASS",
      gapMonths: [],
    });
    expect(record.paidMonthEvidence).toHaveLength(29);
    expect(record.paidMonthEvidence[1]).toMatchObject({
      month: "2023-01",
      status: "DERIVED_FROM_VALIDATED_INTERVAL",
      evidenceIds: [],
      derivedFrom: {
        startMonth: { value: "2022-12", evidenceIds: [expect.any(String)] },
        endMonth: { value: "2025-04", evidenceIds: [expect.any(String)] },
        statedPaidMonthCount: {
          value: 29,
          evidenceIds: [expect.any(String)],
        },
      },
    });
    expect(record.monthlyRecords).toEqual([]);
    expect(record.companyRaw).toMatchObject({
      rawValue: "原文科技有限公司",
      value: "原文科技有限公司",
      transformations: [],
    });
    expect(validation).toMatchObject({
      validationStatus: "VALIDATED",
      automaticEligible: true,
      issues: [],
    });

    const source = result.records[0].source;
    const fieldBase = {
      status: "verified" as const,
      sourceFile: source.file,
      sourcePage: source.page,
      sourceQuote: source.quote,
      extractionMethod: "table_ocr" as const,
      confidence: source.confidence!,
    };
    const converted: SocialSecurityEvidenceRecord = {
      companyRaw: { ...fieldBase, value: "原文科技有限公司" },
      companyNormalized: "原文科技有限公司",
      startMonth: { ...fieldBase, value: "2022-12" },
      endMonth: { ...fieldBase, value: "2025-04" },
      paidMonths: { ...fieldBase, value: record.paidMonths },
      statedPaidMonthCount: { ...fieldBase, value: 29 },
      pensionMonths: { ...fieldBase, value: 29 },
      injuryMonths: { ...fieldBase, value: 29 },
      unemploymentMonths: { ...fieldBase, value: 29 },
      personalInsurance: false,
      sourceFile: source.file,
      sourcePage: source.page,
      sourceEvidence: [source.quote],
      template: "generic",
      warnings: [],
    };
    const documentPage: DocumentPage = {
      page: source.page,
      sourceFile: source.file,
      pdfText: null,
      ocrText: source.quote,
      selectedText: source.quote,
      extractionMethod: "ocr",
      qualityScore: 97,
      ocrConfidence: 0.97,
      warnings: [],
    };
    expect(validateSocialEvidence([converted], [documentPage])).toMatchObject({
      validationStatus: "VALIDATED",
      automaticEligible: true,
      issues: [],
    });

    const lowEndMonth = structuredClone(converted);
    lowEndMonth.endMonth.confidence = 0.2;
    const fieldLevel = validateSocialEvidence([lowEndMonth], [documentPage]);
    expect(fieldLevel.value[0]).toMatchObject({
      companyRaw: { status: "verified" },
      startMonth: { status: "verified" },
      endMonth: { status: "uncertain" },
      paidMonths: { status: "verified" },
    });
    expect(fieldLevel.issues).toEqual([
      expect.objectContaining({
        code: "OCR_CONFIDENCE_LOW",
        field: "records.0.endMonth",
      }),
    ]);
  });

  it("requires manual review when stated and derived month counts differ", () => {
    const input = continuousIntervalInput(28);
    const documentId = "continuous-count-mismatch";
    const evidence = buildSocialSecurityCellEvidence(documentId, input);
    const result = parseSocialSecurityTable({
      ocr: input,
      sourceFile: "count-mismatch.pdf",
      documentId,
      cellEvidence: evidence,
    });
    const validation = validateSocialSecurityRawRecords(
      result.rawRecords,
      evidence,
    );

    expect(result.rawRecords[0]).toMatchObject({
      status: "MANUAL_REVIEW_REQUIRED",
      warnings: ["MONTH_COUNT_MISMATCH"],
      derived: {
        paidMonthCount: null,
        statedPaidMonthCount: 28,
        timeSpanMonths: 29,
        monthCountCrosscheck: "MISMATCH",
      },
    });
    expect(validation.automaticEligible).toBe(false);
    expect(validation.issues).toContainEqual(
      expect.objectContaining({
        code: "DERIVATION_MISMATCH",
        field: "records.0.statedPaidMonthCount",
      }),
    );
  });

  it("does not create derived months without both endpoint evidence references", () => {
    const input = continuousIntervalInput();
    const documentId = "continuous-missing-start";
    const evidence = buildSocialSecurityCellEvidence(documentId, input).filter(
      (entry) => !entry.rawValue.includes("2022-12"),
    );
    const result = parseSocialSecurityTable({
      ocr: input,
      sourceFile: "missing-start.pdf",
      documentId,
      cellEvidence: evidence,
    });

    expect(result.rawRecords[0]).toMatchObject({
      paidMonths: null,
      derivedPaidMonths: null,
      paidMonthEvidence: [],
      intervalEvidence: null,
      status: "MANUAL_REVIEW_REQUIRED",
    });
    expect(result.autoVerifiable).toBe(false);
  });

  it("keeps same-month companies separate and marks the global overlap", () => {
    const input = ocr("缴费月份 单位名称", [
      table("same-month-companies", [
        cell("缴费月份", 0, 0),
        cell("单位名称", 0, 1),
        cell("2023-01", 1, 0),
        cell("A科技有限公司", 1, 1),
        cell("2023-01", 2, 0),
        cell("B服务有限公司", 2, 1),
      ]),
    ]);
    const result = parseSocialSecurityTable({
      ocr: input,
      sourceFile: "same-month.pdf",
      documentId: "same-month-companies",
    });

    expect(result.sameMonthMultiCompany).toBe(true);
    expect(result.records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          companyRaw: "A科技有限公司",
          paidMonths: ["2023-01"],
        }),
        expect.objectContaining({
          companyRaw: "B服务有限公司",
          paidMonths: ["2023-01"],
        }),
      ]),
    );
    expect(result.rawRecords).toHaveLength(2);
    expect(
      result.rawRecords.every((record) =>
        record.paidMonthEvidence.every(
          (month) =>
            month.status === "EXTRACTED" &&
            month.evidenceIds.length === 1,
        ),
      ),
    ).toBe(true);
  });
});
