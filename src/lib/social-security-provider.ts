import { Readable } from "node:stream";
import OcrClient, {
  RecognizeGeneralRequest,
  RecognizeTableOcrRequest,
} from "@alicloud/ocr-api20210707";
import { Config as OpenApiConfig } from "@alicloud/openapi-client";
import { RuntimeOptions } from "@alicloud/tea-util";
import { config } from "./config";
import { db } from "./db";
import { contentHash } from "./stage-cache";
import {
  decodeAliyunRecognizeTableOcrResponse,
  type SocialSecurityOCRProvider,
  type SocialSecurityOCRResult,
} from "./social-security-table";

export type SocialSecurityOCRApiType = "GENERAL" | "TABLE";
export type SocialSecurityOCRErrorCode =
  | "OCR_GENERAL_FAILED"
  | "OCR_TABLE_FAILED"
  | "OCR_INVALID_IMAGE"
  | "OCR_TIMEOUT"
  | "OCR_SCHEMA_CHANGED";

export type SocialSecurityOCRMetric = {
  apiType: SocialSecurityOCRApiType;
  durationMs: number;
  httpStatus?: number;
  errorCode?: SocialSecurityOCRErrorCode;
  requestId?: string;
};
export type TableOCRMetric = SocialSecurityOCRMetric;

export class SocialSecurityOCRError extends Error {
  constructor(
    public readonly code: SocialSecurityOCRErrorCode,
    message: string,
    public readonly metadata: {
      httpStatus?: number;
      requestId?: string;
      apiType: SocialSecurityOCRApiType;
    },
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

interface AliyunOCRClient {
  recognizeGeneralWithOptions(
    request: RecognizeGeneralRequest,
    runtime: RuntimeOptions,
  ): Promise<unknown>;
  recognizeTableOcrWithOptions(
    request: RecognizeTableOcrRequest,
    runtime: RuntimeOptions,
  ): Promise<unknown>;
}

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === "object"
    ? (value as UnknownRecord)
    : null;
}

function parseAliyunData(response: unknown): {
  body: UnknownRecord;
  data: UnknownRecord;
  requestId: string | null;
  statusCode?: number;
} {
  const envelope = asRecord(response) ?? {};
  const body = asRecord(envelope.body) ?? envelope;
  const rawData = body.data;
  if (rawData === undefined || rawData === null) {
    throw new SocialSecurityOCRError(
      "OCR_SCHEMA_CHANGED",
      "Aliyun OCR response does not contain data",
      {
        apiType: "GENERAL",
        httpStatus:
          typeof envelope.statusCode === "number"
            ? envelope.statusCode
            : undefined,
      },
    );
  }
  let data: UnknownRecord;
  try {
    data =
      typeof rawData === "string"
        ? (asRecord(JSON.parse(rawData)) ?? {})
        : (asRecord(rawData) ?? {});
  } catch (error) {
    throw new SocialSecurityOCRError(
      "OCR_SCHEMA_CHANGED",
      "Aliyun OCR data is not valid JSON",
      { apiType: "GENERAL" },
      { cause: error },
    );
  }
  const requestId = body.requestId ?? envelope.requestId;
  return {
    body,
    data,
    requestId:
      requestId === undefined || requestId === null ? null : String(requestId),
    statusCode:
      typeof envelope.statusCode === "number"
        ? envelope.statusCode
        : undefined,
  };
}

function generalText(data: UnknownRecord): string {
  if (typeof data.content === "string") return data.content;
  if (!Array.isArray(data.prism_wordsInfo)) return "";
  return data.prism_wordsInfo
    .map((word) => {
      const record = asRecord(word);
      return record?.word === undefined ? "" : String(record.word);
    })
    .filter(Boolean)
    .join("\n");
}

function classifyProviderError(
  error: unknown,
  apiType: SocialSecurityOCRApiType,
): SocialSecurityOCRError {
  if (error instanceof SocialSecurityOCRError) {
    return error.metadata.apiType === apiType
      ? error
      : new SocialSecurityOCRError(error.code, error.message, {
          ...error.metadata,
          apiType,
        });
  }
  const record = asRecord(error) ?? {};
  const rawCode = typeof record.code === "string" ? record.code : "";
  const message =
    error instanceof Error ? error.message : "Social-security OCR failed";
  const combined = `${rawCode} ${message}`.toLowerCase();
  const code: SocialSecurityOCRErrorCode =
    /timeout|timed out|etimedout/.test(combined)
      ? "OCR_TIMEOUT"
      : /invalid.*image|image.*invalid|unsupported.*image/.test(combined)
        ? "OCR_INVALID_IMAGE"
        : apiType === "TABLE"
          ? "OCR_TABLE_FAILED"
          : "OCR_GENERAL_FAILED";
  return new SocialSecurityOCRError(
    code,
    message,
    {
      apiType,
      httpStatus:
        typeof record.statusCode === "number" ? record.statusCode : undefined,
      requestId:
        typeof record.requestId === "string" ? record.requestId : undefined,
    },
    error instanceof Error ? { cause: error } : undefined,
  );
}

export class AliyunSocialSecurityOCRProvider implements SocialSecurityOCRProvider {
  readonly provider = "aliyun";
  readonly providerVersion = "ocr-api20210707";
  readonly ocrVersion = config.SOCIAL_SECURITY_OCR_VERSION;
  private readonly client: AliyunOCRClient;

