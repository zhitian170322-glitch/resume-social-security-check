import { describe, expect, it } from "vitest";
import {
  historyRecordFromTask,
  isPendingReview,
  matchesHistorySearch,
} from "./history-search";

const record = {
  id: "t1",
  candidateName: "张三",
  overallConclusion: "NEEDS_REVIEW",
  overallConclusionLabel: "待人工确认",
  reviewStatus: "PENDING",
  resumeCompanies: ["甲科技有限公司"],
  socialCompanies: ["乙科技有限公司"],
  createdAt: "2026-08-01T10:00:00.000Z",
  updatedAt: "2026-08-02T10:00:00.000Z",
  status: "COMPLETED",
};

describe("history search and review queue", () => {
  it("filters by candidate, companies, status and date range", () => {
    expect(matchesHistorySearch(record, { candidateName: "张" })).toBe(true);
    expect(matchesHistorySearch(record, { resumeCompany: "甲科技" })).toBe(true);
    expect(matchesHistorySearch(record, { socialCompany: "乙科技" })).toBe(true);
    expect(matchesHistorySearch(record, { status: "待人工确认" })).toBe(true);
    expect(matchesHistorySearch(record, { from: "2026-08-01", to: "2026-08-01" })).toBe(true);
    expect(matchesHistorySearch(record, { candidateName: "李四" })).toBe(false);
    expect(matchesHistorySearch(record, { from: "2026-08-02" })).toBe(false);
  });

  it("treats pending review as overallConclusion NEEDS_REVIEW, not default reviewStatus", () => {
    expect(isPendingReview(record)).toBe(true);
    expect(isPendingReview({ overallConclusion: "FAIL", reviewStatus: "PENDING" })).toBe(false);
    expect(isPendingReview({ overallConclusion: "PASS", reviewStatus: "PENDING" })).toBe(false);
    expect(isPendingReview({ overallConclusion: "PASS", reviewStatus: "CONFIRMED" })).toBe(false);
    expect(matchesHistorySearch({ ...record, overallConclusion: "FAIL" }, { reviewOnly: true })).toBe(
      false,
    );
    expect(matchesHistorySearch(record, { reviewOnly: true })).toBe(true);
  });

  it("does not infer 完全一致 from a completed legacy task", () => {
    const legacy = historyRecordFromTask({
      id: "old",
      status: "COMPLETED",
      candidate_name: "旧候选人",
      result_json: JSON.stringify({ schemaVersion: 2 }),
      review_status: "PENDING",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-02T00:00:00.000Z",
    });
    expect(legacy.overallConclusionLabel).toBe("旧版记录");
    expect(legacy.overallConclusionLabel).not.toBe("完全一致");
  });
});
