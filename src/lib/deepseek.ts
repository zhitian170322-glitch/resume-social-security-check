import { z } from "zod";
import {
  ResumeExtractionSchema,
  SocialSecurityExtractionSchema,
  type ResumeExtraction,
  type SocialSecurityExtraction,
} from "./schemas";
import { config } from "./config";

export class AIParseError extends Error {
  readonly code = "AI_PARSE_FAILED";
}

type ChatMessage = { role: "system" | "user"; content: string };

async function requestJSON(messages: ChatMessage[]) {
  if (!config.DEEPSEEK_API_KEY) throw new AIParseError("DeepSeek API Key 未配置");
  const response = await fetch(`${config.DEEPSEEK_BASE_URL}/chat/completions`, {
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
