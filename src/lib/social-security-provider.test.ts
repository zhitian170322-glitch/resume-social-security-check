import { describe, expect, it } from "vitest";
import {
  AliyunSocialSecurityOCRProvider,
  CachedSocialSecurityOCRProvider,
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
