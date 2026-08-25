import {
  ResumeEvidenceExtractionSchema,
  type DocumentPage,
  type EvidenceMonthField,
  type EvidenceMonthsField,
  type EvidenceNumberField,
  type EvidenceStringField,
  type ResumeEvidenceExtraction,
  type SocialSecurityEvidenceRecord,
} from "./schemas";
import { config } from "./config";
import {
  derivePaidMonthFacts,
  type EvidenceReference,
  type SocialSecurityCellEvidence,
  type SocialSecurityRawRecord,
  type ValueTransformation,
} from "./social-security-evidence";

export const REAL_FIXTURE_CALIBRATION_PENDING = true as const;
export const PRODUCTION_READY = false as const;

export type EvidenceValidationStatus =
  | "VALIDATED"
  | "UNCERTAIN"
  | "CONFLICT"
  | "UNSUPPORTED";

export type EvidenceIssueCode =
  | "EVIDENCE_MISMATCH"
  | "EXTRACTION_CONFLICT"
  | "OCR_COMPANY_UNCERTAIN"
  | "OCR_CONFIDENCE_LOW"
  | "TEMPLATE_UNKNOWN"
  | "DATE_UNSUPPORTED"
  | "SOURCE_QUOTE_MISSING"
  | "FIELD_STATUS_BLOCKED"
  | "EXTRACTION_UNSUPPORTED"
  | "TRANSFORMATION_UNSUPPORTED"
  | "CELL_EVIDENCE_MISSING"
  | "CELL_EVIDENCE_MISMATCH"
  | "CELL_CONFIDENCE_LOW"
  | "DERIVATION_MISMATCH"
  | "MONTH_DETAIL_UNAVAILABLE";

export type EvidenceIssue = {
  code: EvidenceIssueCode;
  field: string;
  sourceFile: string;
  sourcePage: number;
  message: string;
};

export type EvidenceValidationResult<T> = {
  value: T;
  issues: EvidenceIssue[];
  valid: boolean;
  validationStatus: EvidenceValidationStatus;
  automaticEligible: boolean;
};

export function normalizeYearMonth(raw: string): string | null {
  const controlled = raw.trim().replace(/[Il]/g, "1").replace(/O/g, "0");
  const match = controlled.match(
    /(?<!\d)(\d{4})\s*(?:[.\-/年]\s*|(?=\d{2}(?:\D|$)))(0?[1-9]|1[0-2])\s*月?(?!\d)/,
  );
  if (!match) return null;
  return `${match[1]}-${match[2].padStart(2, "0")}`;
}

export function extractYearMonths(raw: string): string[] {
  const values = new Set<string>();
  const pattern = /(?<!\d)(\d{4})\s*(?:[.\-/年]\s*|(?=[0O1-9Il]{2}(?:\D|$)))([0O]?[1-9Il]|1[0-2Il])\s*月?(?!\d)/g;
  for (const match of raw.matchAll(pattern)) {
    const value = normalizeYearMonth(match[0]);
    if (value) values.add(value);
  }
  return [...values];
}

export function normalizeCompanyCandidate(raw: string) {
  return raw
    .normalize("NFKC")
    .replace(/[\s（）()·•]/g, "")
    .replace(/^(深圳市|广东省|广州市)/, "")
    .replace(/(有限责任公司|股份有限公司|有限公司)$/, "");
}

const CONFLICT_CODES = new Set<EvidenceIssueCode>([
  "EVIDENCE_MISMATCH",
  "EXTRACTION_CONFLICT",
  "CELL_EVIDENCE_MISMATCH",
  "DERIVATION_MISMATCH",
]);
const UNSUPPORTED_CODES = new Set<EvidenceIssueCode>([
  "EXTRACTION_UNSUPPORTED",
  "TRANSFORMATION_UNSUPPORTED",
  "MONTH_DETAIL_UNAVAILABLE",
  "CELL_EVIDENCE_MISSING",
  "SOURCE_QUOTE_MISSING",
  "DATE_UNSUPPORTED",
]);

