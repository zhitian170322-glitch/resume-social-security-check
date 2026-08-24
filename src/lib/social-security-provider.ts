import { Readable } from "node:stream";
import OcrClient, { RecognizeTableOcrRequest } from "@alicloud/ocr-api20210707";
import { Config as OpenApiConfig } from "@alicloud/openapi-client";
import { RuntimeOptions } from "@alicloud/tea-util";
import { config } from "./config";
import {
  decodeAliyunRecognizeTableOcrResponse,
  type SocialSecurityOCRProvider,
  type SocialSecurityOCRResult,
} from "./social-security-table";

export type TableOCRMetric = {
  durationMs: number;
  httpStatus?: number;
  errorCode?: string;
  requestId?: string;
};

export class AliyunSocialSecurityOCRProvider implements SocialSecurityOCRProvider {
  private readonly client: OcrClient;

  constructor(private readonly onCall?: (metric: TableOCRMetric) => void) {
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

  async recognize(
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
      const decoded = decodeAliyunRecognizeTableOcrResponse(response, page);
      this.onCall?.({
        durationMs: Date.now() - started,
        httpStatus: response.statusCode,
        requestId: decoded.requestId ?? undefined,
      });
      return decoded;
    } catch (error) {
      const record =
        typeof error === "object" && error !== null
          ? (error as Record<string, unknown>)
          : {};
      this.onCall?.({
        durationMs: Date.now() - started,
        httpStatus: typeof record.statusCode === "number" ? record.statusCode : undefined,
        errorCode:
          typeof record.code === "string" ? record.code : "TABLE_OCR_FAILED",
        requestId:
          typeof record.requestId === "string" ? record.requestId : undefined,
      });
      throw error;
    }
  }
}
