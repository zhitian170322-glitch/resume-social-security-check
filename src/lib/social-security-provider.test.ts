import { describe, expect, it } from "vitest";
import {
  AliyunSocialSecurityOCRProvider,
  CachedSocialSecurityOCRProvider,
  recognizeSocialSecurityPageTableFirst,
  socialSecurityOCRCacheKey,
  type OCRPageCacheIdentity,
  type OCRPageCacheStore,
} from "./social-security-provider";
import type {
  SocialSecurityOCRProvider,
  SocialSecurityOCRResult,
} from "./social-security-table";

function result(
  apiType: "GENERAL" | "TABLE",
  page: number,
): SocialSecurityOCRResult {
  return {
    page,
    rawText: "识别结果",
    tables: [],
    requestId: `request-${page}`,
    provider: "mock-cloud",
    providerVersion: "2026-08",
    apiType,
    ocrVersion: "mock-v1",
    contentHash: "content",
    rawProviderResponseRef: `request-${page}`,
  };
}

class MemoryCache implements OCRPageCacheStore {
  values = new Map<string, SocialSecurityOCRResult>();
  get(key: string) {
    return this.values.get(key) ?? null;
  }
  set(
    key: string,
    _identity: OCRPageCacheIdentity,
    value: SocialSecurityOCRResult,
  ) {
    this.values.set(key, value);
  }
}

describe("social-security OCR provider", () => {
  it("routes every supported social-security page to Table OCR first", async () => {
    const calls: string[] = [];
    const tableResult: SocialSecurityOCRResult = {
      ...result("TABLE", 1),
      tables: [
        {
          id: "table",
          page: 1,
          cells: [
            {
              id: "company",
              rawText: "单位名称",
              text: "单位名称",
              row: 0,
              column: 0,
              rowSpan: 1,
              columnSpan: 1,
              confidence: 0.99,
              bbox: null,
              polygon: null,
            },
            {
              id: "month",
              rawText: "缴费月份",
              text: "缴费月份",
              row: 0,
              column: 1,
              rowSpan: 1,
              columnSpan: 1,
              confidence: 0.99,
              bbox: null,
              polygon: null,
            },
          ],
          confidence: 0.99,
          provider: "mock-cloud",
          providerVersion: "2026-08",
          ocrVersion: "mock-v1",
          contentHash: "content",
          rawProviderResponseRef: "request-1",
        },
      ],
    };
    const provider: SocialSecurityOCRProvider = {
      provider: "mock-cloud",
      providerVersion: "2026-08",
      ocrVersion: "mock-v1",
      async recognizeTable() {
        calls.push("TABLE");
        return tableResult;
      },
      async recognizeGeneral() {
        calls.push("GENERAL");
        return result("GENERAL", 1);
      },
    };

    const outcome = await recognizeSocialSecurityPageTableFirst({
      provider,
      data: Buffer.from("page"),
      mimeType: "image/png",
    });

    expect(calls).toEqual(["TABLE", "GENERAL"]);
    expect(outcome.tableUsed).toBe(true);
    expect(outcome.selected.apiType).toBe("TABLE");
    expect(outcome.fallbackUsed).toBe(false);
  });

  it("falls back to General OCR only when Table OCR has no usable table", async () => {
    const calls: string[] = [];
    const provider: SocialSecurityOCRProvider = {
      provider: "mock-cloud",
      providerVersion: "2026-08",
      ocrVersion: "mock-v1",
      async recognizeTable(_input, _mimeType, page = 1) {
        calls.push("TABLE");
        return { ...result("TABLE", page), rawText: "", tables: [] };
      },
      async recognizeGeneral(_input, _mimeType, page = 1) {
        calls.push("GENERAL");
        return result("GENERAL", page);
      },
    };

    const outcome = await recognizeSocialSecurityPageTableFirst({
      provider,
      data: Buffer.from("page"),
      mimeType: "image/jpeg",
      page: 2,
    });

    expect(calls).toEqual(["TABLE", "GENERAL"]);
    expect(outcome.selected.apiType).toBe("GENERAL");
    expect(outcome.fallbackUsed).toBe(true);
  });

  it("caches the same page and API type without a second paid call", async () => {
    let tableCalls = 0;
    const delegate: SocialSecurityOCRProvider = {
      provider: "mock-cloud",
      providerVersion: "2026-08",
      ocrVersion: "mock-v1",
      async recognizeGeneral(_input, _mimeType, page = 1) {
        return result("GENERAL", page);
      },
      async recognizeTable(_input, _mimeType, page = 1) {
        tableCalls += 1;
        return result("TABLE", page);
      },
    };
    const cache = new MemoryCache();
    const provider = new CachedSocialSecurityOCRProvider(delegate, cache);
    const image = Buffer.from("same-page");

    await provider.recognizeTable(image, "image/png", 1);
    await provider.recognizeTable(image, "image/png", 1);
    await provider.recognizeTable(image, "image/png", 2);

    expect(tableCalls).toBe(2);
    expect(cache.values.size).toBe(2);
    expect(
      socialSecurityOCRCacheKey({
        contentHash: "hash",
        pageNumber: 1,
        provider: "mock-cloud",
        apiType: "TABLE",
        ocrVersion: "mock-v1",
      }),
    ).not.toBe(
      socialSecurityOCRCacheKey({
        contentHash: "hash",
        pageNumber: 1,
        provider: "mock-cloud",
        apiType: "GENERAL",
        ocrVersion: "mock-v1",
      }),
    );
  });

  it("classifies provider timeout without retrying unrelated stages", async () => {
    const timeout = Object.assign(new Error("read timeout"), {
      code: "ETIMEDOUT",
      requestId: "timeout-request",
    });
    const client = {
      async recognizeGeneralWithOptions() {
        throw timeout;
      },
      async recognizeTableOcrWithOptions() {
        throw timeout;
      },
    };
    const provider = new AliyunSocialSecurityOCRProvider(undefined, client);

    await expect(
      provider.recognizeGeneral(Buffer.from("image"), "image/png", 3),
    ).rejects.toMatchObject({
      code: "OCR_TIMEOUT",
      metadata: {
        apiType: "GENERAL",
        requestId: "timeout-request",
      },
    });
  });
});
