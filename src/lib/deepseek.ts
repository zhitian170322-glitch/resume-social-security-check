import { z } from "zod";
import {
  ResumeExtractionSchema,
  ResumeEvidenceExtractionSchema,
  SocialSecurityExtractionSchema,
  type ResumeExtraction,
  type ResumeEvidenceExtraction,
  type SocialSecurityExtraction,
  type DocumentPage,
} from "./schemas";
import { config } from "./config";

export class AIParseError extends Error {
  readonly code = "AI_PARSE_FAILED";
}

type ChatMessage = { role: "system" | "user"; content: string };
export type DeepSeekCallMetric = {
  durationMs: number;
  httpStatus?: number;
  errorCode?: string;
};

async function requestJSON(
  messages: ChatMessage[],
  onCall?: (metric: DeepSeekCallMetric) => void,
) {
  if (!config.DEEPSEEK_API_KEY) throw new AIParseError("DeepSeek API Key 未配置");
  const started = Date.now();
  let response: Response;
  try {
    response = await fetch(`${config.DEEPSEEK_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.DEEPSEEK_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: config.DEEPSEEK_MODEL,
        messages,
        response_format: { type: "json_object" },
        temperature: 0,
      }),
      signal: AbortSignal.timeout(90_000),
    });
  } catch (error) {
    onCall?.({ durationMs: Date.now() - started, errorCode: "DEEPSEEK_REQUEST_FAILED" });
    throw error;
  }
  onCall?.({
    durationMs: Date.now() - started,
    httpStatus: response.status,
    errorCode: response.ok ? undefined : "DEEPSEEK_HTTP_ERROR",
  });
  if (!response.ok) throw new AIParseError(`DeepSeek 请求失败 (${response.status})`);
  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new AIParseError("DeepSeek 未返回结构化内容");
  return content;
}

async function parseWithRetry<T>(
  schema: z.ZodType<T>,
  system: string,
  sourceText: string,
  onCall?: (metric: DeepSeekCallMetric) => void,
): Promise<T> {
  const messages: ChatMessage[] = [
    { role: "system", content: system },
    { role: "user", content: sourceText },
  ];
  let invalid = "";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const content = await requestJSON(
        attempt === 0
          ? messages
          : [
              ...messages,
              {
                role: "user",
                content: `上次输出未通过固定 Schema。仅修复为合法 JSON，不得推断或改写原文：${invalid}`,
              },
            ],
        onCall,
      );
      invalid = content.slice(0, 4000);
      return schema.parse(JSON.parse(content));
    } catch (error) {
      if (attempt === 1) {
        throw error instanceof AIParseError
          ? error
          : new AIParseError("DeepSeek JSON 两次均未通过 Schema 验证");
      }
    }
  }
  throw new AIParseError("DeepSeek 解析失败");
}

export function extractResume(text: string): Promise<ResumeExtraction> {
  return parseWithRetry(
    ResumeExtractionSchema,
    `从简历原文提取候选人姓名与工作经历。只输出 JSON：
{"candidateName":"姓名","resumeExperiences":[{"resumeDeclaredCompany":"原文公司全称","resumeDeclaredStartMonth":"YYYY-MM","resumeDeclaredEndMonth":"YYYY-MM"}]}
公司必须保留原文，不得标准化、补全、纠错或使用简称。月份统一为 YYYY-MM。`,
    text,
  );
}

export function extractResumeWithEvidence(
  pages: DocumentPage[],
  onCall?: (metric: DeepSeekCallMetric) => void,
): Promise<ResumeEvidenceExtraction> {
  const source = pages.map((page) => ({
    sourceFile: page.sourceFile,
    sourcePage: page.page,
    text: page.selectedText,
    extractionMethod: page.extractionMethod,
    warnings: page.warnings,
  }));
  return parseWithRetry(
    ResumeEvidenceExtractionSchema,
    `你只能定位简历工作经历候选区块并逐字结构化，不能创造事实。
只输出符合 Schema 的 JSON：
{
  "candidateName": EvidenceStringField,
  "experiences": [{
    "resumeCompany": EvidenceStringField,
    "resumeStartMonth": EvidenceMonthField,
    "resumeEndMonth": EvidenceMonthField,
    "warnings": []
  }]
}
EvidenceField 必须包含 value、status、sourceFile、sourcePage、sourceQuote、extractionMethod、confidence。
规则：
1. value 必须是 sourceQuote 中逐字存在的公司原文；禁止补全、纠错、扩写、合并或标准化公司名称。
2. 月份 value 只可把原文 YYYY.MM、YYYY-MM、YYYYMM、YYYY年MM月转换为 YYYY-MM。
3. 原文没有字段时 value=null、status="missing"；无法确定时 value=null、status="uncertain"。禁止猜测。
4. sourceQuote 必须逐字复制自指定页面，sourceFile/sourcePage 必须对应输入。
5. extractionMethod 固定为 "deepseek"，confidence 为 0 到 1。
6. 不计算任职月数，不判断公司关系，不判断核验结论。`,
    JSON.stringify(source),
    onCall,
  );
}

export function extractSocialSecurity(
  textByFile: Array<{ sourceFile: string; text: string }>,
): Promise<SocialSecurityExtraction> {
  return parseWithRetry(
    SocialSecurityExtractionSchema,
    `从社保材料提取缴费单位事实。只输出 JSON：
{"socialSecurityRecords":[{"verifiedSocialSecurityCompany":"原文单位","verifiedSocialSecurityStartMonth":"YYYY-MM","verifiedSocialSecurityEndMonth":"YYYY-MM","verifiedSocialSecurityMonths":0,"pensionMonths":0,"injuryMonths":0,"unemploymentMonths":0,"paidMonths":["YYYY-MM"],"sourceFile":"文件名","personalInsurance":false}]}
不得将公司简称补全或更正。paidMonths 仅列材料明确显示已缴费的月份；个人参保记录 company 使用材料原文并将 personalInsurance 设为 true。`,
    JSON.stringify(textByFile),
  );
}
