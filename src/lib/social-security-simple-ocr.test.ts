import { describe, expect, it } from "vitest";
import { extractSocialRecords } from "./social-records";
import {
  AliyunSocialSecurityOCRProvider,
  recognizeSocialSecurityPageDualSource,
} from "./social-security-provider";
import type { SocialSecurityOCRResult } from "./social-security-table";

function ocrResult(
  apiType: "GENERAL" | "TABLE",
  rawText: string,
  tables: SocialSecurityOCRResult["tables"] = [],
): SocialSecurityOCRResult {
  return {
    page: 1,
    rawText,
    tables,
    requestId: `${apiType}-ok`,
    provider: "mock",
    providerVersion: "test",
    apiType,
    ocrVersion: "test",
    contentHash: "hash",
    rawProviderResponseRef: `${apiType}-ok`,
  };
}

describe("OCR schema must not stop the task", () => {
  it("continues when Table and General both return HTTP 200 with different legal shapes", async () => {
    const client = {
      async recognizeTableOcrWithOptions() {
        return {
          statusCode: 200,
          body: {
            requestId: "table-200",
            data: {
              prism_tablesInfo: [
                {
                  cellInfos: [
                    { ysc: 0, xsc: 0, word: "甲科技有限公司" },
                    { ysc: 0, xsc: 1, word: "2020-01" },
                    { ysc: 0, xsc: 2, word: "2021-05" },
                  ],
                },
              ],
            },
          },
        };
      },
      async recognizeGeneralWithOptions() {
        return {
          statusCode: 200,
          body: {
            requestId: "general-200",
            Data: JSON.stringify({
              wordsInfo: [{ text: "甲科技有限公司 2020年1月至2021年5月" }],
            }),
          },
        };
      },
    };
    const provider = new AliyunSocialSecurityOCRProvider(undefined, client);
    const table = await provider.recognizeTable(Buffer.from("img"), "image/png");
    const general = await provider.recognizeGeneral(Buffer.from("img"), "image/png");
    const outcome = await recognizeSocialSecurityPageDualSource({
      provider,
      data: Buffer.from("img"),
      mimeType: "image/png",
    });
    expect(table.rawText).toContain("甲科技有限公司");
    expect(general.rawText).toContain("甲科技有限公司");
    expect(outcome.selected.rawText).toContain("甲科技有限公司");
    expect(outcome.tableUsed).toBe(true);
    expect(outcome.generalUsed).toBe(true);
  });

  it("continues with Table text when General cannot be parsed", async () => {
    const client = {
      async recognizeTableOcrWithOptions() {
        return {
          statusCode: 200,
          body: {
            requestId: "table-only",
            data: { content: "乙科技有限公司 2021年6月" },
          },
        };
      },
      async recognizeGeneralWithOptions() {
        return { statusCode: 200, body: { requestId: "general-empty", payload: {} } };
      },
    };
    const provider = new AliyunSocialSecurityOCRProvider(undefined, client);
    const outcome = await recognizeSocialSecurityPageDualSource({
      provider,
      data: Buffer.from("img"),
      mimeType: "image/png",
    });
    expect(outcome.tableUsed).toBe(true);
    expect(outcome.generalUsed).toBe(false);
    expect(outcome.selected.rawText).toContain("乙科技有限公司");
    const records = extractSocialRecords({
      ocr: outcome.selected,
      sourceFile: "social.pdf",
    });
    expect(records.some((record) => record.companyRaw?.includes("乙科技"))).toBe(true);
  });

  it("continues with General text when Table fails", async () => {
    const client = {
      async recognizeTableOcrWithOptions() {
        throw Object.assign(new Error("table down"), { code: "InternalError" });
      },
      async recognizeGeneralWithOptions() {
        return {
          statusCode: 200,
          body: {
            requestId: "general-only",
            data: { prism_wordsInfo: [{ word: "丙科技有限公司 2022年3月" }] },
          },
        };
      },
    };
    const provider = new AliyunSocialSecurityOCRProvider(undefined, client);
    const outcome = await recognizeSocialSecurityPageDualSource({
      provider,
      data: Buffer.from("img"),
      mimeType: "image/png",
    });
    expect(outcome.tableUsed).toBe(false);
    expect(outcome.generalUsed).toBe(true);
    expect(outcome.selected.rawText).toContain("丙科技有限公司");
  });

  it("does not terminate the page when both OCR schemas are unknown", async () => {
    const client = {
      async recognizeTableOcrWithOptions() {
        return { statusCode: 200, body: { requestId: "t", foo: 1 } };
      },
      async recognizeGeneralWithOptions() {
        return { statusCode: 200, body: { requestId: "g", bar: 2 } };
      },
    };
    const provider = new AliyunSocialSecurityOCRProvider(undefined, client);
    const outcome = await recognizeSocialSecurityPageDualSource({
      provider,
      data: Buffer.from("img"),
      mimeType: "image/png",
    });
    expect(outcome.selected.rawText).toBe("");
    expect(outcome.selected.tables).toEqual([]);
  });

  it("extracts from rawText even when the OCR result has no tables", () => {
    const records = extractSocialRecords({
      sourceFile: "general-only.pdf",
      ocr: ocrResult("GENERAL", "丁科技有限公司 2019年12月 至 2021年4月"),
    });
    expect(records[0]?.companyRaw).toContain("丁科技有限公司");
    expect(records[0]?.startMonth).toBe("2019-12");
    expect(records[0]?.endMonth).toBe("2021-04");
  });
});
