import { describe, expect, it } from "vitest";
import { selectResumeFieldSources } from "./deepseek";
import { validateResumeEvidence } from "./evidence-validator";
import type {
  DocumentPage,
  EvidenceMonthField,
  EvidenceStringField,
  ResumeEvidenceExtraction,
  ResumeFieldSourceCandidate,
} from "./schemas";

function page(
  pageNumber: number,
  pdfText: string | null,
  ocrText: string | null = pdfText,
  options: Partial<DocumentPage> = {},
): DocumentPage {
  return {
    page: pageNumber,
    sourceFile: "resume.pdf",
    pdfText,
    ocrText,
    selectedText: options.selectedText ?? pdfText,
    extractionMethod: options.extractionMethod ?? "hybrid",
    qualityScore: options.qualityScore ?? 95,
    ocrConfidence: options.ocrConfidence ?? 0.96,
    warnings: options.warnings ?? [],
  };
}

function candidate(
  rawValue: string,
  sourcePage: number,
  sourceQuote: string,
  sourceMethod: "pdf_text" | "ocr",
): ResumeFieldSourceCandidate {
  return {
    rawValue,
    sourceFile: "resume.pdf",
    sourcePage,
    sourceQuote,
    sourceMethod,
    confidence: 0.96,
  };
}

function stringField(
  value: string | null,
  sourceCandidates: ResumeFieldSourceCandidate[],
  status: EvidenceStringField["status"] = value === null ? "missing" : "verified",
): EvidenceStringField {
  const first = sourceCandidates[0];
  return {
    value,
    rawValue: value,
    normalizedValue: value,
    status,
    sourceFile: first?.sourceFile ?? "resume.pdf",
    sourcePage: first?.sourcePage ?? 1,
    sourceQuote: first?.sourceQuote ?? "",
    sourceMethod: first?.sourceMethod,
    extractionMethod: first?.sourceMethod ?? "deepseek",
    confidence: first?.confidence ?? 0,
    sourceCandidates,
  };
}

function monthField(
  value: string | null,
  sourceCandidates: ResumeFieldSourceCandidate[],
  status: EvidenceMonthField["status"] = value === null ? "missing" : "verified",
): EvidenceMonthField {
  const first = sourceCandidates[0];
  return {
    value,
    rawValue: first?.rawValue ?? null,
    normalizedValue: value,
    status,
    sourceFile: first?.sourceFile ?? "resume.pdf",
    sourcePage: first?.sourcePage ?? 1,
    sourceQuote: first?.sourceQuote ?? "",
    sourceMethod: first?.sourceMethod,
    extractionMethod: first?.sourceMethod ?? "deepseek",
    confidence: first?.confidence ?? 0,
    sourceCandidates,
  };
}

function extraction(
  experiences: ResumeEvidenceExtraction["experiences"],
  nameCandidates: ResumeFieldSourceCandidate[],
): ResumeEvidenceExtraction {
  return {
    candidateName: stringField("张三", nameCandidates),
    experiences,
  };
}

