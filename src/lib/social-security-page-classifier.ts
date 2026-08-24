import { TextQualityEvaluator } from "./text-quality";

export const REAL_FIXTURE_CALIBRATION_STATUS =
  "REAL_FIXTURE_CALIBRATION_PENDING" as const;

export type SocialSecurityPageType =
  | "TABLE"
  | "PLAIN_TEXT"
  | "SCANNED_UNKNOWN"
  | "UNSUPPORTED";

export interface SocialSecurityPageClassification {
  pageType: SocialSecurityPageType;
  confidence: number;
  reasons: string[];
  tableKeywordCount: number;
}

const SUPPORTED_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
]);

const TABLE_KEYWORDS = [
  "单位编号",
  "单位名称",
  "缴费年月",
  "费款所属期",
  "参保年月",
  "参保起止时间",
  "养老保险",
  "工伤保险",
  "失业保险",
];

export class SocialSecurityPageClassifier {
  classify(input: {
    mimeType: string;
    text: string | null;
    source?: "PDF_TEXT" | "GENERAL_OCR_PREVIEW";
  }): SocialSecurityPageClassification {
    if (!SUPPORTED_MIME_TYPES.has(input.mimeType)) {
      return {
        pageType: "UNSUPPORTED",
        confidence: 1,
        reasons: ["UNSUPPORTED_MIME_TYPE"],
        tableKeywordCount: 0,
      };
    }

    const text = input.text ?? "";
    if (!text.trim()) {
      return {
        pageType: "SCANNED_UNKNOWN",
        confidence: 0.9,
        reasons: ["NO_RELIABLE_TEXT_LAYER"],
        tableKeywordCount: 0,
      };
    }

    const tableKeywordCount = TABLE_KEYWORDS.filter((keyword) =>
      text.includes(keyword),
    ).length;
    const lines = text.split(/\r?\n/).filter((line) => line.trim());
    const multiColumnLineRatio =
      lines.length === 0
        ? 0
        : lines.filter((line) => (line.match(/\s{2,}/g)?.length ?? 0) >= 2)
            .length / lines.length;
    const quality = new TextQualityEvaluator().evaluate(text);
    const tableStructure =
      tableKeywordCount >= 3 ||
      (tableKeywordCount >= 2 && multiColumnLineRatio >= 0.15) ||
      quality.warnings.includes("possible_table_structure_loss");

    if (tableStructure) {
      return {
        pageType: "TABLE",
        confidence: Math.min(
          0.98,
          0.65 + tableKeywordCount * 0.05 + multiColumnLineRatio * 0.2,
        ),
        reasons: [
          ...(tableKeywordCount >= 2 ? ["TABLE_HEADERS_DETECTED"] : []),
          ...(multiColumnLineRatio >= 0.15 ? ["MULTI_COLUMN_ALIGNMENT"] : []),
          ...(quality.warnings.includes("possible_table_structure_loss")
            ? ["PDF_TABLE_STRUCTURE_AT_RISK"]
            : []),
        ],
        tableKeywordCount,
      };
    }

    if (
      quality.qualityLevel === "LOW" ||
      quality.warnings.includes("abnormal_unicode") ||
      quality.warnings.includes("excessive_replacement_chars")
    ) {
      return {
        pageType: "SCANNED_UNKNOWN",
        confidence: 0.7,
        reasons: ["TEXT_LAYER_UNRELIABLE"],
        tableKeywordCount,
      };
    }

    return {
      pageType: "PLAIN_TEXT",
      confidence: quality.qualityLevel === "HIGH" ? 0.95 : 0.75,
      reasons: ["READABLE_TEXT_WITHOUT_TABLE_STRUCTURE"],
      tableKeywordCount,
    };
  }
}
