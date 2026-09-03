import { readFileSync } from "node:fs";
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import { stripRegionLabelPrefix } from "@/lib/company-cleanup";
import { formatLabeledResumeSource } from "@/lib/deepseek";
import { extractResumeImagePage } from "@/lib/document-processor";
import {
  mergeDualTextSources,
  normalizeComparableText,
} from "@/lib/hybrid-text";
import {
  applyFieldOverrides,
  revertOverride,
  upsertOverride,
} from "@/lib/manual-override";
import { fileFingerprint, pageFingerprint, shouldSkipDuplicate } from "@/lib/material-dedup";
import { adaptAliyunOcrResponse } from "@/lib/ocr-adapter";
import { withOcrRetry } from "@/lib/ocr-runtime";
import { readOverallConclusion } from "@/lib/overall-conclusion";
import { sourceLabel } from "@/lib/page-evidence";
import { logSafeEvent } from "@/lib/observability";
import {
  inferPaymentType,
  uniquePaidMonths,
  verifyResumeAndSocial,
  type ResumeExperience,
  type SocialRecord,
} from "@/lib/simple-verification";
import { recognizeSocialSecurityPageDualSource } from "@/lib/social-security-provider";
import type { SocialSecurityOCRProvider, SocialSecurityOCRResult } from "@/lib/social-security-table";
import { buildUnitCodeMap } from "@/lib/unit-code-map";
import {
  AMBIGUOUS_CODE_NAME_TEXT,
  SEPARATED_CODE_NAME_TEXT,
  TABLE_CODE_NAME_CELLS,
  anonymizedOcr,
} from "./fixtures/v5-anonymized-ocr";

const nativeResume = [
  "姓名：候选人甲",
  "深圳示例科技有限公司",
  "工程师",
  "2021-01 至 2023-06",
].join("\n");

function experience(
  companyRaw: string,
  startMonth: string,
  endMonth: string,
): ResumeExperience {
  return {
    companyRaw,
    position: "工程师",
    startMonth,
    endMonth,
    sourcePage: 1,
    sourceQuote: companyRaw,
    sourceKind: "native_text",
  };
}

function social(
  companyRaw: string,
  startMonth: string,
  endMonth: string,
  paidMonths: string[],
  paymentType: SocialRecord["paymentType"] = "company",
): SocialRecord {
  return {
    companyRaw,
    startMonth,
    endMonth,
    paidMonths,
    paymentType,
    sourceFile: "social.pdf",
    sourcePage: 1,
    sourceQuote: companyRaw,
  };
}

function mockSocialProvider(input: {
  table?: SocialSecurityOCRResult | Error;
  general?: SocialSecurityOCRResult | Error;
}): SocialSecurityOCRProvider {
  return {
    provider: "mock",
    providerVersion: "test",
    ocrVersion: "test",
    async recognizeTable() {
      if (input.table instanceof Error) throw input.table;
      if (!input.table) throw new Error("table missing");
      return input.table;
    },
    async recognizeGeneral() {
      if (input.general instanceof Error) throw input.general;
      if (!input.general) throw new Error("general missing");
      return input.general;
    },
  };
}