function validationStatus(
  issues: EvidenceIssue[],
): EvidenceValidationStatus {
  if (!issues.length) return "VALIDATED";
  if (issues.some((issue) => CONFLICT_CODES.has(issue.code))) {
    return "CONFLICT";
  }
  if (issues.some((issue) => UNSUPPORTED_CODES.has(issue.code))) {
    return "UNSUPPORTED";
  }
  return "UNCERTAIN";
}

function result<T>(value: T, issues: EvidenceIssue[]): EvidenceValidationResult<T> {
  const status = validationStatus(issues);
  return {
    value,
    issues,
    valid: status === "VALIDATED",
    validationStatus: status,
    automaticEligible: status === "VALIDATED",
  };
}

function pageTextForField(
  page: DocumentPage,
  field: EvidenceStringField | EvidenceMonthField | EvidenceNumberField | EvidenceMonthsField,
) {
  switch (field.sourceMethod ?? field.extractionMethod) {
    case "pdf_text":
      return page.pdfText ?? "";
    case "ocr":
    case "table_ocr":
      return page.ocrText ?? "";
    case "deepseek":
      return page.selectedText ?? "";
  }
}

function findPage(
  pages: DocumentPage[],
  field: Pick<EvidenceStringField, "sourceFile" | "sourcePage">,
) {
  return pages.find(
    (page) => page.sourceFile === field.sourceFile && page.page === field.sourcePage,
  );
}

function validateQuote(
  pages: DocumentPage[],
  field:
    | EvidenceStringField
    | EvidenceMonthField
    | EvidenceNumberField
    | EvidenceMonthsField,
  fieldName: string,
): EvidenceIssue[] {
  const page = findPage(pages, field);
  const raw = page ? pageTextForField(page, field) : "";
  const quoteLines = field.sourceQuote.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!page || !quoteLines.length || !quoteLines.every((line) => raw.includes(line))) {
    return [
      {
        code: "SOURCE_QUOTE_MISSING",
        field: fieldName,
        sourceFile: field.sourceFile,
        sourcePage: field.sourcePage,
        message: "字段引用的原文片段无法在对应文件页面中定位",
      },
    ];
  }
  return [];
}

function validateFieldGate(
  pages: DocumentPage[],
  field:
    | EvidenceStringField
    | EvidenceMonthField
    | EvidenceNumberField
    | EvidenceMonthsField,
  fieldName: string,
): EvidenceIssue[] {
  const issues: EvidenceIssue[] = [];
  const page = findPage(pages, field);
  if (field.status !== "verified") {
    issues.push({
      code:
        field.status === "unsupported"
          ? "EXTRACTION_UNSUPPORTED"
          : "FIELD_STATUS_BLOCKED",
      field: fieldName,
      sourceFile: field.sourceFile,
      sourcePage: field.sourcePage,
      message: `字段状态为 ${field.status}，禁止进入自动核验`,
    });
  }
  if (
    ((field.sourceMethod ?? field.extractionMethod) === "ocr" ||
      field.extractionMethod === "table_ocr" ||
      field.extractionMethod === "deepseek") &&
    field.confidence < config.OCR_MIN_CONFIDENCE
  ) {
    issues.push({
      code: "OCR_CONFIDENCE_LOW",
      field: fieldName,
      sourceFile: field.sourceFile,
      sourcePage: field.sourcePage,
      message: "字段提取置信度低于自动核验阈值",
    });
  }
  const sourceMethod = field.sourceMethod ?? field.extractionMethod;
  const sourceExists =
    sourceMethod === "pdf_text"
      ? Boolean(page?.pdfText)
      : sourceMethod === "ocr" || sourceMethod === "table_ocr"
        ? Boolean(page?.ocrText)
        : Boolean(page?.selectedText);
  if (!page || !sourceExists) {
    issues.push({
      code: "EXTRACTION_UNSUPPORTED",
      field: fieldName,
      sourceFile: field.sourceFile,
      sourcePage: field.sourcePage,
      message: "字段引用的原始来源不存在",
    });
  }
  if (
    sourceMethod === "pdf_text" &&
    page &&
    page.qualityScore < config.TEXT_QUALITY_MIN_SCORE
  ) {
    issues.push({
      code: "EXTRACTION_UNSUPPORTED",
      field: fieldName,
      sourceFile: field.sourceFile,
      sourcePage: field.sourcePage,
      message: "字段引用的 PDF Text 质量低于自动核验阈值",
    });
  }
  if (
    sourceMethod === "ocr" &&
    page &&
    (page.ocrConfidence === null ||
      page.ocrConfidence < config.OCR_MIN_CONFIDENCE)
  ) {
    issues.push({
      code: "OCR_CONFIDENCE_LOW",
      field: fieldName,
      sourceFile: field.sourceFile,
      sourcePage: field.sourcePage,
      message: "字段引用的 OCR 页面置信度低于自动核验阈值",
    });
  }
  return issues;
}

