import { Readable } from "node:stream";
import OcrClient, {
  RecognizeGeneralRequest,
  RecognizeTableOcrRequest,
} from "@alicloud/ocr-api20210707";
import { Config as OpenApiConfig } from "@alicloud/openapi-client";
import { RuntimeOptions } from "@alicloud/tea-util";
import { config } from "./config";
import { withOcrRetry } from "./ocr-runtime";
import { db } from "./db";
import { contentHash } from "./stage-cache";
import {
  adaptAliyunOcrResponse,
  describeOcrEnvelope,
  hasUsableOcrPage,
  mergeOcrPages,
  type OcrPage,
} from "./ocr-adapter";
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

export function hasUsableSocialSecurityTable(
  result: SocialSecurityOCRResult,
): boolean {
  return result.tables.some((table) => {
    const nonEmptyCells = table.cells.filter((cell) => cell.rawText.trim());
    const rowCount = new Set(nonEmptyCells.map((cell) => cell.row)).size;
    const columnCount = new Set(nonEmptyCells.map((cell) => cell.column)).size;
    return nonEmptyCells.length >= 2 && rowCount >= 1 && columnCount >= 2;
  });
}

function emptySocialSecurityResult(
  page: number,
  apiType: SocialSecurityOCRApiType,
  requestId: string | null = null,
): SocialSecurityOCRResult {
  return {
    page,
    rawText: "",
    tables: [],
    requestId,
    provider: "aliyun",
    providerVersion: "ocr-api20210707",
    apiType,
    ocrVersion: config.SOCIAL_SECURITY_OCR_VERSION,
    contentHash: "",
    rawProviderResponseRef: requestId,
  };
}

function ocrPageToResult(
  page: OcrPage,
  apiType: SocialSecurityOCRApiType,
  extra?: Partial<SocialSecurityOCRResult>,
): SocialSecurityOCRResult {
  return {
    page: page.page,
    rawText: page.rawText,
    tables: page.tables.map((table, index) => ({
      id: `adapted-${index}`,
      page: page.page,
      cells: table.cells.map((cell, cellIndex) => ({
        id: `${index}:${cellIndex}`,
        rawText: cell.text,
        text: cell.text,
        row: cell.row,
        column: cell.column,
        rowSpan: 1,
        columnSpan: 1,
        confidence: null,
        bbox: null,
        polygon: null,
      })),
      confidence: null,
      provider: extra?.provider ?? "aliyun",
      providerVersion: extra?.providerVersion ?? "ocr-api20210707",
      ocrVersion: extra?.ocrVersion ?? config.SOCIAL_SECURITY_OCR_VERSION,
      contentHash: extra?.contentHash ?? "",
      rawProviderResponseRef: page.requestId ?? null,
    })),
    requestId: page.requestId ?? null,
    provider: extra?.provider ?? "aliyun",
    providerVersion: extra?.providerVersion ?? "ocr-api20210707",
    apiType,
    ocrVersion: extra?.ocrVersion ?? config.SOCIAL_SECURITY_OCR_VERSION,
    contentHash: extra?.contentHash ?? "",
    rawProviderResponseRef: page.requestId ?? null,
  };
}

async function recognizeSafely(
  run: () => Promise<SocialSecurityOCRResult>,
): Promise<SocialSecurityOCRResult | null> {
  try {
    return await withOcrRetry(run);
  } catch {
    return null;
  }
}

/**
 * Dual-source OCR: Table and General are independent. Either usable source
 * is enough to continue. Schema differences never fail the page.
 */
