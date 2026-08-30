import { describe, expect, it } from "vitest";
import { readOverallConclusion } from "./overall-conclusion";

describe("unified overall conclusion", () => {
  it("does not treat a completed task as fully consistent", () => {
    expect(readOverallConclusion({ schemaVersion: 2 }, "COMPLETED")).toMatchObject({
      overallConclusion: "LEGACY",
      overallConclusionLabel: "旧版记录",
    });
    expect(readOverallConclusion(null, "COMPLETED").overallConclusionLabel).not.toBe(
      "完全一致",
    );
    expect(readOverallConclusion(null, "COMPLETED").overallConclusionLabel).not.toMatch(
      /processing completed|task completed/i,
    );
  });

  it("reads schema 5 overallConclusion for history, result and workbench", () => {
    const result = {
      schemaVersion: 5,
      overallConclusion: "FAIL",
      overallConclusionLabel: "不通过",
      recruiterSummary: { conclusion: "FAIL", passCount: 1, failCount: 2, reviewCount: 0 },
      recruiterTotals: { actualPaidMonthCount: 19, salaryEffectiveMonthCount: 19 },
    };
    expect(readOverallConclusion(result, "COMPLETED")).toMatchObject({
      overallConclusion: "FAIL",
      overallConclusionLabel: "不通过",
      failCount: 2,
      actualPaidMonthCount: 19,
    });
  });
});
