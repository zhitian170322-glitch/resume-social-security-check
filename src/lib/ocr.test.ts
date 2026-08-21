import { describe, expect, it } from "vitest";
import { assertOCRCapacity } from "./ocr";

describe("OCR 月度额度", () => {
  it("恰好达到 190 次时要求当前任务人工确认", () => {
    expect(() => assertOCRCapacity(1, false, 189)).toThrowError(
      expect.objectContaining({ code: "OCR_CONFIRM_REQUIRED" }),
    );
  });

  it("付费确认仅绕过安全额度，不绕过 1000 次绝对熔断", () => {
    expect(() => assertOCRCapacity(1, true, 999)).toThrowError(
      expect.objectContaining({ code: "OCR_ABSOLUTE_LIMIT" }),
    );
  });
});