export function validateCompanyEvidence(
  pages: DocumentPage[],
  field: EvidenceStringField,
  fieldName: string,
): EvidenceIssue[] {
  const issues = [
    ...validateFieldGate(pages, field, fieldName),
    ...validateQuote(pages, field, fieldName),
  ];
  if (
    field.value &&
    field.sourceQuote &&
    !field.sourceQuote.includes(field.value)
  ) {
    issues.push({
      code: "EVIDENCE_MISMATCH",
      field: fieldName,
      sourceFile: field.sourceFile,
      sourcePage: field.sourcePage,
      message: "公司名称结构化值不是原文片段的逐字子串，禁止自动核验",
    });
  }
  if (
    field.value &&
    field.rawValue !== undefined &&
    field.rawValue !== field.value
  ) {
    issues.push({
      code: "EVIDENCE_MISMATCH",
      field: fieldName,
      sourceFile: field.sourceFile,
      sourcePage: field.sourcePage,
      message: "公司原始值被改写或标准化，禁止自动核验",
    });
  }
  return issues;
}

function validateTextEvidence(
  pages: DocumentPage[],
  field: EvidenceStringField,
  fieldName: string,
): EvidenceIssue[] {
  const issues = [
    ...validateFieldGate(pages, field, fieldName),
    ...validateQuote(pages, field, fieldName),
  ];
  const rawValue = field.rawValue ?? field.value;
  if (
    field.value &&
    (!rawValue ||
      field.value !== rawValue ||
      !field.sourceQuote.includes(rawValue))
  ) {
    issues.push({
      code: "EVIDENCE_MISMATCH",
      field: fieldName,
      sourceFile: field.sourceFile,
      sourcePage: field.sourcePage,
      message: "文本字段不是原文片段中的逐字事实",
    });
  }
  return issues;
}

export function validateMonthEvidence(
  pages: DocumentPage[],
  field: EvidenceMonthField,
  fieldName: string,
): EvidenceIssue[] {
  const issues = [
    ...validateFieldGate(pages, field, fieldName),
    ...validateQuote(pages, field, fieldName),
  ];
  const present =
    /至今|目前|present/iu.test(field.rawValue ?? field.sourceQuote) &&
    field.normalizedValue === field.value;
  if (
    field.value &&
    !present &&
    !extractYearMonths(field.sourceQuote).includes(field.value)
  ) {
    issues.push({
      code: "EVIDENCE_MISMATCH",
      field: fieldName,
      sourceFile: field.sourceFile,
      sourcePage: field.sourcePage,
      message: "结构化月份无法由原文片段按受控规则转换得到",
    });
  }
  const candidateMonths = new Set(
    (field.sourceCandidates ?? [])
      .flatMap((candidate) => extractYearMonths(candidate.rawValue))
      .filter(Boolean),
  );
  if (candidateMonths.size > 1) {
    issues.push({
      code: "EXTRACTION_CONFLICT",
      field: fieldName,
      sourceFile: field.sourceFile,
      sourcePage: field.sourcePage,
      message: "该月份字段的 PDF Text 与 OCR 候选值冲突",
    });
  }
  return issues;
}

