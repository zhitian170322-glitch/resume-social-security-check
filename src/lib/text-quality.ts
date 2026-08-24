export type TextQualityWarning =
  | "possible_two_column"
  | "possible_table_loss"
  | "date_company_alignment_low"
  | "text_order_suspicious"
  | "low_text_density"
  | "ocr_recommended";

export interface TextQualityEvaluatorConfig {
  blankPageMaxCharacters: number;
  shortLineMaxCharacters: number;
  shortLineRatioThreshold: number;
  lowTextDensityCharactersPerLine: number;
  duplicateLineRatioThreshold: number;
  abnormalUnicodeRatioThreshold: number;
  duplicateCharacterRatioThreshold: number;
  minimumRepeatedCharacterRun: number;
  minimumRepeatedChunkLength: number;
  minimumDatesForAlignmentCheck: number;
  adjacentLineAlignmentCredit: number;
  dateCompanyAlignmentThreshold: number;
  minimumLinesForLayoutCheck: number;
  minimumDatesForTableCheck: number;
  fragmentedStructuredLineRatioThreshold: number;
  alternatingStructuredLineRatioThreshold: number;
  wideGapMinSpaces: number;
  wideGapLineRatioThreshold: number;
  orderAnomalyThreshold: number;
  chronologyDirectionChangeRatioThreshold: number;
  penaltyBlankPage: number;
  penaltyLowTextDensity: number;
  penaltyShortLines: number;
  penaltyDuplicateLines: number;
  penaltyDateCompanyAlignment: number;
  penaltyTwoColumn: number;
  penaltyTableLoss: number;
  penaltyTextOrder: number;
  penaltyDuplicateCharacters: number;
  penaltyAbnormalUnicode: number;
  ocrScoreThreshold: number;
  ocrWarningCountThreshold: number;
}

export const DEFAULT_TEXT_QUALITY_CONFIG: Readonly<TextQualityEvaluatorConfig> =
  Object.freeze({
    blankPageMaxCharacters: 0,
    shortLineMaxCharacters: 8,
    shortLineRatioThreshold: 0.7,
    lowTextDensityCharactersPerLine: 3,
    duplicateLineRatioThreshold: 0.2,
    abnormalUnicodeRatioThreshold: 0.01,
    duplicateCharacterRatioThreshold: 0.08,
    minimumRepeatedCharacterRun: 2,
    minimumRepeatedChunkLength: 2,
    minimumDatesForAlignmentCheck: 2,
    adjacentLineAlignmentCredit: 0.5,
    dateCompanyAlignmentThreshold: 0.7,
    minimumLinesForLayoutCheck: 4,
    minimumDatesForTableCheck: 2,
    fragmentedStructuredLineRatioThreshold: 0.7,
    alternatingStructuredLineRatioThreshold: 0.65,
    wideGapMinSpaces: 2,
    wideGapLineRatioThreshold: 0.5,
    orderAnomalyThreshold: 0.65,
    chronologyDirectionChangeRatioThreshold: 0.5,
    penaltyBlankPage: 80,
    penaltyLowTextDensity: 20,
    penaltyShortLines: 8,
    penaltyDuplicateLines: 12,
    penaltyDateCompanyAlignment: 12,
    penaltyTwoColumn: 15,
    penaltyTableLoss: 14,
    penaltyTextOrder: 16,
    penaltyDuplicateCharacters: 12,
    penaltyAbnormalUnicode: 12,
    ocrScoreThreshold: 60,
    ocrWarningCountThreshold: 3,
  });

export interface TextQualityMetrics {
  characterCount: number;
  chineseCharacterCount: number;
  englishCharacterCount: number;
  digitCount: number;
  chineseRatio: number;
  englishRatio: number;
  digitRatio: number;
  lineCount: number;
  nonEmptyLineCount: number;
  shortLineRatio: number;
  duplicateLineCount: number;
  duplicateLineRatio: number;
  dateCount: number;
  companyCount: number;
  dateCompanyAlignmentRatio: number;
  twoColumnRisk: number;
  tableLossRisk: number;
  duplicateCharacterRatio: number;
  abnormalUnicodeCount: number;
  abnormalUnicodeRatio: number;
  orderAnomaly: number;
  textDensity: number;
  blankPage: boolean;
}