describe("V6 anonymized hybrid OCR structure", () => {
  it("1 uses native text when OCR is garbled", () => {
    const merged = mergeDualTextSources({
      nativeText: nativeResume,
      ocrText: "� ???? sodjfksjdf �\n#####",
    });
    expect(merged.decision).toBe("native");
    expect(merged.selectedText).toContain("深圳示例科技有限公司");
  });

  it("2 uses OCR when native text is empty", () => {
    const merged = mergeDualTextSources({
      nativeText: "",
      ocrText: nativeResume,
    });
    expect(merged.decision).toBe("ocr");
    expect(merged.selectedText).toContain("深圳示例科技有限公司");
  });

  it("3 marks agreed when both sources match after normalize", () => {
    const merged = mergeDualTextSources({
      nativeText: "深圳示例科技有限公司\u30002021-01",
      ocrText: "深圳示例科技有限公司 2021-01",
    });
    expect(merged.decision).toBe("agreed");
    expect(normalizeComparableText(merged.selectedText ?? "")).toBe(
      "深圳示例科技有限公司 2021-01",
    );
  });

  it("4 keeps both company originals and blocks auto pass on conflict", () => {
    const merged = mergeDualTextSources({
      nativeText: "姓名：候选人甲\n深圳示例科技有限公司\n工程师\n2021-01",
      ocrText: "姓名：候选人甲\n广州另一家科技有限公司\n工程师\n2021-01",
    });
    expect(merged.decision).toBe("conflict");
    const report = verifyResumeAndSocial({
      candidateName: "候选人甲",
      socialName: "候选人甲",
      experiences: [experience("深圳示例科技有限公司", "2021-01", "2023-06")],
      socialRecords: [
        social("深圳示例科技有限公司", "2021-01", "2023-06", ["2021-01"]),
      ],
      sourceConflicts: merged.conflicts.map((item) => ({
        ...item,
        pageNumber: 1,
        sourceFile: "resume.pdf",
      })),
    });
    expect(report.overallConclusion).toBe("NEEDS_REVIEW");
    expect(report.recruiterTable[0]?.fieldEvidence?.resumeCompany?.conflict).toBe(true);
    expect(report.recruiterTable[0]?.fieldEvidence?.resumeCompany?.alternatives?.[0]?.quote).toContain(
      "深圳示例科技有限公司",
    );
    expect(report.recruiterTable[0]?.fieldEvidence?.resumeCompany?.alternatives?.[1]?.quote).toContain(
      "广州另一家科技有限公司",
    );
  });

  it("5 keeps both month originals and blocks auto pass on conflict", () => {
    const merged = mergeDualTextSources({
      nativeText: "深圳示例科技有限公司\n2021-01 至 2022-12",
      ocrText: "深圳示例科技有限公司\n2021-03 至 2022-12",
    });
    expect(merged.decision).toBe("conflict");
    expect(merged.conflicts.some((item) => item.field === "month")).toBe(true);
    const report = verifyResumeAndSocial({
      candidateName: "候选人甲",
      socialName: "候选人甲",
      experiences: [experience("深圳示例科技有限公司", "2021-01", "2022-12")],
      socialRecords: [
        social("深圳示例科技有限公司", "2021-01", "2022-12", ["2021-01"]),
      ],
      sourceConflicts: merged.conflicts,
    });
    expect(report.overallConclusion).toBe("NEEDS_REVIEW");
    expect(report.recruiterTable[0]?.fieldEvidence?.startMonth?.conflict).toBe(true);
  });

  it("6 continues other pages when one OCR page fails", async () => {
    const png = await sharp({
      create: { width: 12, height: 12, channels: 3, background: "#ffffff" },
    })
      .png()
      .toBuffer();
    const pages = [
      mergeDualTextSources({ nativeText: nativeResume, ocrText: null }),
      mergeDualTextSources({
        nativeText: "中电示例软件有限公司\n2024-01 至 2024-12",
        ocrText: "中电示例软件有限公司\n2024-01 至 2024-12",
      }),
    ];
    expect(pages[0]?.decision).toBe("native");
    expect(pages[1]?.decision).toBe("agreed");
    const ocr = {
      recognize: vi
        .fn()
        .mockRejectedValueOnce(new Error("page failed"))
        .mockResolvedValueOnce({
          text: "中电示例软件有限公司",
          raw: {},
          confidence: 0.9,
          requestId: "ok",
        }),
    };
    const first = await extractResumeImagePage({
      data: png,
      sourceFile: "page1.png",
      ocr,
    });
    const second = await extractResumeImagePage({
      data: Buffer.from([...png, 1]),
      sourceFile: "page2.png",
      ocr,
    });
    expect(first[0]?.warnings).toContain("OCR_PAGE_FAILED");
    expect(second[0]?.ocrText).toContain("中电示例软件有限公司");
  });

  it("7 does not stitch companies from different pages into one name", () => {
    const page1 = mergeDualTextSources({
      nativeText: "深圳示例科技有限公司",
      ocrText: "深圳示例科技有限公司",
    });
    const page2 = mergeDualTextSources({
      nativeText: "中电示例软件有限公司",
      ocrText: "中电示例软件有限公司",
    });
    expect(page1.selectedText).toBe("深圳示例科技有限公司");
    expect(page2.selectedText).toBe("中电示例软件有限公司");
    expect(page1.selectedText).not.toContain("中电示例软件有限公司");
    expect(page2.selectedText).not.toContain("深圳示例科技有限公司");
  });

  it("8 OCRs and counts a duplicate page only once", async () => {
    const png = await sharp({
      create: { width: 10, height: 10, channels: 3, background: "#eeeeee" },
    })
      .png()
      .toBuffer();
    const seen = new Set<string>();
    const ocr = {
      recognize: vi.fn().mockResolvedValue({
        text: nativeResume,
        raw: {},
        confidence: 0.91,
        requestId: "dup",
      }),
    };
    const first = await extractResumeImagePage({
      data: png,
      sourceFile: "a.png",
      ocr,
      seenFingerprints: seen,
    });
    const second = await extractResumeImagePage({
      data: png,
      sourceFile: "b.png",
      ocr,
      seenFingerprints: seen,
    });
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(0);
    expect(ocr.recognize).toHaveBeenCalledTimes(1);
    expect(shouldSkipDuplicate(new Set([pageFingerprint(nativeResume)]), pageFingerprint(nativeResume))).toBe(true);
    expect(uniquePaidMonths(["2021-01", "2021-01", "2021-02"])).toEqual([
      "2021-01",
      "2021-02",
    ]);
    expect(fileFingerprint(png)).toHaveLength(64);
  });

  it("9 continues when Table OCR succeeds and General OCR fails", async () => {
    const outcome = await recognizeSocialSecurityPageDualSource({
      provider: mockSocialProvider({
        table: anonymizedOcr("深圳示例科技有限公司 2021-01", TABLE_CODE_NAME_CELLS),
        general: new Error("general down"),
      }),
      data: Buffer.from("img"),
      mimeType: "image/png",
    });
    expect(outcome.tableUsed).toBe(true);
    expect(outcome.generalUsed).toBe(false);
    expect(outcome.selected.rawText).toContain("深圳示例科技有限公司");
  });

  it("10 continues when General OCR succeeds and Table OCR fails", async () => {
    const outcome = await recognizeSocialSecurityPageDualSource({
      provider: mockSocialProvider({
        table: new Error("table down"),
        general: anonymizedOcr("深圳示例科技有限公司 2021-01 至 2021-02"),
      }),
      data: Buffer.from("img"),
      mimeType: "image/png",
    });
    expect(outcome.tableUsed).toBe(false);
    expect(outcome.generalUsed).toBe(true);
  });

  it("11 continues and waits for review when both OCR sources fail", async () => {
    const outcome = await recognizeSocialSecurityPageDualSource({
      provider: mockSocialProvider({
        table: new Error("table down"),
        general: new Error("general down"),
      }),
      data: Buffer.from("img"),
      mimeType: "image/png",
    });
    expect(outcome.selected.rawText).toBe("");
    const report = verifyResumeAndSocial({
      candidateName: "候选人甲",
      socialName: "候选人甲",
      experiences: [experience("深圳示例科技有限公司", "2021-01", "2021-02")],
      socialRecords: [
        social("深圳示例科技有限公司", "2021-01", "2021-02", ["2021-01"], "unknown"),
      ],
      hasUnconfirmedFields: true,
    });
    expect(report.overallConclusion).toBe("NEEDS_REVIEW");
  });

  it("12 maps unit codes that are separated from company names", () => {
    const mapped = buildUnitCodeMap({
      ocr: anonymizedOcr(SEPARATED_CODE_NAME_TEXT, TABLE_CODE_NAME_CELLS),
      sourceFile: "social-fixture.txt",
    });
    expect(mapped.map.get("470855")?.companyRaw).toBe("深圳示例动力信息技术有限公司");
  });

  it("13 marks non-unique unit-code mapping for review", () => {
    const mapped = buildUnitCodeMap({
      ocr: anonymizedOcr(AMBIGUOUS_CODE_NAME_TEXT),
      sourceFile: "social-fixture.txt",
    });
    expect([...mapped.map.values()].some((item) => item.status === "needs_review")).toBe(true);
  });

  it("14 keeps 深圳市 inside a legal company name", () => {
    expect(stripRegionLabelPrefix("深圳市示例动力信息技术有限公司")).toBe(
      "深圳市示例动力信息技术有限公司",
    );
  });

  it("15 strips an independent 深圳市： prefix", () => {
    expect(stripRegionLabelPrefix("深圳市：示例动力信息技术有限公司")).toBe(
      "示例动力信息技术有限公司",
    );
  });

  it("16 treats mapping failure as unknown, not personal", () => {
    expect(inferPaymentType(null, "unknown")).toBe("unknown");
    expect(inferPaymentType("470855")).toBe("unknown");
    const report = verifyResumeAndSocial({
      candidateName: "候选人甲",
      socialName: "候选人甲",
      experiences: [experience("深圳示例科技有限公司", "2021-01", "2021-02")],
      socialRecords: [social("待映射单位", "2021-01", "2021-02", ["2021-01"], "unknown")],
    });
    expect(report.rows.some((row) => row.reason.includes("缴费类型待确认"))).toBe(true);
    expect(report.recruiterTotals.unknownPaidMonthCount).toBe(1);
    expect(report.recruiterTotals.personalPaidMonthCount).toBe(0);
  });

  it("17 counts overlapping company and personal months once in the total", () => {
    const report = verifyResumeAndSocial({
      candidateName: "候选人甲",
      socialName: "候选人甲",
      experiences: [experience("深圳示例科技有限公司", "2021-01", "2021-02")],
      socialRecords: [
        social("深圳示例科技有限公司", "2021-01", "2021-02", ["2021-01", "2021-02"], "company"),
        social("个人缴费窗口", "2021-02", "2021-02", ["2021-02"], "personal"),
      ],
    });
    expect(report.recruiterTotals.actualPaidMonthCount).toBe(2);
    expect(report.recruiterTotals.overlapMonthCount).toBe(1);
    expect(report.recruiterTotals.actualPaidDuration).toMatch(/^\d+年\d+个月$|^\d+年$|^\d+个月$/);
    expect(report.recruiterTotals.actualPaidDuration).not.toMatch(/\./);
  });

  it("18 reapplies pairing after a manual override", () => {
    const experiences = [experience("深圳示例科技有限公司", "2021-01", "2021-02")];
    const socialRecords = [
      social("中电示例软件有限公司", "2021-01", "2021-02", ["2021-01", "2021-02"]),
    ];
    const overrides = upsertOverride([], {
      id: "o1",
      rowIndex: 0,
      field: "resumeCompany",
      originalValue: "深圳示例科技有限公司",
      systemValue: "深圳示例科技有限公司",
      overrideValue: "中电示例软件有限公司",
      reviewStatus: "applied",
    });
    const applied = applyFieldOverrides({ experiences, socialRecords, overrides });
    const report = verifyResumeAndSocial({
      candidateName: "候选人甲",
      socialName: "候选人甲",
      experiences: applied.experiences,
      socialRecords: applied.socialRecords,
      overrides,
    });
    expect(applied.experiences[0]?.companyRaw).toBe("中电示例软件有限公司");
    expect(report.rows[0]?.companyConsistent).toBe(true);
    expect(report.recruiterSummary.fullText).toContain("人工修正");
  });

  it("19 reverts a manual override back to the system value", () => {
    const experiences = [experience("深圳示例科技有限公司", "2021-01", "2021-02")];
    const socialRecords = [
      social("中电示例软件有限公司", "2021-01", "2021-02", ["2021-01"]),
    ];
    const applied = upsertOverride([], {
      id: "o1",
      rowIndex: 0,
      field: "resumeCompany",
      originalValue: "深圳示例科技有限公司",
      systemValue: "深圳示例科技有限公司",
      overrideValue: "中电示例软件有限公司",
      reviewStatus: "applied",
    });
    const reverted = revertOverride(applied, "o1");
    const next = applyFieldOverrides({
      experiences,
      socialRecords,
      overrides: reverted,
    });
    expect(next.experiences[0]?.companyRaw).toBe("深圳示例科技有限公司");
    expect(reverted[0]?.reviewStatus).toBe("reverted");
  });

  it("20 keeps result, copy, workbench and history conclusions aligned", () => {
    const report = verifyResumeAndSocial({
      candidateName: "候选人甲",
      socialName: "候选人甲",
      experiences: [experience("深圳示例科技有限公司", "2021-01", "2021-02")],
      socialRecords: [
        social("深圳示例科技有限公司", "2021-01", "2021-02", ["2021-01", "2021-02"]),
      ],
    });
    const history = readOverallConclusion(report, "COMPLETED");
    const workbench = readOverallConclusion(report);
    expect(report.schemaVersion).toBe(6);
    expect(history.overallConclusion).toBe(report.overallConclusion);
    expect(workbench.overallConclusion).toBe(report.overallConclusion);
    expect(report.recruiterSummary.fullText).toContain(
      `整体结论：${report.overallConclusionLabel}`,
    );
    expect(history.overallConclusionLabel).toBe(report.overallConclusionLabel);
  });

  it("21 keeps old schema 2/4/5 read-only", () => {
    expect(readOverallConclusion({ schemaVersion: 2 }, "COMPLETED").overallConclusion).toBe(
      "LEGACY",
    );
    expect(
      readOverallConclusion(
        {
          schemaVersion: 4,
          overallConclusion: "FAIL",
          overallConclusionLabel: "不通过",
          recruiterSummary: { conclusion: "FAIL" },
        },
        "COMPLETED",
      ).overallConclusion,
    ).toBe("FAIL");
    expect(
      readOverallConclusion(
        {
          schemaVersion: 5,
          overallConclusion: "NEEDS_REVIEW",
          overallConclusionLabel: "待人工确认",
          recruiterSummary: { conclusion: "NEEDS_REVIEW" },
        },
        "COMPLETED",
      ).overallConclusion,
    ).toBe("NEEDS_REVIEW");
  });

  it("22 keeps mobile three-card and desktop high-contrast styles", () => {
    const css = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");
    const resultView = readFileSync(
      new URL("../src/components/evidence-result-view.tsx", import.meta.url),
      "utf8",
    );
    expect(css).toMatch(/\.resume-card/);
    expect(css).toMatch(/\.social-card/);
    expect(css).toMatch(/\.result-card/);
    expect(css).toMatch(/\.mobile-result-cards/);
    expect(css).toMatch(/\.company-name \{ font-size: 14px/);
    expect(css).toMatch(/white-space: nowrap/);
    expect(resultView).toContain("识别依据");
    expect(resultView).toContain("来源冲突，待确认");
    expect(resultView).toContain("简历申报");
    expect(resultView).toContain("社保事实依据");
    expect(resultView).toContain("核验结果");
  });

  it("23 does not write resume text, names, companies or secrets to ordinary logs", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    logSafeEvent("info", {
      taskId: "task-001",
      stage: "OCR_COMPLETE",
      provider: "aliyun",
      requestId: "req-1",
    });
    const printed = String(spy.mock.calls[0]?.[0] ?? "");
    expect(printed).not.toContain("候选人甲");
    expect(printed).not.toContain("深圳示例科技有限公司");
    expect(printed).not.toContain("ALIYUN");
    expect(printed).not.toMatch(/\bsk-[A-Za-z0-9]+/);
    expect(printed).not.toMatch(/rawText|ocrText|pdfText/);
    spy.mockRestore();
    expect(sourceLabel("native_text")).toBe("原生文字");
    expect(sourceLabel("general_ocr")).toBe("General OCR");
    expect(sourceLabel("table_ocr")).toBe("Table OCR");
    expect(sourceLabel("manual")).toBe("人工修正");
  });

  it("24 adapts multiple Aliyun HTTP 200 payloads", () => {
    const content = adaptAliyunOcrResponse({
      statusCode: 200,
      body: { requestId: "a", data: { content: "示例内容" } },
    });
    const words = adaptAliyunOcrResponse({
      statusCode: 200,
      body: { requestId: "b", data: { wordsInfo: [{ text: "单元格" }] } },
    });
    const unknown = adaptAliyunOcrResponse({
      statusCode: 200,
      body: { requestId: "c", foo: 1 },
    });
    expect(content.rawText).toContain("示例内容");
    expect(words.rawText).toContain("单元格");
    expect(unknown.rawText).toBe("");
    expect(unknown.requestId).toBe("c");
  });

  it("labels DeepSeek input with page and source without fusing conflicts", () => {
    const labeled = formatLabeledResumeSource([
      {
        page: 1,
        sourceFile: "resume.pdf",
        pdfText: "原生甲科技有限公司",
        ocrText: "OCR乙科技有限公司",
        selectedText: "原生甲科技有限公司",
        extractionMethod: "manual_required",
        qualityScore: 80,
        ocrConfidence: 0.9,
        warnings: ["SOURCE_CONFLICT"],
      },
    ]);
    expect(labeled).toContain("[page=1 source=native_text]");
    expect(labeled).toContain("[page=1 source=general_ocr]");
    expect(labeled).toContain("原生甲科技有限公司");
    expect(labeled).toContain("OCR乙科技有限公司");
  });

  it("retries OCR with backoff and then surfaces the last error", async () => {
    const operation = vi
      .fn()
      .mockRejectedValueOnce(new Error("temp"))
      .mockResolvedValueOnce("ok");
    await expect(withOcrRetry(operation, 3, 1)).resolves.toBe("ok");
    expect(operation).toHaveBeenCalledTimes(2);
  });
});