function validateNumberEvidence(
  pages: DocumentPage[],
  field: EvidenceNumberField,
  fieldName: string,
): EvidenceIssue[] {
  const issues = [
    ...validateFieldGate(pages, field, fieldName),
    ...validateQuote(pages, field, fieldName),
  ];
  if (
    field.value !== null &&
    !field.sourceQuote.match(new RegExp(`(?:^|\\D)0*${field.value}(?:\\D|$)`))
  ) {
    issues.push({
      code: "EVIDENCE_MISMATCH",
      field: fieldName,
      sourceFile: field.sourceFile,
      sourcePage: field.sourcePage,
      message: "结构化数字无法在原文片段中定位",
    });
  }
  return issues;
}

function validateMonthsEvidence(
  pages: DocumentPage[],
  field: EvidenceMonthsField,
  fieldName: string,
): EvidenceIssue[] {
  const issues = [
    ...validateFieldGate(pages, field, fieldName),
    ...validateQuote(pages, field, fieldName),
  ];
  const sourceMonths = extractYearMonths(field.sourceQuote);
  if (
    field.value !== null &&
    !field.value.every((month) => sourceMonths.includes(month))
  ) {
    issues.push({
      code: "EVIDENCE_MISMATCH",
      field: fieldName,
      sourceFile: field.sourceFile,
      sourcePage: field.sourcePage,
      message: "缴费月份无法逐项定位到表格 OCR 原文",
    });
  }
  return issues;
}

export function validateResumeEvidence(
  input: ResumeEvidenceExtraction,
  pages: DocumentPage[],
): EvidenceValidationResult<ResumeEvidenceExtraction> {
  const parsed = ResumeEvidenceExtractionSchema.parse(input);
  const value = structuredClone(parsed);
  const issues: EvidenceIssue[] = validateCompanyEvidence(
    pages,
    value.candidateName,
    "candidateName",
  );
  if (issues.length) value.candidateName.status = "uncertain";
  value.experiences.forEach((experience, index) => {
    const fieldChecks = [
      {
        field: experience.resumeCompany,
        checks: validateCompanyEvidence(
          pages,
          experience.resumeCompany,
          `experiences.${index}.companyRaw`,
        ),
      },
      ...(experience.position
        ? [
            {
              field: experience.position,
              checks:
                experience.position.status === "missing" &&
                experience.position.value === null
                  ? []
                  : validateTextEvidence(
                      pages,
                      experience.position,
                      `experiences.${index}.position`,
                    ),
            },
          ]
        : []),
      {
        field: experience.resumeStartMonth,
        checks: validateMonthEvidence(
          pages,
          experience.resumeStartMonth,
          `experiences.${index}.startMonth`,
        ),
      },
      {
        field: experience.resumeEndMonth,
        checks: validateMonthEvidence(
          pages,
          experience.resumeEndMonth,
          `experiences.${index}.endMonth`,
        ),
      },
    ];
    for (const fieldCheck of fieldChecks) {
      if (fieldCheck.checks.length) {
        fieldCheck.field.status = "uncertain";
        experience.warnings.push(
          ...new Set(fieldCheck.checks.map((issue) => issue.code)),
        );
      }
      issues.push(...fieldCheck.checks);
    }
    experience.warnings = [...new Set(experience.warnings)];
  });
  return result(value, issues);
}

