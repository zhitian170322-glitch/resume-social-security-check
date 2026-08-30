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

const optionalSourceText = z.preprocess(
  (value) =>
    typeof value === "string" && value.trim().length > 0 ? value : null,
  z.string().nullable(),
);

const ResumeAIResponseSchema = z
  .object({
    candidateName: optionalSourceText.optional().default(null),
    experiences: z.array(
      z
        .object({
          companyRaw: optionalSourceText.optional().default(null),
          position: optionalSourceText.optional().default(null),
          startMonthRaw: optionalSourceText.optional().default(null),
          endMonthRaw: optionalSourceText.optional().default(null),
        })
        .passthrough(),
    ),
  })
  .passthrough();

type ResumeAIResponse = z.infer<typeof ResumeAIResponseSchema>;

const RAW_MONTH_PATTERN =
  /(?<!\d)\d{4}\s*(?:[.\-/年]\s*|(?=\d{2}(?:\D|$)))(?:0?[1-9]|1[0-2])\s*月?(?!\d)/g;
const PRESENT_PATTERN = /至今|目前|present/iu;

export function isPresentMonthRaw(raw: string | null | undefined): boolean {
  return Boolean(raw && PRESENT_PATTERN.test(raw));
}

function normalizedMonth(raw: string) {
  if (PRESENT_PATTERN.test(raw)) return null;
  const match = raw
    .trim()
    .match(
      /(?<!\d)(\d{4})\s*(?:[.\-/年]\s*|(?=\d{2}(?:\D|$)))(0?[1-9]|1[0-2])\s*月?(?!\d)/,
    );
  return match ? `${match[1]}-${match[2].padStart(2, "0")}` : null;
}

function candidateConfidence(
  page: DocumentPage,
  sourceMethod: "pdf_text" | "ocr",
) {
  return sourceMethod === "pdf_text"
    ? page.qualityScore / 100
    : (page.ocrConfidence ?? 0);
}

function sourceCandidate(
  page: DocumentPage,
  rawValue: string,
  sourceMethod: "pdf_text" | "ocr",
): ResumeFieldSourceCandidate {
  return {
    rawValue,
    sourceFile: page.sourceFile,
    sourcePage: page.page,
    sourceQuote: rawValue,
    sourceMethod,
    confidence: candidateConfidence(page, sourceMethod),
  };
}

