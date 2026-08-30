import { describe, expect, it } from "vitest";
import {
  fileFingerprint,
  normalizePageText,
  pageFingerprint,
  shouldSkipDuplicate,
} from "./material-dedup";

describe("material dedup", () => {
  it("identifies identical files by SHA256", () => {
    expect(fileFingerprint("same-bytes")).toBe(fileFingerprint("same-bytes"));
    expect(fileFingerprint("same-bytes")).not.toBe(fileFingerprint("other-bytes"));
  });

  it("fingerprints pages after stripping page numbers and extra whitespace", () => {
    const left = pageFingerprint("单位编号 470855\n第 1 页\n2025-01");
    const right = pageFingerprint("单位编号  470855\n1 / 2\n2025-01");
    expect(normalizePageText("第 1 页")).not.toMatch(/第\s*1\s*页/);
    expect(left).toBe(right);
  });

  it("does not treat different pages as duplicates just because company names match", () => {
    const left = pageFingerprint("深圳软通动力信息技术有限公司\n2025-01 470855");
    const right = pageFingerprint("深圳软通动力信息技术有限公司\n2025-10 693601");
    expect(left).not.toBe(right);
  });

  it("keeps the first fingerprint and skips later duplicates", () => {
    const seen = new Set<string>();
    expect(shouldSkipDuplicate(seen, "aaa")).toBe(false);
    expect(shouldSkipDuplicate(seen, "aaa")).toBe(true);
    expect(seen.size).toBe(1);
  });
});
