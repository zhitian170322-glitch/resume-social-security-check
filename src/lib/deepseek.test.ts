import { afterEach, describe, expect, it, vi } from "vitest";
import type { DocumentPage } from "./schemas";

const page = (
  pdfText: string | null,
  ocrText: string | null = pdfText,
): DocumentPage => ({
  page: 1,
  sourceFile: "resume.pdf",
  pdfText,
  ocrText,
  selectedText: pdfText,
  extractionMethod: "hybrid",
  qualityScore: 95,
  ocrConfidence: 0.96,
  warnings: [],
});

function mockResponse(content: unknown) {
  vi.stubEnv("DEEPSEEK_API_KEY", "mock-key");
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          {
            message: {
              content:
                typeof content === "string"
                  ? content
                  : JSON.stringify(content),
            },
          },
        ],
      }),
    }),
  );
}

describe("DeepSeek resume parse resilience", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("非法 JSON 自动重试一次后返回 AI_PARSE_FAILED", async () => {
    mockResponse("{invalid");
    const { extractResumeWithEvidence } = await import("./deepseek");
    await expect(extractResumeWithEvidence([page("测试简历")])).rejects.toMatchObject({
      code: "AI_PARSE_FAILED",
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("accepts the minimal Resume JSON and builds Evidence metadata in code", async () => {
    mockResponse({
      candidateName: "张三",
      experiences: [
        {
          companyRaw: "ABC科技有限公司",
          position: "Java开发工程师",
          startMonthRaw: "2022年7月",
          endMonthRaw: "2024年3月",
        },
      ],
    });
    const { extractResumeWithEvidence } = await import("./deepseek");
    const result = await extractResumeWithEvidence([
      page("张三\nABC科技有限公司\nJava开发工程师\n2022年7月 - 2024年3月"),
    ]);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      candidateName: {
        value: "张三",
        sourceFile: "resume.pdf",
        sourcePage: 1,
        sourceQuote: "张三",
        sourceMethod: "pdf_text",
        extractionMethod: "pdf_text",
        status: "verified",
      },
      experiences: [
        {
          resumeCompany: {
            value: "ABC科技有限公司",
            rawValue: "ABC科技有限公司",
            sourceCandidates: expect.arrayContaining([
              expect.objectContaining({ sourceMethod: "pdf_text" }),
            ]),
          },
          position: { value: "Java开发工程师" },
          resumeStartMonth: {
            rawValue: "2022年7月",
            normalizedValue: "2022-07",
          },
          resumeEndMonth: {
            rawValue: "2024年3月",
            normalizedValue: "2024-03",
          },
        },
      ],
    });
  });

  it("keeps processing when position and endMonth are omitted", async () => {
    mockResponse({
      candidateName: "张三",
      experiences: [
        {
          companyRaw: "ABC科技有限公司",
          startMonthRaw: "2022.07",
        },
      ],
    });
    const { extractResumeWithEvidence } = await import("./deepseek");
    const result = await extractResumeWithEvidence([
      page("张三\nABC科技有限公司\n2022.07"),
    ]);

    expect(result.experiences).toHaveLength(1);
    expect(result.experiences[0].position).toMatchObject({
      value: null,
      status: "missing",
      sourceCandidates: [],
    });
    expect(result.experiences[0].resumeEndMonth).toMatchObject({
      value: null,
      status: "missing",
      sourceCandidates: [],
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("does not require AI-generated sourceCandidates or confidence", async () => {
    mockResponse({
      candidateName: "张三",
      experiences: [{ companyRaw: "ABC科技有限公司" }],
    });
    const { extractResumeWithEvidence } = await import("./deepseek");
    const result = await extractResumeWithEvidence([
      page("张三\nABC科技有限公司"),
    ]);

    expect(result.experiences[0].resumeCompany).toMatchObject({
      value: "ABC科技有限公司",
      status: "verified",
      confidence: 0.95,
      sourceCandidates: expect.arrayContaining([
        expect.objectContaining({
          rawValue: "ABC科技有限公司",
          sourceMethod: "pdf_text",
          confidence: 0.95,
        }),
      ]),
    });
  });

  it("marks an ungrounded company uncertain instead of failing the Resume", async () => {
    mockResponse({
      candidateName: "张三",
      experiences: [{ companyRaw: "模型补全有限公司" }],
    });
    const { extractResumeWithEvidence } = await import("./deepseek");
    const result = await extractResumeWithEvidence([page("张三\n原文科技公司")]);

    expect(result.experiences).toHaveLength(1);
    expect(result.experiences[0].resumeCompany).toMatchObject({
      value: null,
      rawValue: "模型补全有限公司",
      status: "uncertain",
      sourceCandidates: [],
      confidence: 0,
    });
  });

  it("builds a PDF_TEXT candidate when only PDF text contains the field", async () => {
    mockResponse({
      candidateName: "张三",
      experiences: [{ companyRaw: "PDF原文有限公司" }],
    });
    const { extractResumeWithEvidence } = await import("./deepseek");
    const result = await extractResumeWithEvidence([
      page("张三\nPDF原文有限公司", "张三\nOCR识别错误"),
    ]);

    expect(result.experiences[0].resumeCompany).toMatchObject({
      value: "PDF原文有限公司",
      status: "verified",
      sourceMethod: "pdf_text",
      sourceCandidates: [
        expect.objectContaining({ sourceMethod: "pdf_text" }),
      ],
    });
  });

  it("builds an OCR candidate when only OCR text contains the field", async () => {
    mockResponse({
      candidateName: "张三",
      experiences: [{ companyRaw: "OCR原文有限公司" }],
    });
    const { extractResumeWithEvidence } = await import("./deepseek");
    const result = await extractResumeWithEvidence([
      page("张三\n其他文字", "张三\nOCR原文有限公司"),
    ]);

    expect(result.experiences[0].resumeCompany).toMatchObject({
      value: "OCR原文有限公司",
      status: "verified",
      sourceMethod: "ocr",
      sourceCandidates: [
        expect.objectContaining({ sourceMethod: "ocr" }),
      ],
    });
  });

  it("keeps a PDF/OCR month conflict field-level and preserves the experience", async () => {
    mockResponse({
      candidateName: "张三",
      experiences: [
        {
          companyRaw: "ABC科技有限公司",
          position: "工程师",
          startMonthRaw: "2022-07",
          endMonthRaw: "2024-03",
        },
      ],
    });
    const { extractResumeWithEvidence } = await import("./deepseek");
    const result = await extractResumeWithEvidence([
      page(
        "张三\nABC科技有限公司\n工程师\n2022-07 - 2024-03",
        "张三\nABC科技有限公司\n工程师\n2022-07 - 2024-08",
      ),
    ]);

    expect(result.experiences).toHaveLength(1);
    expect(result.experiences[0].resumeCompany.status).toBe("verified");
    expect(result.experiences[0].resumeStartMonth.status).toBe("verified");
    expect(result.experiences[0].resumeEndMonth).toMatchObject({
      value: "2024-03",
      status: "uncertain",
      sourceCandidates: [
        expect.objectContaining({ rawValue: "2024-03", sourceMethod: "pdf_text" }),
        expect.objectContaining({ rawValue: "2024-08", sourceMethod: "ocr" }),
      ],
    });
  });
});
