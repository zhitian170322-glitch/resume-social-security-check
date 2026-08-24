import {
  ResumeEvidenceExtractionSchema,
  type DocumentPage,
  type EvidenceMonthField,
  type EvidenceStringField,
  type ResumeEvidenceExtraction,
  type SocialSecurityEvidenceRecord,
} from "./schemas";

export type EvidenceIssueCode =
  | "EVIDENCE_MISMATCH"
  | "EXTRACTION_CONFLICT"
  | "OCR_COMPANY_UNCERTAIN"
  | "OCR_CONFIDENCE_LOW"
  | "TEMPLATE_UNKNOWN"
  | "DATE_UNSUPPORTED"
  | "SOURCE_QUOTE_MISSING";

export type EvidenceIssue = {
  code: EvidenceIssueCode;
  field: string;
  sourceFile: string;
  sourcePage: number;
  message: string;
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

function pageRawText(page: DocumentPage) {
  return [page.pdfText, page.ocrText, page.selectedText].filter(Boolean).join("\n");
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
  field: EvidenceStringField | EvidenceMonthField,
  fieldName: string,
): EvidenceIssue[] {
  const page = findPage(pages, field);
  const raw = page ? pageRawText(page) : "";
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

export function validateCompanyEvidence(
  pages: DocumentPage[],
  field: EvidenceStringField,
  fieldName: string,
): EvidenceIssue[] {
  const issues = validateQuote(pages, field, fieldName);
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
  return issues;
}

export function validateMonthEvidence(
  pages: DocumentPage[],
  field: EvidenceMonthField,
  fieldName: string,
): EvidenceIssue[] {
  const issues = validateQuote(pages, field, fieldName);
  if (field.value && !extractYearMonths(field.sourceQuote).includes(field.value)) {
    issues.push({
      code: "EVIDENCE_MISMATCH",
      field: fieldName,
      sourceFile: field.sourceFile,
      sourcePage: field.sourcePage,
      message: "结构化月份无法由原文片段按受控规则转换得到",
    });
  }
  return issues;
}

export function validateResumeEvidence(
  input: ResumeEvidenceExtraction,
  pages: DocumentPage[],
): { value: ResumeEvidenceExtraction; issues: EvidenceIssue[]; valid: boolean } {
  const parsed = ResumeEvidenceExtractionSchema.parse(input);
  const value = structuredClone(parsed);
  const issues: EvidenceIssue[] = validateCompanyEvidence(
    pages,
    value.candidateName,
    "candidateName",
  );
  if (issues.length) value.candidateName.status = "uncertain";
  value.experiences.forEach((experience, index) => {
    const quotes = [
      experience.resumeCompany.sourceQuote,
      experience.resumeStartMonth.sourceQuote,
      experience.resumeEndMonth.sourceQuote,
    ];
    const sameBoundedBlock =
      new Set(quotes).size === 1 &&
      quotes[0].length <= 300 &&
      experience.resumeCompany.sourceFile === experience.resumeStartMonth.sourceFile &&
      experience.resumeCompany.sourceFile === experience.resumeEndMonth.sourceFile &&
      experience.resumeCompany.sourcePage === experience.resumeStartMonth.sourcePage &&
      experience.resumeCompany.sourcePage === experience.resumeEndMonth.sourcePage;
    const checks: EvidenceIssue[] = [
      ...validateCompanyEvidence(pages, experience.resumeCompany, `experiences.${index}.company`),
      ...validateMonthEvidence(pages, experience.resumeStartMonth, `experiences.${index}.start`),
      ...validateMonthEvidence(pages, experience.resumeEndMonth, `experiences.${index}.end`),
    ];
    if (!sameBoundedBlock) {
      checks.push({
        code: "EVIDENCE_MISMATCH",
        field: `experiences.${index}`,
        sourceFile: experience.resumeCompany.sourceFile,
        sourcePage: experience.resumeCompany.sourcePage,
        message: "公司与起止月份不是来自同一段不超过300字的连续原文区块",
      });
    }
    if (checks.length) {
      experience.resumeCompany.status = "uncertain";
      experience.resumeStartMonth.status = "uncertain";
      experience.resumeEndMonth.status = "uncertain";
      experience.warnings.push(...new Set(checks.map((issue) => issue.code)));
    }
    issues.push(...checks);
  });
  return { value, issues, valid: issues.length === 0 };
}

export function validateSocialEvidence(
  records: SocialSecurityEvidenceRecord[],
  pages: DocumentPage[],
): { value: SocialSecurityEvidenceRecord[]; issues: EvidenceIssue[]; valid: boolean } {
  const value = structuredClone(records);
  const issues: EvidenceIssue[] = [];
  value.forEach((record, index) => {
    const paidMonthMismatch =
      record.paidMonths.value !== null &&
      !record.paidMonths.value.every((month) =>
        extractYearMonths(record.paidMonths.sourceQuote).includes(month),
      );
    const checks = [
      ...validateCompanyEvidence(pages, record.companyRaw, `records.${index}.company`),
      ...validateMonthEvidence(pages, record.startMonth, `records.${index}.start`),
      ...validateMonthEvidence(pages, record.endMonth, `records.${index}.end`),
    ];
    if (paidMonthMismatch) {
      checks.push({
        code: "EVIDENCE_MISMATCH",
        field: `records.${index}.paidMonths`,
        sourceFile: record.paidMonths.sourceFile,
        sourcePage: record.paidMonths.sourcePage,
        message: "缴费月份无法逐项定位到表格 OCR 原文",
      });
    }
    if (checks.length) {
      record.companyRaw.status = "uncertain";
      record.startMonth.status = "uncertain";
      record.endMonth.status = "uncertain";
      record.warnings.push(...new Set(checks.map((issue) => issue.code)));
    }
    issues.push(...checks);
  });
  return { value, issues, valid: issues.length === 0 };
}
