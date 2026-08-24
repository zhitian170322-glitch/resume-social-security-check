import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { config } from "../src/lib/config";
import { analyzePdf } from "../src/lib/document-processor";
import { TextQualityEvaluator } from "../src/lib/text-quality";

type FixtureExpectation = "SAFE" | "REVIEW";
type DocumentClassification =
  | "SAFE_PDF_TEXT"
  | "OCR_RECOMMENDED"
  | "OCR_REQUIRED"
  | "MANUAL_REVIEW_REQUIRED";
type NextAction =
  | "USE_PDF_TEXT"
  | "HYBRID_REQUIRED"
  | "OCR_RECOMMENDED"
  | "OCR_REQUIRED"
  | "MANUAL_REVIEW_REQUIRED";

type CalibrationManifest = {
  fixtures: Array<{
    fixtureName: string;
    path: string;
    fixtureType: string;
    expectedDisposition: FixtureExpectation;
  }>;
};

const manifestPath = process.env.REAL_PDF_CALIBRATION_MANIFEST;
const calibration = manifestPath ? describe : describe.skip;

function classifyPage(input: {
  textAvailable: boolean;
  qualityLevel: "HIGH" | "MEDIUM" | "LOW";
  ocrRecommended: boolean;
  warnings: string[];
}): {
  extractionMethod: "PDF_TEXT" | "MANUAL_REQUIRED";
  nextAction: NextAction;
  classification: DocumentClassification;
} {
  if (!input.textAvailable) {
    return {
      extractionMethod: "MANUAL_REQUIRED",
      nextAction: "OCR_REQUIRED",
      classification: "OCR_REQUIRED",
    };
  }
  if (
    input.warnings.includes("suspicious_two_column_order") ||
    input.warnings.includes("possible_table_structure_loss")
  ) {
    return {
      extractionMethod: "PDF_TEXT",
      nextAction: "HYBRID_REQUIRED",
      classification: "OCR_RECOMMENDED",
    };
  }
  if (input.qualityLevel === "LOW") {
    return {
      extractionMethod: "MANUAL_REQUIRED",
      nextAction: "OCR_REQUIRED",
      classification: "OCR_REQUIRED",
    };
  }
  if (input.ocrRecommended || input.qualityLevel === "MEDIUM") {
    return {
      extractionMethod: "PDF_TEXT",
      nextAction: "OCR_RECOMMENDED",
      classification: "OCR_RECOMMENDED",
    };
  }
  return {
    extractionMethod: "PDF_TEXT",
    nextAction: "USE_PDF_TEXT",
    classification: "SAFE_PDF_TEXT",
  };
}

calibration("real PDF extraction calibration", () => {
  it("runs Poppler and the quality gate against external, untracked fixtures", async () => {
    const manifest = JSON.parse(
      await readFile(manifestPath!, "utf8"),
    ) as CalibrationManifest;
    expect(manifest.fixtures.length).toBeGreaterThanOrEqual(6);

    const evaluator = new TextQualityEvaluator({
      highQualityScoreThreshold: config.TEXT_QUALITY_MIN_SCORE,
      ocrScoreThreshold: config.TEXT_QUALITY_MIN_SCORE,
    });
    const classificationSeverity: Record<DocumentClassification, number> = {
      SAFE_PDF_TEXT: 0,
      OCR_RECOMMENDED: 1,
      OCR_REQUIRED: 2,
      MANUAL_REVIEW_REQUIRED: 3,
    };
    const reports = [];
    let falseSafeCount = 0;
    let falseRejectCount = 0;

    for (const fixture of manifest.fixtures) {
      const extracted = await analyzePdf(fixture.path);
      const pages = extracted.pages.map((page) => {
        const quality = evaluator.evaluate(page.localText ?? "");
        const decision = classifyPage({
          textAvailable: page.localText !== null,
          qualityLevel: quality.qualityLevel,
          ocrRecommended: quality.ocrRecommended,
          warnings: quality.warnings,
        });
        return {
          pageNumber: page.page,
          textLength: page.localText?.length ?? 0,
          qualityScore: quality.score,
          warnings: quality.warnings,
          calibrationMetrics: {
            shortLineRatio: quality.metrics.shortLineRatio,
            dateCount: quality.metrics.dateCount,
            dateCompanyAlignmentRatio:
              quality.metrics.dateCompanyAlignmentRatio,
            twoColumnRisk: quality.metrics.twoColumnRisk,
            tableLossRisk: quality.metrics.tableLossRisk,
            orderAnomaly: quality.metrics.orderAnomaly,
            textDensity: quality.metrics.textDensity,
          },
          extractionMethod: decision.extractionMethod,
          nextAction: decision.nextAction,
          classification: decision.classification,
        };
      });
      const documentClassification = pages.reduce<DocumentClassification>(
        (current, page) =>
          classificationSeverity[page.classification] >
          classificationSeverity[current]
            ? page.classification
            : current,
        "SAFE_PDF_TEXT",
      );
      if (
        fixture.expectedDisposition === "REVIEW" &&
        documentClassification === "SAFE_PDF_TEXT"
      ) {
        falseSafeCount += 1;
      }
      if (
        fixture.expectedDisposition === "SAFE" &&
        ["OCR_REQUIRED", "MANUAL_REVIEW_REQUIRED"].includes(
          documentClassification,
        )
      ) {
        falseRejectCount += 1;
      }
      reports.push({
        fixtureName: fixture.fixtureName,
        fixtureType: fixture.fixtureType,
        pageCount: pages.length,
        pages,
        documentClassification,
      });
    }

    const summary = {
      fixtureCount: reports.length,
      reports,
      falseSafeCount,
      falseRejectCount,
    };
    console.info(`REAL_PDF_CALIBRATION=${JSON.stringify(summary)}`);
    expect(falseSafeCount).toBe(0);
    expect(falseRejectCount).toBe(0);
  });
});