  constructor(
    private readonly onCall?: (metric: SocialSecurityOCRMetric) => void,
    client?: AliyunOCRClient,
  ) {
    if (
      !client &&
      (!config.ALIYUN_ACCESS_KEY_ID || !config.ALIYUN_ACCESS_KEY_SECRET)
    ) {
      throw new Error("阿里云 OCR 凭证未配置");
    }
    this.client =
      client ??
      new OcrClient(
        new OpenApiConfig({
          accessKeyId: config.ALIYUN_ACCESS_KEY_ID,
          accessKeySecret: config.ALIYUN_ACCESS_KEY_SECRET,
          endpoint: "ocr-api.cn-hangzhou.aliyuncs.com",
        }),
      );
  }

  async recognizeGeneral(
    input: Buffer,
    _mimeType: string,
    page = 1,
  ): Promise<SocialSecurityOCRResult> {
    const started = Date.now();
    try {
      const response = await this.client.recognizeGeneralWithOptions(
        new RecognizeGeneralRequest({ body: Readable.from(input) }),
        new RuntimeOptions({ readTimeout: 60_000, connectTimeout: 10_000 }),
      );
      const decoded = parseAliyunData(response);
      const rawText = generalText(decoded.data);
      if (!rawText) {
        throw new SocialSecurityOCRError(
          "OCR_SCHEMA_CHANGED",
          "Aliyun General OCR returned no readable content",
          {
            apiType: "GENERAL",
            httpStatus: decoded.statusCode,
            requestId: decoded.requestId ?? undefined,
          },
        );
      }
      this.onCall?.({
        apiType: "GENERAL",
        durationMs: Date.now() - started,
        httpStatus: decoded.statusCode,
        requestId: decoded.requestId ?? undefined,
      });
      return {
        page,
        rawText,
        tables: [],
        requestId: decoded.requestId,
        provider: this.provider,
        providerVersion: this.providerVersion,
        apiType: "GENERAL",
        ocrVersion: this.ocrVersion,
        contentHash: contentHash(input),
        rawProviderResponseRef: decoded.requestId,
      };
    } catch (error) {
      const classified = classifyProviderError(error, "GENERAL");
      this.onCall?.({
        durationMs: Date.now() - started,
        ...classified.metadata,
        errorCode: classified.code,
      });
      throw classified;
    }
  }

