import { z } from "zod";
import {
  ResumeExtractionSchema,
  ResumeEvidenceExtractionSchema,
  SocialSecurityExtractionSchema,
  type ResumeExtraction,
  type ResumeEvidenceExtraction,
  type SocialSecurityExtraction,
  type DocumentPage,
  type EvidenceMonthField,
  type EvidenceStringField,
  type ResumeFieldSourceCandidate,
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

const RAW_MONTH_PATTERN =
  /(?<!\d)\d{4}\s*(?:[.\-/年]\s*|(?=\d{2}(?:\D|$)))(?:0?[1-9]|1[0-2])\s*月?(?!\d)/g;
const PRESENT_PATTERN = /至今|目前|present/iu;

function normalizedMonth(raw: string, currentMonth: string) {
  if (PRESENT_PATTERN.test(raw)) return currentMonth;
  const match = raw
    .trim()
    .match(
      /(?<!\d)(\d{4})\s*(?:[.\-/年]\s*|(?=\d{2}(?:\D|$)))(0?[1-9]|1[0-2])\s*月?(?!\d)/,
    );
  return match ? `${match[1]}-${match[2].padStart(2, "0")}` : null;
}

function pageForCandidate(
  pages: DocumentPage[],
  candidate: ResumeFieldSourceCandidate,
) {
  return pages.find(
    (page) =>
      page.sourceFile === candidate.sourceFile &&
      page.page === candidate.sourcePage,
  );
}

function candidateIsLocated(
  pages: DocumentPage[],
  candidate: ResumeFieldSourceCandidate,
) {
  const page = pageForCandidate(pages, candidate);
  const source =
    candidate.sourceMethod === "pdf_text" ? page?.pdfText : page?.ocrText;
  return Boolean(
    page &&
      source &&
      source.includes(candidate.sourceQuote) &&
      candidate.sourceQuote.includes(candidate.rawValue),
  );
}

function candidateIsReliable(
  pages: DocumentPage[],
  candidate: ResumeFieldSourceCandidate,
) {
  const page = pageForCandidate(pages, candidate);
  if (!page || candidate.confidence < config.OCR_MIN_CONFIDENCE) return false;
  return candidate.sourceMethod === "pdf_text"
    ? page.qualityScore >= config.TEXT_QUALITY_MIN_SCORE
    : page.ocrConfidence !== null &&
        page.ocrConfidence >= config.OCR_MIN_CONFIDENCE;
}

function inferLegacyCandidates(
  field: EvidenceStringField | EvidenceMonthField,
  pages: DocumentPage[],
): ResumeFieldSourceCandidate[] {
  const page = pages.find(
    (item) =>
      item.sourceFile === field.sourceFile && item.page === field.sourcePage,
  );
  if (!page || !field.sourceQuote) return [];
  let rawValue = field.rawValue ?? field.value;
  if (typeof rawValue !== "string") return [];
  if (!field.sourceQuote.includes(rawValue) && field.value) {
    rawValue =
      [...field.sourceQuote.matchAll(RAW_MONTH_PATTERN)]
        .map((match) => match[0])
        .find(
          (raw) =>
            normalizedMonth(raw, new Date().toISOString().slice(0, 7)) ===
            field.value,
        ) ?? rawValue;
  }
  const candidates: ResumeFieldSourceCandidate[] = [];
  if (page.pdfText?.includes(field.sourceQuote)) {
    candidates.push({
      rawValue,
      sourceFile: page.sourceFile,
      sourcePage: page.page,
      sourceQuote: field.sourceQuote,
      sourceMethod: "pdf_text",
      confidence: field.confidence,
    });
  }
  if (page.ocrText?.includes(field.sourceQuote)) {
    candidates.push({
      rawValue,
      sourceFile: page.sourceFile,
      sourcePage: page.page,
      sourceQuote: field.sourceQuote,
      sourceMethod: "ocr",
      confidence: field.confidence,
    });
  }
  return candidates;
}

function canonicalStringField(
  field: EvidenceStringField,
  pages: DocumentPage[],
): EvidenceStringField {
  if (field.status === "missing") return field;
  const candidates = (field.sourceCandidates?.length
    ? field.sourceCandidates
    : inferLegacyCandidates(field, pages)
  ).filter((candidate) => candidateIsLocated(pages, candidate));
  const reliable = candidates.filter((candidate) =>
    candidateIsReliable(pages, candidate),
  );
  const selected =
    reliable.find((candidate) => candidate.sourceMethod === "pdf_text") ??
    reliable.find((candidate) => candidate.sourceMethod === "ocr") ??
    candidates.find((candidate) => candidate.sourceMethod === "pdf_text") ??
    candidates[0];
  if (!selected) {
    return { ...field, value: null, status: "uncertain", sourceCandidates: candidates };
  }
  return {
    ...field,
    value: selected.rawValue,
    rawValue: selected.rawValue,
    normalizedValue: selected.rawValue,
    status: reliable.includes(selected) ? "verified" : "uncertain",
    sourceFile: selected.sourceFile,
    sourcePage: selected.sourcePage,
    sourceQuote: selected.sourceQuote,
    sourceMethod: selected.sourceMethod,
    extractionMethod: selected.sourceMethod,
    confidence: selected.confidence,
    sourceCandidates: candidates,
  };
}

function canonicalMonthField(
  field: EvidenceMonthField,
  pages: DocumentPage[],
  currentMonth: string,
): EvidenceMonthField {
  if (field.status === "missing") return field;
  const candidates = (field.sourceCandidates?.length
    ? field.sourceCandidates
    : inferLegacyCandidates(field, pages)
  ).filter((candidate) => candidateIsLocated(pages, candidate));
  const normalized = candidates
    .map((candidate) => ({
      candidate,
      value: normalizedMonth(candidate.rawValue, currentMonth),
    }))
    .filter(
      (
        item,
      ): item is {
        candidate: ResumeFieldSourceCandidate;
        value: string;
      } => item.value !== null,
    );
  const reliable = normalized.filter(({ candidate }) =>
    candidateIsReliable(pages, candidate),
  );
  const selected =
    reliable.find(({ candidate }) => candidate.sourceMethod === "pdf_text") ??
    reliable.find(({ candidate }) => candidate.sourceMethod === "ocr") ??
    normalized.find(({ candidate }) => candidate.sourceMethod === "pdf_text") ??
    normalized[0];
  if (!selected) {
    return { ...field, value: null, status: "uncertain", sourceCandidates: candidates };
  }
  const conflictingValues = new Set(reliable.map(({ value }) => value)).size > 1;
  return {
    ...field,
    value: selected.value,
    rawValue: selected.candidate.rawValue,
    normalizedValue: selected.value,
    status:
      reliable.includes(selected) && !conflictingValues
        ? "verified"
        : "uncertain",
    sourceFile: selected.candidate.sourceFile,
    sourcePage: selected.candidate.sourcePage,
    sourceQuote: selected.candidate.sourceQuote,
    sourceMethod: selected.candidate.sourceMethod,
    extractionMethod: selected.candidate.sourceMethod,
    confidence: selected.candidate.confidence,
    sourceCandidates: candidates,
  };
}

export function selectResumeFieldSources(
  input: ResumeEvidenceExtraction,
  pages: DocumentPage[],
  currentMonth = new Date().toISOString().slice(0, 7),
): ResumeEvidenceExtraction {
  const candidateName = canonicalStringField(input.candidateName, pages);
  const experiences = input.experiences.map((experience) => {
    const resumeCompany = canonicalStringField(experience.resumeCompany, pages);
    const position = experience.position
      ? canonicalStringField(experience.position, pages)
      : undefined;
    const resumeStartMonth = canonicalMonthField(
      experience.resumeStartMonth,
      pages,
      currentMonth,
    );
    const resumeEndMonth = canonicalMonthField(
      experience.resumeEndMonth,
      pages,
      currentMonth,
    );
    const fields: Array<
      [
        string,
        EvidenceStringField | EvidenceMonthField | undefined,
      ]
    > = [
      ["resumeCompany", resumeCompany],
      ["position", position],
      ["resumeStartMonth", resumeStartMonth],
      ["resumeEndMonth", resumeEndMonth],
    ];
    const fieldWarnings = fields
      .filter((entry) => entry[1] && entry[1].status === "uncertain")
      .map(([name]) => `FIELD_REVIEW_REQUIRED:${name}`);
    return {
      ...experience,
      resumeCompany,
      position,
      resumeStartMonth,
      resumeEndMonth,
      warnings: [...new Set([...experience.warnings, ...fieldWarnings])],
    };
  });
  return ResumeEvidenceExtractionSchema.parse({ candidateName, experiences });
}

export async function extractResumeWithEvidence(
  pages: DocumentPage[],
  onCall?: (metric: DeepSeekCallMetric) => void,
): Promise<ResumeEvidenceExtraction> {
  const source = pages.map((page) => ({
    sourceFile: page.sourceFile,
    sourcePage: page.page,
    pdfTextCandidate: page.pdfText,
    pdfTextQualityScore: page.qualityScore,
    ocrTextCandidate: page.ocrText,
    ocrConfidence: page.ocrConfidence,
  }));
  const extracted = await parseWithRetry(
    ResumeEvidenceExtractionSchema,
    `你只能定位简历字段并把字段归组到工作经历，不能创造、推断、纠错或改写事实。
只输出符合 Schema 的 JSON：
{
  "candidateName": EvidenceStringField,
  "experiences": [{
    "resumeCompany": EvidenceStringField,
    "position": EvidenceStringField,
    "resumeStartMonth": EvidenceMonthField,
    "resumeEndMonth": EvidenceMonthField,
    "warnings": []
  }]
}
只提取 candidateName、companyRaw（字段名 resumeCompany）、position、startMonth、endMonth；禁止提取描述、项目、技能、教育、联系方式或其他字段。
EvidenceField 必须包含 value、rawValue、normalizedValue、status、sourceFile、sourcePage、sourceQuote、sourceMethod、extractionMethod、confidence、sourceCandidates。
sourceCandidates 必须逐项列出 PDF_TEXT 和 OCR 中实际出现的该字段候选；每项包含 rawValue、sourceFile、sourcePage、sourceQuote、sourceMethod、confidence。
规则：
1. candidateName、companyRaw、position 的 rawValue/value 必须是 sourceQuote 中逐字存在的原文；companyRaw 禁止简称、补全、纠错、扩写、合并、品牌替换或标准化。
2. 月份 rawValue 必须逐字来自原文；normalizedValue/value 只可把 YYYY.MM、YYYY-MM、YYYY/MM、YYYYMM、YYYY年MM月转换为 YYYY-MM。“至今/目前/Present”保留在 rawValue，value 暂为 null，由确定性代码统一处理。
3. 原文没有 position 或 endMonth 时 value=null、rawValue=null、normalizedValue=null、status="missing"；无法确定时 status="uncertain"。禁止根据职责猜职位，禁止根据工龄或相邻经历补日期。
4. sourceQuote 必须逐字复制自指定页面，sourceFile/sourcePage 必须对应输入。
5. 同一经历可以跨页组合；每个字段独立引用自己的页面和原文片段。不得把工作描述结构化。
6. sourceMethod/extractionMethod 必须为实际原文来源 "pdf_text" 或 "ocr"；confidence 为 0 到 1。不要自行决定最终可信来源，代码会按字段选择。
7. PDF_TEXT 与 OCR 候选不一致时必须同时保留在 sourceCandidates，禁止静默选择或合并。
8. 不计算任职月数，不判断公司关系，不判断核验结论。`,
    JSON.stringify(source),
    onCall,
  );
  return selectResumeFieldSources(extracted, pages);
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
