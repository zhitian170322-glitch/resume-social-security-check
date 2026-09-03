import { describe, expect, it } from "vitest";
import {
  detectFieldConflicts,
  evaluateSourceQuality,
  mergeDualTextSources,
  normalizeComparableText,
} from "./hybrid-text";

const nativeResume = [
  "姓名：张三",
  "深圳示例科技有限公司",
  "工程师",
  "2021-01 至 2023-06",
].join("\n");

describe("hybrid text quality and merge", () => {
  it("uses native text when OCR is garbled", () => {
    const merged = mergeDualTextSources({
      nativeText: nativeResume,
      ocrText: "� sodjfksjdf ???? �\n#####",
    });
    expect(merged.decision).toBe("native");
    expect(merged.selectedText).toContain("深圳示例科技有限公司");
  });

  it("uses OCR when native text is empty", () => {
    const merged = mergeDualTextSources({
      nativeText: "",
      ocrText: nativeResume,
    });
    expect(merged.decision).toBe("ocr");
    expect(merged.selectedText).toContain("深圳示例科技有限公司");
  });

  it("marks agreed when both sources match after normalize", () => {
    const merged = mergeDualTextSources({
      nativeText: "深圳示例科技有限公司  2021-01",
      ocrText: "深圳示例科技有限公司 2021-01",
    });
    expect(merged.decision).toBe("agreed");
    expect(normalizeComparableText(merged.selectedText ?? "")).toBe(
      "深圳示例科技有限公司 2021-01",
    );
  });

  it("marks company name conflict for review and keeps both originals", () => {
    const merged = mergeDualTextSources({
      nativeText: "姓名：张三\n深圳示例科技有限公司\n工程师\n2021-01",
      ocrText: "姓名：张三\n广州另一家科技有限公司\n工程师\n2021-01",
    });
    expect(merged.decision).toBe("conflict");
    expect(merged.conflicts.some((item) => item.field === "company")).toBe(true);
    expect(merged.conflicts[0]?.nativeValues.join("")).toContain("深圳示例科技有限公司");
    expect(merged.conflicts[0]?.ocrValues.join("")).toContain("广州另一家科技有限公司");
  });

  it("marks month conflict for review", () => {
    const conflicts = detectFieldConflicts(
      "深圳示例科技有限公司\n2021-01 至 2022-12",
      "深圳示例科技有限公司\n2021-03 至 2022-12",
    );
    expect(conflicts.some((item) => item.field === "month")).toBe(true);
  });

  it("merges complementary non-conflicting lines without stitching company names", () => {
    const merged = mergeDualTextSources({
      nativeText: "深圳示例科技有限公司\n工程师",
      ocrText: "深圳示例科技有限公司\n2021-01 至 2022-06",
    });
    expect(merged.decision).toBe("merged");
    expect(merged.selectedText).toContain("深圳示例科技有限公司");
    expect(merged.selectedText).toContain("工程师");
    expect(merged.selectedText).toContain("2021-01");
    expect(merged.selectedText).not.toMatch(/深圳示例科技有限公司工程师/);
  });

  it("treats replacement-heavy OCR as garbage", () => {
    const quality = evaluateSourceQuality("����\n??\nab");
    expect(quality.garbage).toBe(true);
  });
});
