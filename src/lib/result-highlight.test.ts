import { describe, expect, it } from "vitest";
import {
  companyHighlight,
  differenceHighlight,
  highlightLabel,
  rowStatusHighlight,
} from "./result-highlight";

describe("field-level result highlights", () => {
  it("highlights only the mismatched comparison field", () => {
    expect(companyHighlight("一致")).toBe("match");
    expect(companyHighlight("不一致")).toBe("mismatch");
    expect(differenceHighlight("社保晚1个月")).toBe("mismatch");
    expect(differenceHighlight("一致")).toBe("match");
    expect(rowStatusHighlight("RESUME_ONLY")).toBe("missing");
    expect(highlightLabel("mismatch")).toBe("不一致");
    expect(highlightLabel("override")).toBe("已人工修正");
  });
});