export function validateSocialEvidence(
  records: SocialSecurityEvidenceRecord[],
  pages: DocumentPage[],
): EvidenceValidationResult<SocialSecurityEvidenceRecord[]> {
  const value = structuredClone(records);
  const issues: EvidenceIssue[] = [];
  value.forEach((record, index) => {
    const checks = [
      ...validateCompanyEvidence(pages, record.companyRaw, `records.${index}.company`),
      ...validateMonthEvidence(pages, record.startMonth, `records.${index}.start`),
      ...validateMonthEvidence(pages, record.endMonth, `records.${index}.end`),
      ...validateMonthsEvidence(
        pages,
        record.paidMonths,
        `records.${index}.paidMonths`,
      ),
      ...validateNumberEvidence(
        pages,
        record.pensionMonths,
        `records.${index}.pensionMonths`,
      ),
      ...validateNumberEvidence(
        pages,
        record.injuryMonths,
        `records.${index}.injuryMonths`,
      ),
      ...validateNumberEvidence(
        pages,
        record.unemploymentMonths,
        `records.${index}.unemploymentMonths`,
      ),
    ];
    if (checks.length) {
      record.companyRaw.status = "uncertain";
      record.startMonth.status = "uncertain";
      record.endMonth.status = "uncertain";
      record.warnings.push(...new Set(checks.map((issue) => issue.code)));
    }
    issues.push(...checks);
  });
  return result(value, issues);
}

function controlledNumericCorrection(raw: string) {
  return raw
    .normalize("NFKC")
    .replace(/[Oo]/g, "0")
    .replace(/[Il]/g, "1")
    .replace(/S/g, "5");
}

function applyTransformations(
  rawValue: string,
  transformations: ValueTransformation[],
): { value: string; supported: boolean } {
  let current = rawValue;
  for (const transformation of transformations) {
    if (transformation.from !== current) {
      return { value: current, supported: false };
    }
    if (transformation.type === "CONTROLLED_NUMERIC_OCR_CORRECTION") {
      if (controlledNumericCorrection(current) !== transformation.to) {
        return { value: current, supported: false };
      }
    } else if (transformation.type === "DATE_FORMAT_NORMALIZATION") {
      if (normalizeYearMonth(current) !== transformation.to) {
        return { value: current, supported: false };
      }
    } else {
      return { value: current, supported: false };
    }
    current = transformation.to;
  }
  return { value: current, supported: true };
}

function rawIssue(
  code: EvidenceIssueCode,
  field: string,
  documentId: string,
  page: number,
  message: string,
): EvidenceIssue {
  return {
    code,
    field,
    sourceFile: documentId,
    sourcePage: page,
    message,
  };
}