describe("resume field-level source selection", () => {
  it("extracts a standard single-page experience with exact company fidelity", () => {
    const text = "张三\nABC科技有限公司\nJava开发工程师\n2022年7月 - 2024.03";
    const pages = [page(1, text)];
    const name = candidate("张三", 1, "张三", "pdf_text");
    const company = candidate(
      "ABC科技有限公司",
      1,
      "ABC科技有限公司",
      "pdf_text",
    );
    const position = candidate(
      "Java开发工程师",
      1,
      "Java开发工程师",
      "pdf_text",
    );
    const start = candidate("2022年7月", 1, "2022年7月 - 2024.03", "pdf_text");
    const end = candidate("2024.03", 1, "2022年7月 - 2024.03", "pdf_text");
    const selected = selectResumeFieldSources(
      extraction(
        [
          {
            resumeCompany: stringField("ABC科技有限公司", [company]),
            position: stringField("Java开发工程师", [position]),
            resumeStartMonth: monthField("2022-07", [start]),
            resumeEndMonth: monthField("2024-03", [end]),
            warnings: [],
          },
        ],
        [name],
      ),
      pages,
    );

    expect(selected.experiences[0]).toMatchObject({
      resumeCompany: {
        value: "ABC科技有限公司",
        rawValue: "ABC科技有限公司",
        sourceMethod: "pdf_text",
        status: "verified",
      },
      position: { value: "Java开发工程师", status: "verified" },
      resumeStartMonth: {
        rawValue: "2022年7月",
        normalizedValue: "2022-07",
        value: "2022-07",
      },
      resumeEndMonth: { value: "2024-03" },
    });
    expect(validateResumeEvidence(selected, pages).validationStatus).toBe(
      "VALIDATED",
    );
  });

  it("keeps multiple companies as separate experiences", () => {
    const text =
      "张三\n甲方有限公司\n工程师\n2020/01-2021/02\n乙方科技\n主管\n2021/03-2022/04";
    const pages = [page(1, text)];
    const experience = (
      companyRaw: string,
      positionRaw: string,
      startRaw: string,
      endRaw: string,
    ) => ({
      resumeCompany: stringField(companyRaw, [
        candidate(companyRaw, 1, companyRaw, "pdf_text"),
      ]),
      position: stringField(positionRaw, [
        candidate(positionRaw, 1, positionRaw, "pdf_text"),
      ]),
      resumeStartMonth: monthField(startRaw.replace("/", "-"), [
        candidate(startRaw, 1, `${startRaw}-${endRaw}`, "pdf_text"),
      ]),
      resumeEndMonth: monthField(endRaw.replace("/", "-"), [
        candidate(endRaw, 1, `${startRaw}-${endRaw}`, "pdf_text"),
      ]),
      warnings: [],
    });
    const selected = selectResumeFieldSources(
      extraction(
        [
          experience("甲方有限公司", "工程师", "2020/01", "2021/02"),
          experience("乙方科技", "主管", "2021/03", "2022/04"),
        ],
        [candidate("张三", 1, "张三", "pdf_text")],
      ),
      pages,
    );

    expect(selected.experiences.map((item) => item.resumeCompany.value)).toEqual(
      ["甲方有限公司", "乙方科技"],
    );
  });

  it("allows one experience to use independently located fields across pages", () => {
    const page2 = "ABC科技有限公司\nJava开发工程师\n2022-07";
    const page3 = "ABC科技有限公司（续）\n结束日期：2024-03";
    const pages = [page(2, `张三\n${page2}`), page(3, page3)];
    const selected = selectResumeFieldSources(
      extraction(
        [
          {
            resumeCompany: stringField("ABC科技有限公司", [
              candidate("ABC科技有限公司", 2, "ABC科技有限公司", "pdf_text"),
            ]),
            position: stringField("Java开发工程师", [
              candidate("Java开发工程师", 2, "Java开发工程师", "pdf_text"),
            ]),
            resumeStartMonth: monthField("2022-07", [
              candidate("2022-07", 2, "2022-07", "pdf_text"),
            ]),
            resumeEndMonth: monthField("2024-03", [
              candidate("2024-03", 3, "结束日期：2024-03", "pdf_text"),
            ]),
            warnings: [],
          },
        ],
        [candidate("张三", 2, "张三", "pdf_text")],
      ),
      pages,
    );
    const validated = validateResumeEvidence(selected, pages);

    expect(selected.experiences).toHaveLength(1);
    expect(selected.experiences[0].resumeEndMonth.sourcePage).toBe(3);
    expect(validated.validationStatus).toBe("VALIDATED");
  });

  it("marks only a conflicting date while retaining the experience and other fields", () => {
    const pdf = "张三\nABC科技有限公司\nJava开发工程师\n2022-07 - 2024-03";
    const ocr = "张三\nABC科技有限公司\nJava开发工程师\n2022-07 - 2024-08";
    const pages = [
      page(1, pdf, ocr, {
        selectedText: null,
        extractionMethod: "manual_required",
        warnings: ["EXTRACTION_CONFLICT"],
      }),
    ];
    const both = (
      pdfRaw: string,
      ocrRaw = pdfRaw,
      pdfQuote = pdfRaw,
      ocrQuote = ocrRaw,
    ) => [
      candidate(pdfRaw, 1, pdfQuote, "pdf_text"),
      candidate(ocrRaw, 1, ocrQuote, "ocr"),
    ];
    const selected = selectResumeFieldSources(
      extraction(
        [
          {
            resumeCompany: stringField(
              "ABC科技有限公司",
              both("ABC科技有限公司"),
            ),
            position: stringField(
              "Java开发工程师",
              both("Java开发工程师"),
            ),
            resumeStartMonth: monthField(
              "2022-07",
              both("2022-07"),
            ),
            resumeEndMonth: monthField(
              "2024-03",
              both("2024-03", "2024-08"),
            ),
            warnings: [],
          },
        ],
        both("张三"),
      ),
      pages,
    );
    const validated = validateResumeEvidence(selected, pages);
    const experience = validated.value.experiences[0];

    expect(experience).toBeDefined();
    expect(experience.resumeCompany.status).toBe("verified");
    expect(experience.position?.status).toBe("verified");
    expect(experience.resumeStartMonth.status).toBe("verified");
    expect(experience.resumeEndMonth.status).toBe("uncertain");
    expect(experience.resumeEndMonth.sourceCandidates).toHaveLength(2);
    expect(validated.issues).toContainEqual(
      expect.objectContaining({
        code: "EXTRACTION_CONFLICT",
        field: "experiences.0.endMonth",
      }),
    );
  });

  it("prefers high-quality PDF text when OCR has one wrong company character", () => {
    const pdf = "张三\n远景科技有限公司\n工程师\n2021-01 - 2022-02";
    const ocr = "张三\n远最科技有限公司\n工程师\n2021-01 - 2022-02";
    const pages = [page(1, pdf, ocr)];
    const selected = selectResumeFieldSources(
      extraction(
        [
          {
            resumeCompany: stringField("远景科技有限公司", [
              candidate("远景科技有限公司", 1, "远景科技有限公司", "pdf_text"),
              candidate("远最科技有限公司", 1, "远最科技有限公司", "ocr"),
            ]),
            position: stringField("工程师", [
              candidate("工程师", 1, "工程师", "pdf_text"),
            ]),
            resumeStartMonth: monthField("2021-01", [
              candidate("2021-01", 1, "2021-01 - 2022-02", "pdf_text"),
            ]),
            resumeEndMonth: monthField("2022-02", [
              candidate("2022-02", 1, "2021-01 - 2022-02", "pdf_text"),
            ]),
            warnings: [],
          },
        ],
        [candidate("张三", 1, "张三", "pdf_text")],
      ),
      pages,
    );

    expect(selected.experiences[0].resumeCompany).toMatchObject({
      value: "远景科技有限公司",
      rawValue: "远景科技有限公司",
      sourceMethod: "pdf_text",
      status: "verified",
    });
  });

  it("preserves missing position, missing end month, and Present semantics", () => {
    const text = "张三\n甲公司\n2022.07\n乙公司\n产品经理\n2023.01 - Present";
    const pages = [page(1, text)];
    const selected = selectResumeFieldSources(
      extraction(
        [
          {
            resumeCompany: stringField("甲公司", [
              candidate("甲公司", 1, "甲公司", "pdf_text"),
            ]),
            position: stringField(null, []),
            resumeStartMonth: monthField("2022-07", [
              candidate("2022.07", 1, "2022.07", "pdf_text"),
            ]),
            resumeEndMonth: monthField(null, []),
            warnings: [],
          },
          {
            resumeCompany: stringField("乙公司", [
              candidate("乙公司", 1, "乙公司", "pdf_text"),
            ]),
            position: stringField("产品经理", [
              candidate("产品经理", 1, "产品经理", "pdf_text"),
            ]),
            resumeStartMonth: monthField("2023-01", [
              candidate("2023.01", 1, "2023.01 - Present", "pdf_text"),
            ]),
            resumeEndMonth: monthField(null, [
              candidate("Present", 1, "2023.01 - Present", "pdf_text"),
            ], "verified"),
            warnings: [],
          },
        ],
        [candidate("张三", 1, "张三", "pdf_text")],
      ),
      pages,
      "2026-08",
    );

    expect(selected.experiences[0].position?.status).toBe("missing");
    expect(selected.experiences[0].resumeEndMonth.status).toBe("missing");
    expect(selected.experiences[1].resumeEndMonth).toMatchObject({
      rawValue: "Present",
      normalizedValue: null,
      value: null,
      status: "uncertain",
    });
    expect(selected.experiences[1].resumeCompany.value).toBe("乙公司");
  });

  it("does not page-block new field evidence and accepts historical records without position", () => {
    const text = "张三\nABC科技有限公司\n2022-07 - 2024-03";
    const pages = [
      page(1, text, "张三\nABC科技有限公司\n2022-07 - 2024-08", {
        selectedText: null,
        extractionMethod: "manual_required",
        warnings: ["EXTRACTION_CONFLICT"],
      }),
    ];
    const historical: ResumeEvidenceExtraction = extraction(
      [
        {
          resumeCompany: stringField("ABC科技有限公司", [
            candidate("ABC科技有限公司", 1, "ABC科技有限公司", "pdf_text"),
          ]),
          resumeStartMonth: monthField("2022-07", [
            candidate("2022-07", 1, "2022-07 - 2024-03", "pdf_text"),
          ]),
          resumeEndMonth: monthField("2024-03", [
            candidate("2024-03", 1, "2022-07 - 2024-03", "pdf_text"),
          ]),
          warnings: [],
        },
      ],
      [candidate("张三", 1, "张三", "pdf_text")],
    );
    const selected = selectResumeFieldSources(historical, pages);
    const validated = validateResumeEvidence(selected, pages);

    expect(selected.experiences).toHaveLength(1);
    expect(selected.experiences[0].position).toBeUndefined();
    expect(validated.validationStatus).toBe("VALIDATED");
    expect(validated.issues).not.toContainEqual(
      expect.objectContaining({ field: "documentPage" }),
    );
  });
});