export interface TextQualityResult {
  score: number;
  warnings: TextQualityWarning[];
  ocrRecommended: boolean;
  metrics: TextQualityMetrics;
}

const DATE_PATTERN =
  /(?:19|20)\d{2}(?:\s*[./年-]\s*(?:0?[1-9]|1[0-2])(?:\s*月)?|\s*年)/g;
const COMPANY_PATTERN =
  /(?:公司|集团|有限责任|股份有限|企业|银行|事务所|研究院|中心|厂|corporation|company|corp\.?|ltd\.?|limited|inc\.?)/i;
const CHINESE_PATTERN = /\p{Script=Han}/u;
const ENGLISH_PATTERN = /[A-Za-z]/;
const DIGIT_PATTERN = /\d/;
const ABNORMAL_UNICODE_PATTERN =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200B-\u200D\u2060\uFEFF\uFFFD\uE000-\uF8FF]/u;

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

function countDates(value: string): number {
  return value.match(DATE_PATTERN)?.length ?? 0;
}

function lineKind(line: string): "date" | "company" | "both" | "other" {
  const hasDate = countDates(line) > 0;
  const hasCompany = COMPANY_PATTERN.test(line);
  if (hasDate && hasCompany) return "both";
  if (hasDate) return "date";
  if (hasCompany) return "company";
  return "other";
}

function repeatedCharacterCount(
  text: string,
  minimumRun: number,
  minimumChunkLength: number,
): number {
  const characters = Array.from(text);
  let repeated = 0;
  let runLength = 1;
  for (let index = 1; index <= characters.length; index += 1) {
    if (characters[index] === characters[index - 1]) {
      runLength += 1;
    } else {
      if (runLength >= minimumRun) repeated += runLength - 1;
      runLength = 1;
    }
  }

  // PDF extraction sometimes overlays a whole text run, producing "wordword".
  for (const line of text.split("\n")) {
    const compact = Array.from(line.replace(/\s/gu, ""));
    if (
      compact.length >= minimumChunkLength * 2 &&
      compact.length % 2 === 0
    ) {
      const middle = compact.length / 2;
      if (
        compact.slice(0, middle).join("") === compact.slice(middle).join("")
      ) {
        repeated += middle;
      }
    }
  }
  return Math.min(repeated, characters.length);
}

function parseDateOrder(lines: string[]): number[] {
  const values: number[] = [];
  for (const line of lines) {
    for (const match of line.matchAll(DATE_PATTERN)) {
      const parts = match[0].match(/\d+/g) ?? [];
      const year = Number(parts[0]);
      const month = Number(parts[1] ?? 1);
      values.push(year * 12 + month);
    }
  }
  return values;
}

export class TextQualityEvaluator {
  readonly config: Readonly<TextQualityEvaluatorConfig>;

  constructor(config: Partial<TextQualityEvaluatorConfig> = {}) {
    this.config = Object.freeze({
      ...DEFAULT_TEXT_QUALITY_CONFIG,
      ...config,
    });
  }