export async function recognizeSocialSecurityPageDualSource(input: {
  provider: SocialSecurityOCRProvider;
  data: Buffer;
  mimeType: string;
  page?: number;
}): Promise<{
  selected: SocialSecurityOCRResult;
  attempts: SocialSecurityOCRResult[];
  fallbackUsed: boolean;
  tableUsed: boolean;
  generalUsed: boolean;
}> {
  const page = input.page ?? 1;
  const table = await recognizeSafely(() =>
    input.provider.recognizeTable(input.data, input.mimeType, page),
  );
  const general = await recognizeSafely(() =>
    input.provider.recognizeGeneral(input.data, input.mimeType, page),
  );
  const attempts = [table, general].filter(
    (result): result is SocialSecurityOCRResult => result !== null,
  );
  const tableUsable = Boolean(
    table && (hasUsableSocialSecurityTable(table) || table.rawText.trim()),
  );
  const generalUsable = Boolean(general?.rawText.trim());
  const mergedPage = mergeOcrPages(
    [
      table
        ? {
            page,
            rawText: table.rawText,
            tables: table.tables.map((item) => ({
              cells: item.cells.map((cell) => ({
                row: cell.row,
                column: cell.column,
                text: cell.text || cell.rawText,
              })),
            })),
            requestId: table.requestId ?? undefined,
          }
        : null,
      general
        ? {
            page,
            rawText: general.rawText,
            tables: [],
            requestId: general.requestId ?? undefined,
          }
        : null,
    ],
    page,
  );
  const selected = attempts.length
    ? {
        ...(table ?? general ?? emptySocialSecurityResult(page, "TABLE")),
        rawText: mergedPage.rawText,
        tables: tableUsable && table ? table.tables : (table?.tables ?? []),
        requestId: mergedPage.requestId ?? null,
        apiType: tableUsable ? ("TABLE" as const) : ("GENERAL" as const),
      }
    : emptySocialSecurityResult(page, "TABLE");
  return {
    selected,
    attempts: attempts.length ? attempts : [selected],
    fallbackUsed: !tableUsable && generalUsable,
    tableUsed: tableUsable,
    generalUsed: generalUsable,
  };
}

/**
 * @deprecated Dual-source recognition is the production path.
 * Kept so existing tests and caches can still call the old name.
 */
export async function recognizeSocialSecurityPageTableFirst(input: {
  provider: SocialSecurityOCRProvider;
  data: Buffer;
  mimeType: string;
  page?: number;
}) {
  return recognizeSocialSecurityPageDualSource(input);
}

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

function httpStatusOf(response: unknown): number | undefined {
  const envelope = asRecord(response);
  return typeof envelope?.statusCode === "number"
    ? envelope.statusCode
    : undefined;
}

function logUnknownOcrShape(
  response: unknown,
  apiType: SocialSecurityOCRApiType,
) {
  const note = describeOcrEnvelope(response);
  console.info(
    JSON.stringify({
      level: "info",
      at: new Date().toISOString(),
      stage: "OCR_ADAPTER",
      apiType,
      topLevelKeys: note.topLevelKeys,
      requestId: note.requestId ?? null,
    }),
  );
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
      const adapted = adaptAliyunOcrResponse(response, page);
      if (!hasUsableOcrPage(adapted)) {
        logUnknownOcrShape(response, "GENERAL");
      }
      this.onCall?.({
        apiType: "GENERAL",
        durationMs: Date.now() - started,
        httpStatus: httpStatusOf(response),
        requestId: adapted.requestId,
      });
      return ocrPageToResult(adapted, "GENERAL", {
        provider: this.provider,
        providerVersion: this.providerVersion,
        ocrVersion: this.ocrVersion,
        contentHash: contentHash(input),
      });
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
      const adapted = adaptAliyunOcrResponse(response, page);
      const decoded = decodeAliyunRecognizeTableOcrResponse(response, page, {
        contentHash: contentHash(input),
        providerVersion: this.providerVersion,
        ocrVersion: this.ocrVersion,
      });
      const rawText = decoded.rawText.trim() || adapted.rawText;
      const tables = decoded.tables.length
        ? decoded.tables
        : ocrPageToResult(adapted, "TABLE").tables;
      if (!rawText && !tables.length) {
        logUnknownOcrShape(response, "TABLE");
      }
      this.onCall?.({
        apiType: "TABLE",
        durationMs: Date.now() - started,
        httpStatus: httpStatusOf(response),
        requestId: decoded.requestId ?? adapted.requestId,
      });
      return {
        ...decoded,
        rawText,
        tables,
        requestId: decoded.requestId ?? adapted.requestId ?? null,
        rawProviderResponseRef:
          decoded.rawProviderResponseRef ?? adapted.requestId ?? null,
      };
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