function validateRawReference<T>(input: {
  reference: EvidenceReference<T>;
  field: string;
  documentId: string;
  evidence: Map<string, SocialSecurityCellEvidence>;
  allowCombinedRaw?: boolean;
}): EvidenceIssue[] {
  const issues: EvidenceIssue[] = [];
  const referenced = input.reference.evidenceIds
    .map((id) => input.evidence.get(id))
    .filter((entry): entry is SocialSecurityCellEvidence => Boolean(entry));
  const page = referenced[0]?.pageNumber ?? 1;
  if (
    input.reference.value !== null &&
    (!input.reference.evidenceIds.length ||
      referenced.length !== input.reference.evidenceIds.length)
  ) {
    issues.push(
      rawIssue(
        "CELL_EVIDENCE_MISSING",
        input.field,
        input.documentId,
        page,
        "字段缺少可解析的原始单元格 Evidence",
      ),
    );
  }
  if (
    input.reference.rawValue !== null &&
    referenced.length &&
    !(input.allowCombinedRaw
      ? referenced.every((entry) =>
          input.reference.rawValue!.includes(entry.rawValue),
        )
      : referenced.some(
          (entry) => entry.rawValue === input.reference.rawValue,
        ))
  ) {
    issues.push(
      rawIssue(
        "CELL_EVIDENCE_MISMATCH",
        input.field,
        input.documentId,
        page,
        "字段 rawValue 与引用单元格原文不一致",
      ),
    );
  }
  for (const entry of referenced) {
    if (entry.documentId !== input.documentId) {
      issues.push(
        rawIssue(
          "CELL_EVIDENCE_MISMATCH",
          input.field,
          input.documentId,
          entry.pageNumber,
          "字段引用了其他文档的单元格 Evidence",
        ),
      );
    }
    if (
      entry.confidence === null ||
      entry.confidence < config.OCR_MIN_CONFIDENCE
    ) {
      issues.push(
        rawIssue(
          "CELL_CONFIDENCE_LOW",
          input.field,
          input.documentId,
          entry.pageNumber,
          "引用单元格 OCR 置信度不足",
        ),
      );
    }
  }
  if (input.reference.rawValue !== null) {
    const transformed = input.allowCombinedRaw
      ? {
          value: input.reference.transformations
            .map((entry) => entry.to)
            .join("/"),
          supported: input.reference.transformations.every((entry) => {
            const applied = applyTransformations(entry.from, [entry]);
            return (
              applied.supported &&
              (entry.type === "CONTROLLED_NUMERIC_OCR_CORRECTION" ||
                typeof input.reference.value !== "string" ||
                input.reference.value.includes(applied.value))
            );
          }),
        }
      : applyTransformations(
          input.reference.rawValue,
          input.reference.transformations,
        );
    if (!transformed.supported) {
      issues.push(
        rawIssue(
          "TRANSFORMATION_UNSUPPORTED",
          input.field,
          input.documentId,
          page,
          "字段 transformation 无法按受控规则重放",
        ),
      );
    } else if (
      typeof input.reference.value === "string" &&
      !input.allowCombinedRaw &&
      transformed.value !== input.reference.value
    ) {
      issues.push(
        rawIssue(
          "EVIDENCE_MISMATCH",
          input.field,
          input.documentId,
          page,
          "字段值不是 rawValue 经声明 transformation 得到的结果",
        ),
      );
    } else if (typeof input.reference.value === "number") {
      const numeric = Number(transformed.value.match(/\d+(?:\.\d+)?/)?.[0]);
      if (!Number.isFinite(numeric) || numeric !== input.reference.value) {
        issues.push(
          rawIssue(
            "EVIDENCE_MISMATCH",
            input.field,
            input.documentId,
            page,
            "数字字段不是由单元格原文按受控规则转换得到",
          ),
        );
      }
    } else if (typeof input.reference.value === "boolean") {
      const expected = /^(?:1|是|已缴|正常|√|✓)$/u.test(
        transformed.value.trim(),
      );
      if (expected !== input.reference.value) {
        issues.push(
          rawIssue(
            "EVIDENCE_MISMATCH",
            input.field,
            input.documentId,
            page,
            "布尔险种字段与单元格原文不一致",
          ),
        );
      }
    }
  }
  return issues;
}

