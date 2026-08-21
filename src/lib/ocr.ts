import { Readable } from "node:stream";
import { randomUUID } from "node:crypto";
import OcrClient, { RecognizeGeneralRequest } from "@alicloud/ocr-api20210707";
import { Config as OpenApiConfig } from "@alicloud/openapi-client";
import { RuntimeOptions } from "@alicloud/tea-util";
import { config } from "./config";
import { db } from "./db";

export type OCRResult = { text: string; raw: unknown };
export interface OCRProvider {
  recognize(input: Buffer, mimeType: string): Promise<OCRResult>;
}

export class MockOCRProvider implements OCRProvider {
  constructor(private readonly text = "模拟 OCR 识别文字") {}
  async recognize(): Promise<OCRResult> {
    return { text: this.text, raw: { mock: true } };
  }
}

export class OCRLimitError extends Error {
  constructor(
    public code: "OCR_CONFIRM_REQUIRED" | "OCR_ABSOLUTE_LIMIT",
    message: string,
  ) {
    super(message);
  }
}

export class AliyunOCRProvider implements OCRProvider {
  private readonly client: OcrClient;

  constructor() {
    if (!config.ALIYUN_ACCESS_KEY_ID || !config.ALIYUN_ACCESS_KEY_SECRET) {
      throw new Error("阿里云 OCR 凭证未配置");
    }
    this.client = new OcrClient(
      new OpenApiConfig({
        accessKeyId: config.ALIYUN_ACCESS_KEY_ID,
        accessKeySecret: config.ALIYUN_ACCESS_KEY_SECRET,
        endpoint: "ocr-api.cn-hangzhou.aliyuncs.com",
      }),
    );
  }

  async recognize(input: Buffer): Promise<OCRResult> {
    const request = new RecognizeGeneralRequest({ body: Readable.from(input) });
    const response = await this.client.recognizeGeneralWithOptions(
      request,
      new RuntimeOptions({ readTimeout: 60_000, connectTimeout: 10_000 }),
    );
    const raw = response.body?.data ? JSON.parse(response.body.data) : {};
    const text = extractAliyunText(raw);
    if (!text) throw new Error(response.body?.message || "OCR 未返回文字");
    return { text, raw };
  }
}

function extractAliyunText(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  if (typeof record.content === "string") return record.content;
  if (Array.isArray(record.prism_wordsInfo)) {
    return record.prism_wordsInfo
      .map((line) =>
        line && typeof line === "object" && "word" in line ? String(line.word) : "",
      )
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

export function currentMonthOCRUsage() {
  const start = new Date();
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);
  return (
    db
      .prepare("SELECT COUNT(*) AS count FROM ocr_calls WHERE created_at >= ?")
      .get(start.toISOString()) as { count: number }
  ).count;
}

export function assertOCRCapacity(
  estimatedCalls: number,
  paidOverride: boolean,
  usage = currentMonthOCRUsage(),
) {
  if (usage + estimatedCalls >= config.OCR_MONTHLY_ABSOLUTE_LIMIT) {
    throw new OCRLimitError("OCR_ABSOLUTE_LIMIT", "OCR 月度绝对熔断已触发");
  }
  if (
    usage + estimatedCalls >= config.OCR_MONTHLY_FREE_SAFE_LIMIT &&
    (!paidOverride || !config.OCR_ALLOW_PAID_OVERRIDE)
  ) {
    throw new OCRLimitError("OCR_CONFIRM_REQUIRED", "需要确认本任务使用付费 OCR");
  }
}

export function recordOCRCall(taskId: string, paidOverride: boolean) {
  db.prepare(
    `INSERT INTO ocr_calls
      (id, task_id, provider, api_type, created_at, paid_override, estimated_cost)
     VALUES (?, ?, 'aliyun', 'RecognizeGeneral', ?, ?, 0)`,
  ).run(randomUUID(), taskId, new Date().toISOString(), paidOverride ? 1 : 0);
}