  evaluate(text: string): TextQualityResult {
    const normalized = text.replace(/\r\n?/g, "\n");
    const allLines = normalized.split("\n");
    const lines = allLines.map((line) => line.trim()).filter(Boolean);
    const visibleCharacters = Array.from(normalized).filter(
      (character) => !/\s/u.test(character),
    );
    const characterCount = visibleCharacters.length;
    const chineseCharacterCount = visibleCharacters.filter((character) =>
      CHINESE_PATTERN.test(character),
    ).length;
    const englishCharacterCount = visibleCharacters.filter((character) =>
      ENGLISH_PATTERN.test(character),
    ).length;
    const digitCount = visibleCharacters.filter((character) =>
      DIGIT_PATTERN.test(character),
    ).length;
    const shortLineRatio = ratio(
      lines.filter(
        (line) =>
          Array.from(line.replace(/\s/gu, "")).length <=
          this.config.shortLineMaxCharacters,
      ).length,
      lines.length,
    );

    const lineOccurrences = new Map<string, number>();
    for (const line of lines) {
      lineOccurrences.set(line, (lineOccurrences.get(line) ?? 0) + 1);
    }
    const duplicateLineCount = [...lineOccurrences.values()].reduce(
      (total, occurrences) => total + Math.max(occurrences - 1, 0),
      0,
    );
    const duplicateLineRatio = ratio(duplicateLineCount, lines.length);

    const kinds = lines.map(lineKind);
    const dateCount = lines.reduce(
      (total, line) => total + countDates(line),
      0,
    );
    const companyCount = kinds.filter(
      (kind) => kind === "company" || kind === "both",
    ).length;
    const dateLineIndexes = kinds.flatMap((kind, index) =>
      kind === "date" || kind === "both" ? [index] : [],
    );
    const alignmentTotal = dateLineIndexes.reduce((total, index) => {
      if (kinds[index] === "both") return total + 1;
      const adjacentCompany =
        kinds[index - 1] === "company" || kinds[index + 1] === "company";
      return total + (adjacentCompany ? this.config.adjacentLineAlignmentCredit : 0);
    }, 0);
    const dateCompanyAlignmentRatio = ratio(
      alignmentTotal,
      dateLineIndexes.length,
    );

    const structuredKinds = kinds.filter(
      (kind) => kind === "date" || kind === "company",
    );
    const fragmentedStructuredLineRatio = ratio(
      structuredKinds.length,
      lines.length,
    );
    let alternatingTransitions = 0;
    for (let index = 1; index < structuredKinds.length; index += 1) {
      if (structuredKinds[index] !== structuredKinds[index - 1]) {
        alternatingTransitions += 1;
      }
    }
    const alternatingStructuredLineRatio = ratio(
      alternatingTransitions,
      Math.max(structuredKinds.length - 1, 0),
    );
    const wideGapPattern = new RegExp(
      `\\s{${this.config.wideGapMinSpaces},}`,
    );
    const wideGapLineRatio = ratio(
      lines.filter((line) => wideGapPattern.test(line)).length,
      lines.length,
    );
    const fragmentedLayout =
      lines.length >= this.config.minimumLinesForLayoutCheck &&
      fragmentedStructuredLineRatio >=
        this.config.fragmentedStructuredLineRatioThreshold &&
      alternatingStructuredLineRatio >=
        this.config.alternatingStructuredLineRatioThreshold;
    const twoColumnRisk = Math.max(
      fragmentedLayout ? alternatingStructuredLineRatio : 0,
      wideGapLineRatio,
    );
    const tableLossRisk =
      dateCount >= this.config.minimumDatesForTableCheck
        ? fragmentedStructuredLineRatio
        : 0;

    const dateOrder = parseDateOrder(lines);
    const directions: number[] = [];
    for (let index = 1; index < dateOrder.length; index += 1) {
      const direction = Math.sign(dateOrder[index] - dateOrder[index - 1]);
      if (direction !== 0) directions.push(direction);
    }
    let directionChanges = 0;
    for (let index = 1; index < directions.length; index += 1) {
      if (directions[index] !== directions[index - 1]) directionChanges += 1;
    }
    const chronologyAnomaly = ratio(
      directionChanges,
      Math.max(directions.length - 1, 0),
    );
    const orderAnomaly = Math.max(
      fragmentedLayout ? alternatingStructuredLineRatio : 0,
      chronologyAnomaly >=
        this.config.chronologyDirectionChangeRatioThreshold
        ? chronologyAnomaly
        : 0,
    );

    const duplicateCharacterCount = repeatedCharacterCount(
      normalized,
      this.config.minimumRepeatedCharacterRun,
      this.config.minimumRepeatedChunkLength,
    );
    const duplicateCharacterRatio = ratio(
      duplicateCharacterCount,
      characterCount,
    );
    const abnormalUnicodeCount = Array.from(normalized).filter((character) =>
      ABNORMAL_UNICODE_PATTERN.test(character),
    ).length;
    const abnormalUnicodeRatio = ratio(
      abnormalUnicodeCount,
      Math.max(Array.from(normalized).length, characterCount),
    );
    const textDensity = ratio(characterCount, lines.length);
    const blankPage = characterCount <= this.config.blankPageMaxCharacters;

    const possibleTwoColumn =
      twoColumnRisk >= this.config.wideGapLineRatioThreshold ||
      fragmentedLayout;
    const possibleTableLoss =
      dateCount >= this.config.minimumDatesForTableCheck &&
      tableLossRisk >= this.config.fragmentedStructuredLineRatioThreshold;
    const alignmentLow =
      dateCount >= this.config.minimumDatesForAlignmentCheck &&
      dateCompanyAlignmentRatio < this.config.dateCompanyAlignmentThreshold;
    const textOrderSuspicious =
      orderAnomaly >= this.config.orderAnomalyThreshold;
    const lowTextDensity =
      blankPage ||
      (lines.length > 0 &&
        textDensity < this.config.lowTextDensityCharactersPerLine);

    const warnings: TextQualityWarning[] = [];
    if (possibleTwoColumn) warnings.push("possible_two_column");
    if (possibleTableLoss) warnings.push("possible_table_loss");
    if (alignmentLow) warnings.push("date_company_alignment_low");
    if (textOrderSuspicious) warnings.push("text_order_suspicious");
    if (lowTextDensity) warnings.push("low_text_density");

    let score = 100;
    if (blankPage) score -= this.config.penaltyBlankPage;
    if (lowTextDensity) score -= this.config.penaltyLowTextDensity;
    if (shortLineRatio >= this.config.shortLineRatioThreshold) {
      score -= this.config.penaltyShortLines;
    }
    if (duplicateLineRatio >= this.config.duplicateLineRatioThreshold) {
      score -= this.config.penaltyDuplicateLines;
    }
    if (alignmentLow) score -= this.config.penaltyDateCompanyAlignment;
    if (possibleTwoColumn) score -= this.config.penaltyTwoColumn;
    if (possibleTableLoss) score -= this.config.penaltyTableLoss;
    if (textOrderSuspicious) score -= this.config.penaltyTextOrder;
    if (
      duplicateCharacterRatio >=
      this.config.duplicateCharacterRatioThreshold
    ) {
      score -= this.config.penaltyDuplicateCharacters;
    }
    if (abnormalUnicodeRatio >= this.config.abnormalUnicodeRatioThreshold) {
      score -= this.config.penaltyAbnormalUnicode;
    }
    score = Math.max(0, Math.min(100, Math.round(score)));

    const ocrRecommended =
      blankPage ||
      score <= this.config.ocrScoreThreshold ||
      warnings.length >= this.config.ocrWarningCountThreshold;
    if (ocrRecommended) warnings.push("ocr_recommended");

    return {
      score,
      warnings,
      ocrRecommended,
      metrics: {
        characterCount,
        chineseCharacterCount,
        englishCharacterCount,
        digitCount,
        chineseRatio: ratio(chineseCharacterCount, characterCount),
        englishRatio: ratio(englishCharacterCount, characterCount),
        digitRatio: ratio(digitCount, characterCount),
        lineCount: allLines.length,
        nonEmptyLineCount: lines.length,
        shortLineRatio,
        duplicateLineCount,
        duplicateLineRatio,
        dateCount,
        companyCount,
        dateCompanyAlignmentRatio,
        twoColumnRisk,
        tableLossRisk,
        duplicateCharacterRatio,
        abnormalUnicodeCount,
        abnormalUnicodeRatio,
        orderAnomaly,
        textDensity,
        blankPage,
      },
    };
  }
}

export function evaluateTextQuality(
  text: string,
  config: Partial<TextQualityEvaluatorConfig> = {},
): TextQualityResult {
  return new TextQualityEvaluator(config).evaluate(text);
}