export function validateSocialSecurityRawRecords(
  records: SocialSecurityRawRecord[],
  cellEvidence: SocialSecurityCellEvidence[],
): EvidenceValidationResult<SocialSecurityRawRecord[]> & {
  recordStatuses: EvidenceValidationStatus[];
} {
  const evidence = new Map(cellEvidence.map((entry) => [entry.id, entry]));
  const issues: EvidenceIssue[] = [];
  const recordStatuses: EvidenceValidationStatus[] = [];

  records.forEach((record, recordIndex) => {
    const recordIssues: EvidenceIssue[] = [];
    const documentId =
      cellEvidence.find((entry) => record.evidenceIds.includes(entry.id))
        ?.documentId ?? `social-record-${recordIndex}`;
    if (record.status !== "PARSED") {
      recordIssues.push(
        rawIssue(
          record.status === "MANUAL_REVIEW_REQUIRED"
            ? "EXTRACTION_UNSUPPORTED"
            : "FIELD_STATUS_BLOCKED",
          `records.${recordIndex}`,
          documentId,
          1,
          `Parser 状态为 ${record.status}，禁止自动核验`,
        ),
      );
    }
    recordIssues.push(
      ...validateRawReference({
        reference: record.companyRaw,
        field: `records.${recordIndex}.companyRaw`,
        documentId,
        evidence,
      }),
    );
    if (
      record.companyRaw.rawValue !== record.companyRaw.value ||
      record.companyRaw.transformations.length
    ) {
      recordIssues.push(
        rawIssue(
          "EVIDENCE_MISMATCH",
          `records.${recordIndex}.companyRaw`,
          documentId,
          1,
          "公司名称原文不得被 transformation 或 normalized 值替换",
        ),
      );
    }
    if (record.unitCode) {
      recordIssues.push(
        ...validateRawReference({
          reference: record.unitCode,
          field: `records.${recordIndex}.unitCode`,
          documentId,
          evidence,
        }),
      );
    }
    record.monthlyRecords.forEach((monthly, monthIndex) => {
      for (const [name, reference] of [
        ["month", monthly.month],
        ["unitCode", monthly.unitCode],
        ["companyRaw", monthly.companyRaw],
      ] as const) {
        recordIssues.push(
          ...validateRawReference({
            reference,
            field: `records.${recordIndex}.monthlyRecords.${monthIndex}.${name}`,
            documentId,
            evidence,
          }),
        );
      }
      if (
        monthly.companyRaw.rawValue !== monthly.companyRaw.value ||
        monthly.companyRaw.transformations.length
      ) {
        recordIssues.push(
          rawIssue(
            "EVIDENCE_MISMATCH",
            `records.${recordIndex}.monthlyRecords.${monthIndex}.companyRaw`,
            documentId,
            1,
            "月度记录公司名称不得被改写",
          ),
        );
      }
      for (const [name, reference] of [
        ["pension", monthly.pension],
        ["medical", monthly.medical],
        ["injury", monthly.injury],
        ["unemployment", monthly.unemployment],
        ["maternity", monthly.maternity],
      ] as const) {
        if (!reference) continue;
        recordIssues.push(
          ...validateRawReference({
            reference,
            field: `records.${recordIndex}.monthlyRecords.${monthIndex}.${name}`,
            documentId,
            evidence,
          }),
        );
      }
    });
    if (record.rawPeriod) {
      recordIssues.push(
        ...validateRawReference({
          reference: record.rawPeriod,
          field: `records.${recordIndex}.rawPeriod`,
          documentId,
          evidence,
          allowCombinedRaw: true,
        }),
      );
    }
    for (const [name, reference] of [
      ["pensionMonths", record.pensionMonths],
      ["medicalMonths", record.medicalMonths],
      ["injuryMonths", record.injuryMonths],
      ["unemploymentMonths", record.unemploymentMonths],
      ["maternityMonths", record.maternityMonths],
    ] as const) {
      if (!reference) continue;
      recordIssues.push(
        ...validateRawReference({
          reference,
          field: `records.${recordIndex}.${name}`,
          documentId,
          evidence,
        }),
      );
    }
    if (record.paidMonths === null) {
      recordIssues.push(
        rawIssue(
          "MONTH_DETAIL_UNAVAILABLE",
          `records.${recordIndex}.paidMonths`,
          documentId,
          1,
          "缺少逐月缴费 Evidence，禁止派生连续缴费事实",
        ),
      );
    } else if (record.monthlyRecords.length) {
      const sourceMonths = [
        ...new Set(
          record.monthlyRecords
            .map((monthly) => monthly.month.value)
            .filter((month): month is string => month !== null),
        ),
      ].sort();
      const paidMonths = [...new Set(record.paidMonths)].sort();
      if (JSON.stringify(sourceMonths) !== JSON.stringify(paidMonths)) {
        recordIssues.push(
          rawIssue(
            "DERIVATION_MISMATCH",
            `records.${recordIndex}.paidMonths`,
            documentId,
            1,
            "paidMonths 与逐月 Evidence 不一致",
          ),
        );
      }
    }
    if (
      JSON.stringify(record.derived) !==
      JSON.stringify(derivePaidMonthFacts(record.paidMonths))
    ) {
      recordIssues.push(
        rawIssue(
          "DERIVATION_MISMATCH",
          `records.${recordIndex}.derived`,
          documentId,
          1,
          "起止月份、月数、gap 或 period 不是由 paidMonths 确定性派生",
        ),
      );
    }
    recordStatuses.push(validationStatus(recordIssues));
    issues.push(...recordIssues);
  });

  return {
    ...result(records, issues),
    recordStatuses,
  };
}
