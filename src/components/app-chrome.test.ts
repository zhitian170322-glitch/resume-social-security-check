import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { APP_NAVIGATION, APP_SUBTITLE } from "./app-chrome";

describe("app chrome controls", () => {
  it("keeps only working navigation and the required subtitle", () => {
    expect(APP_SUBTITLE).toBe("简历与社保严格核验");
    expect(APP_NAVIGATION.map((item) => item.label)).toEqual([
      "工作台",
      "新建核查",
      "核查记录",
      "待人工复核",
    ]);
    const source = readFileSync(new URL("./app-chrome.tsx", import.meta.url), "utf8");
    expect(source).not.toMatch(/Evidence Workspace/);
    expect(source).not.toMatch(/traffic-lights/);
    expect(source).not.toMatch(/disabled/);
    expect(source).not.toMatch(/user-chip/);
    expect(source).not.toMatch(/>设置</);
  });
});