  async recognizeTable(
    input: Buffer,
    _mimeType: string,
    page = 1,
  ): Promise<SocialSecurityOCRResult> {
    const started = Date.now();
    try {
      const response = await this.client.recognizeTableOcrWithOptions(
        new RecognizeTableOcrRequest({
          body: Readable.from(input),
          needRotate: true,
          lineLess: config.ALIYUN_TABLE_OCR_LINELESS,
          skipDetection: false,
          isHandWriting: "false",
        }),
        new RuntimeOptions({ readTimeout: 90_000, connectTimeout: 10_000 }),
      );
      parseAliyunData(response);
      const decoded = decodeAliyunRecognizeTableOcrResponse(response, page, {
        contentHash: contentHash(input),
        providerVersion: this.providerVersion,
        ocrVersion: this.ocrVersion,
      });
      this.onCall?.({
        apiType: "TABLE",
        durationMs: Date.now() - started,
        httpStatus: asRecord(response)?.statusCode as number | undefined,
        requestId: decoded.requestId ?? undefined,
      });
      return decoded;
    } catch (error) {
      const classified = classifyProviderError(error, "TABLE");
      this.onCall?.({
        durationMs: Date.now() - started,
        ...classified.metadata,
        errorCode: classified.code,
      });
      throw classified;
    }
  }
}

export interface OCRPageCacheStore {
  get(
    key: string,
  ): SocialSecurityOCRResult | null | Promise<SocialSecurityOCRResult | null>;
  set(
    key: string,
    identity: OCRPageCacheIdentity,
    value: SocialSecurityOCRResult,
  ): void | Promise<void>;
}

export interface OCRPageCacheIdentity {
  contentHash: string;
  pageNumber: number;
  provider: string;
  apiType: SocialSecurityOCRApiType;
  ocrVersion: string;
}

export function socialSecurityOCRCacheKey(identity: OCRPageCacheIdentity) {
  return contentHash(
    [
      identity.contentHash,
      String(identity.pageNumber),
      identity.provider,
      identity.apiType,
      identity.ocrVersion,
    ].join("\u001f"),
  );
}

export class DatabaseOCRPageCacheStore implements OCRPageCacheStore {
  get(key: string): SocialSecurityOCRResult | null {
    const row = db
      .prepare("SELECT payload_json FROM ocr_page_cache WHERE cache_key = ?")
      .get(key) as { payload_json: string } | undefined;
    if (!row) return null;
    db.prepare(
      "UPDATE ocr_page_cache SET last_used_at = ? WHERE cache_key = ?",
    ).run(new Date().toISOString(), key);
    return JSON.parse(row.payload_json) as SocialSecurityOCRResult;
  }

  set(
    key: string,
    identity: OCRPageCacheIdentity,
    value: SocialSecurityOCRResult,
  ) {
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO ocr_page_cache
        (cache_key, content_hash, page_number, provider, api_type, ocr_version,
         payload_json, created_at, last_used_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(cache_key) DO UPDATE SET
         payload_json = excluded.payload_json,
         last_used_at = excluded.last_used_at`,
    ).run(
      key,
      identity.contentHash,
      identity.pageNumber,
      identity.provider,
      identity.apiType,
      identity.ocrVersion,
      JSON.stringify(value),
      now,
      now,
    );
  }
}

export class CachedSocialSecurityOCRProvider
  implements SocialSecurityOCRProvider
{
  readonly provider: string;
  readonly providerVersion: string;
  readonly ocrVersion: string;

  constructor(
    private readonly delegate: SocialSecurityOCRProvider,
    private readonly cache: OCRPageCacheStore = new DatabaseOCRPageCacheStore(),
    private readonly onCacheHit?: (identity: OCRPageCacheIdentity) => void,
  ) {
    this.provider = delegate.provider;
    this.providerVersion = delegate.providerVersion;
    this.ocrVersion = delegate.ocrVersion;
  }

  recognizeGeneral(input: Buffer, mimeType: string, page = 1) {
    return this.recognize("GENERAL", input, mimeType, page);
  }

  recognizeTable(input: Buffer, mimeType: string, page = 1) {
    return this.recognize("TABLE", input, mimeType, page);
  }

  private async recognize(
    apiType: SocialSecurityOCRApiType,
    input: Buffer,
    mimeType: string,
    page: number,
  ) {
    const identity: OCRPageCacheIdentity = {
      contentHash: contentHash(input),
      pageNumber: page,
      provider: this.provider,
      apiType,
      ocrVersion: this.ocrVersion,
    };
    const key = socialSecurityOCRCacheKey(identity);
    const cached = await this.cache.get(key);
    if (cached) {
      this.onCacheHit?.(identity);
      return cached;
    }
    const result =
      apiType === "TABLE"
        ? await this.delegate.recognizeTable(input, mimeType, page)
        : await this.delegate.recognizeGeneral(input, mimeType, page);
    await this.cache.set(key, identity, result);
    return result;
  }
}