function uniqueCandidates(candidates: ResumeFieldSourceCandidate[]) {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = [
      candidate.sourceFile,
      candidate.sourcePage,
      candidate.sourceMethod,
      candidate.rawValue,
    ].join("\u001f");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function exactSourceCandidates(
  rawValue: string,
  pages: DocumentPage[],
): ResumeFieldSourceCandidate[] {
  const candidates: ResumeFieldSourceCandidate[] = [];
  for (const page of pages) {
    if (page.pdfText?.includes(rawValue)) {
      candidates.push(sourceCandidate(page, rawValue, "pdf_text"));
    }
    if (page.ocrText?.includes(rawValue)) {
      candidates.push(sourceCandidate(page, rawValue, "ocr"));
    }
  }
  return candidates;
}

type LocatedMonthToken = { rawValue: string; normalizedValue: string };

function monthTokens(text: string | null) {
  if (!text) return [];
  const tokens: LocatedMonthToken[] = [];
  for (const match of text.matchAll(RAW_MONTH_PATTERN)) {
    const normalizedValue = normalizedMonth(match[0]);
    if (normalizedValue) {
      tokens.push({ rawValue: match[0], normalizedValue });
    }
  }
  return tokens;
}

function monthSourceCandidates(
  aiRawValue: string,
  pages: DocumentPage[],
) {
  const targetMonth = normalizedMonth(aiRawValue);
  if (!targetMonth) return exactSourceCandidates(aiRawValue, pages);
  const candidates: ResumeFieldSourceCandidate[] = [];
  for (const page of pages) {
    const pdfTokens = monthTokens(page.pdfText);
    const ocrTokens = monthTokens(page.ocrText);
    const addMatching = (
      tokens: LocatedMonthToken[],
      sourceMethod: "pdf_text" | "ocr",
    ) => {
      tokens
        .filter((token) => token.normalizedValue === targetMonth)
        .forEach((token) =>
          candidates.push(
            sourceCandidate(page, token.rawValue, sourceMethod),
          ),
        );
    };
    addMatching(pdfTokens, "pdf_text");
    addMatching(ocrTokens, "ocr");

    const pdfIndex = pdfTokens.findIndex(
      (token) => token.normalizedValue === targetMonth,
    );
    const ocrIndex = ocrTokens.findIndex(
      (token) => token.normalizedValue === targetMonth,
    );
    if (pdfIndex >= 0 && ocrTokens[pdfIndex]) {
      candidates.push(
        sourceCandidate(page, ocrTokens[pdfIndex].rawValue, "ocr"),
      );
    }
    if (ocrIndex >= 0 && pdfTokens[ocrIndex]) {
      candidates.push(
        sourceCandidate(page, pdfTokens[ocrIndex].rawValue, "pdf_text"),
      );
    }
  }
  return uniqueCandidates(candidates);
}

function fallbackEvidenceLocation(pages: DocumentPage[]) {
  return {
    sourceFile: pages[0]?.sourceFile ?? "unknown",
    sourcePage: pages[0]?.page ?? 1,
  };
}

function buildStringEvidence(
  aiRawValue: string | null,
  pages: DocumentPage[],
): EvidenceStringField {
  const fallback = fallbackEvidenceLocation(pages);
  if (aiRawValue === null) {
    return {
      value: null,
      rawValue: null,
      normalizedValue: null,
      status: "missing",
      ...fallback,
      sourceQuote: "",
      extractionMethod: "deepseek",
      confidence: 0,
      sourceCandidates: [],
    };
  }
  const candidates = exactSourceCandidates(aiRawValue, pages);
  const first = candidates[0];
  return {
    value: first ? aiRawValue : null,
    rawValue: aiRawValue,
    normalizedValue: aiRawValue,
    status: first ? "verified" : "uncertain",
    sourceFile: first?.sourceFile ?? fallback.sourceFile,
    sourcePage: first?.sourcePage ?? fallback.sourcePage,
    sourceQuote: first?.sourceQuote ?? "",
    sourceMethod: first?.sourceMethod,
    extractionMethod: first?.sourceMethod ?? "deepseek",
    confidence: first?.confidence ?? 0,
    sourceCandidates: candidates,
  };
}

function buildMonthEvidence(
  aiRawValue: string | null,
  pages: DocumentPage[],
): EvidenceMonthField {
  const fallback = fallbackEvidenceLocation(pages);
  if (aiRawValue === null) {
    return {
      value: null,
      rawValue: null,
      normalizedValue: null,
      status: "missing",
      ...fallback,
      sourceQuote: "",
      extractionMethod: "deepseek",
      confidence: 0,
      sourceCandidates: [],
    };
  }
  const normalizedValue = normalizedMonth(aiRawValue);
  const candidates = monthSourceCandidates(aiRawValue, pages);
  const first = candidates[0];
  return {
    value: first ? normalizedValue : null,
    rawValue: aiRawValue,
    normalizedValue,
    status: first && normalizedValue ? "verified" : "uncertain",
    sourceFile: first?.sourceFile ?? fallback.sourceFile,
    sourcePage: first?.sourcePage ?? fallback.sourcePage,
    sourceQuote: first?.sourceQuote ?? "",
    sourceMethod: first?.sourceMethod,
    extractionMethod: first?.sourceMethod ?? "deepseek",
    confidence: first?.confidence ?? 0,
    sourceCandidates: candidates,
  };
}

export function groundResumeAIResponse(
  input: ResumeAIResponse,
  pages: DocumentPage[],
  currentMonth = new Date().toISOString().slice(0, 7),
): ResumeEvidenceExtraction {
  const extraction: ResumeEvidenceExtraction = {
    candidateName: buildStringEvidence(input.candidateName, pages),
    experiences: input.experiences.map((experience) => ({
      resumeCompany: buildStringEvidence(experience.companyRaw, pages),
      position: buildStringEvidence(experience.position, pages),
      resumeStartMonth: buildMonthEvidence(
        experience.startMonthRaw,
        pages,
      ),
      resumeEndMonth: buildMonthEvidence(
        experience.endMonthRaw,
        pages,
      ),
      warnings: [],
    })),
  };
  return selectResumeFieldSources(extraction, pages, currentMonth);
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
            normalizedMonth(raw) ===
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
): EvidenceMonthField {
  if (field.status === "missing") return field;
  const candidates = (field.sourceCandidates?.length
    ? field.sourceCandidates
    : inferLegacyCandidates(field, pages)
  ).filter((candidate) => candidateIsLocated(pages, candidate));
  const normalized = candidates
    .map((candidate) => ({
      candidate,
      value: normalizedMonth(candidate.rawValue),
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
  _currentMonth = new Date().toISOString().slice(0, 7),
): ResumeEvidenceExtraction {
  void _currentMonth;
  const candidateName = canonicalStringField(input.candidateName, pages);
  const experiences = input.experiences.map((experience) => {
    const resumeCompany = canonicalStringField(experience.resumeCompany, pages);
    const position = experience.position
      ? canonicalStringField(experience.position, pages)
      : undefined;
    const resumeStartMonth = canonicalMonthField(
      experience.resumeStartMonth,
      pages,
    );
    const resumeEndMonth = canonicalMonthField(
      experience.resumeEndMonth,
      pages,
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
    ResumeAIResponseSchema,
    `你只负责从简历原文识别基础字段并把字段归组到工作经历，不能创造、推断、纠错或改写事实。
只输出以下简单 JSON：
{
  "candidateName": "姓名或null",
  "experiences": [{
    "companyRaw": "公司原文或null",
    "position": "职位原文或null",
    "startMonthRaw": "开始年月原文或null",
    "endMonthRaw": "结束年月原文或null"
  }]
}
规则：
1. companyRaw、position 和年月字段必须原样复制，禁止补全、纠错、简称、品牌替换或标准化。
2. 原文没有字段时输出 null；禁止根据职责猜职位，禁止根据工龄或相邻经历补日期。
3. 同一经历可以跨页组合，但不得输出工作描述、项目、技能、教育、联系方式或其他字段。
4. 不要输出 Evidence、sourceFile、sourcePage、sourceQuote、sourceMethod、confidence 或 sourceCandidates；这些由程序确定性构建。
5. 不计算任职月数，不判断公司关系，不判断核验结论。`,
    JSON.stringify(source),
    onCall,
  );
  return groundResumeAIResponse(extracted, pages);
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
