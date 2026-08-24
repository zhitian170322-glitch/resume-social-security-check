import { describe, expect, it } from "vitest";
import {
  DEFAULT_TEXT_QUALITY_CONFIG,
  TextQualityEvaluator,
} from "./text-quality";

describe("TextQualityEvaluator", () => {
  it("flags fragmented PDF order and prefers aligned OCR text", () => {
    const evaluator = new TextQualityEvaluator();
    const pdf = evaluator.evaluate("2022.03\n公司 A\n2020.01\n公司 B");
    const ocr = evaluator.evaluate("2022.03 公司 A\n2020.01 公司 B");

    expect(pdf.warnings).toContain("text_order_suspicious");
    expect(pdf.warnings).toContain("possible_two_column");
    expect(pdf.warnings).toContain("date_company_alignment_low");
    expect(pdf.warnings).toContain("ocr_recommended");
    expect(pdf.ocrRecommended).toBe(true);
    expect(ocr.score).toBeGreaterThan(pdf.score);
    expect(ocr.metrics.dateCompanyAlignmentRatio).toBe(1);
    expect(ocr.ocrRecommended).toBe(false);
  });

  it("reports script ratios, duplicates, abnormal Unicode, and blank pages", () => {
    const evaluator = new TextQualityEvaluator();
    const result = evaluator.evaluate("公司AA11\uFFFD\n公司AA11\uFFFD");
    const blank = evaluator.evaluate(" \n\t");

    expect(result.metrics).toMatchObject({
      chineseCharacterCount: 4,
      englishCharacterCount: 4,
      digitCount: 4,
      duplicateLineCount: 1,
      abnormalUnicodeCount: 2,
    });
    expect(result.metrics.duplicateLineRatio).toBe(0.5);
    expect(result.metrics.chineseRatio).toBeCloseTo(4 / 14);
    expect(blank.score).toBe(0);
    expect(blank.metrics.blankPage).toBe(true);
    expect(blank.warnings).toEqual(
      expect.arrayContaining(["low_text_density", "ocr_recommended"]),
    );
  });

  it("uses caller-provided thresholds without mutating exported defaults", () => {
    const evaluator = new TextQualityEvaluator({
      minimumDatesForAlignmentCheck: 99,
      minimumDatesForTableCheck: 99,
      minimumLinesForLayoutCheck: 99,
      shortLineRatioThreshold: 2,
      ocrScoreThreshold: 0,
      ocrWarningCountThreshold: 99,
    });
    const result = evaluator.evaluate(
      "2022.03\n公司 A\n2020.01\n公司 B",
    );

    expect(result.warnings).not.toContain("date_company_alignment_low");
    expect(result.warnings).not.toContain("possible_table_loss");
    expect(result.warnings).not.toContain("possible_two_column");
    expect(result.ocrRecommended).toBe(false);
    expect(DEFAULT_TEXT_QUALITY_CONFIG.minimumDatesForAlignmentCheck).toBe(2);
  });
});
