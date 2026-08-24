import { describe, expect, it } from "vitest";
import {
  DEFAULT_TEXT_QUALITY_CONFIG,
  TextQualityEvaluator,
} from "./text-quality";

describe("TextQualityEvaluator", () => {
  it("classifies a normal single-column electronic page as high quality", () => {
    const result = new TextQualityEvaluator().evaluate(
      [
        "工作经历",
        "2022.03-2024.05 深圳市腾讯科技有限公司 软件工程师",
        "负责企业系统研发、测试、发布和线上维护工作。",
        "2020.01-2022.02 深圳市友点科技有限公司 开发工程师",
        "负责业务需求分析、接口开发和数据库设计。",
      ].join("\n"),
    );

    expect(result.qualityLevel).toBe("HIGH");
    expect(result.ocrRecommended).toBe(false);
    expect(result.score).toBeGreaterThanOrEqual(75);
  });

  it("flags suspicious two-column order and weak date-company alignment", () => {
    const evaluator = new TextQualityEvaluator();
    const pdf = evaluator.evaluate("2022.03\n公司 A\n2020.01\n公司 B");
    const ocr = evaluator.evaluate("2022.03 公司 A\n2020.01 公司 B");

    expect(pdf.warnings).toContain("suspicious_two_column_order");
    expect(pdf.warnings).toContain("date_company_alignment_low");
    expect(pdf.warnings).toContain("ocr_recommended");
    expect(pdf.ocrRecommended).toBe(true);
    expect(ocr.score).toBeGreaterThan(pdf.score);
    expect(ocr.metrics.dateCompanyAlignmentRatio).toBe(1);
  });

  it("flags table structure loss", () => {
    const result = new TextQualityEvaluator().evaluate(
      [
        "缴费月份  单位名称  养老  工伤",
        "2022.01  深圳市友点科技有限公司  1  1",
        "2022.02  深圳市友点科技有限公司  1  1",
        "2022.03  深圳市友点科技有限公司  1  1",
      ].join("\n"),
    );

    expect(result.warnings).toContain("possible_table_structure_loss");
  });

  it("flags too-short pages as low quality", () => {
    const result = new TextQualityEvaluator().evaluate("简历");
    expect(result.warnings).toContain("too_short");
    expect(result.qualityLevel).toBe("LOW");
  });

  it("flags excessive replacement characters as low quality", () => {
    const result = new TextQualityEvaluator().evaluate(
      `候选人工作经历和项目经验${"\uFFFD".repeat(20)}`,
    );
    expect(result.warnings).toContain("excessive_replacement_chars");
    expect(result.qualityLevel).toBe("LOW");
  });

  it("flags repeated lines", () => {
    const line = "2022.03 深圳市腾讯科技有限公司";
    const result = new TextQualityEvaluator().evaluate(
      [line, line, line, "负责软件系统研发和维护"].join("\n"),
    );
    expect(result.warnings).toContain("repeated_lines");
  });

  it("flags abnormal line fragmentation", () => {
    const result = new TextQualityEvaluator().evaluate(
      ["工", "作", "经", "历", "深", "圳", "科", "技", "有", "限", "公", "司"].join(
        "\n",
      ),
    );
    expect(result.warnings).toContain("abnormal_line_fragmentation");
  });

  it("flags abnormal Unicode and low text density", () => {
    const evaluator = new TextQualityEvaluator();
    const result = evaluator.evaluate(
      "候\n选\n人\n工\n作\n经\n历\n\uE000\n公\n司\n信\n息",
    );
    const blank = evaluator.evaluate(" \n\t");

    expect(result.warnings).toContain("abnormal_unicode");
    expect(result.warnings).toContain("low_text_density");
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
      minimumUsefulCharacters: 0,
      shortLineRatioThreshold: 2,
      ocrScoreThreshold: 0,
      ocrWarningCountThreshold: 99,
    });
    const result = evaluator.evaluate(
      "2022.03\n公司 A\n2020.01\n公司 B",
    );

    expect(result.warnings).not.toContain("date_company_alignment_low");
    expect(result.warnings).not.toContain("possible_table_structure_loss");
    expect(result.warnings).not.toContain("suspicious_two_column_order");
    expect(result.ocrRecommended).toBe(false);
    expect(DEFAULT_TEXT_QUALITY_CONFIG.minimumDatesForAlignmentCheck).toBe(2);
  });
});
