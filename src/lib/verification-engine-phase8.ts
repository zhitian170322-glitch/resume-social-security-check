import {
  Phase8VerificationItemSchema,
  monthIndex,
  type CompanyMatchType,
  type EvidenceMonthField,
  type EvidenceMonthsField,
  type EvidenceNumberField,
  type EvidenceStringField,
  type Phase8MatchStatus,
  type Phase8TaskConclusion,
  type Phase8VerificationItem,
  type ResumeEvidenceExperience,
  type SocialSecurityEvidenceRecord,
  type VerificationEvidenceGateStatus,
  type VerificationV2Status,
} from "./schemas";

export const REAL_FIXTURE_CALIBRATION_PENDING = true as const;
export const REAL_WORLD_CALIBRATION = "PENDING" as const;
export const PRODUCTION_READY = false as const;

type EvidenceField =
  | EvidenceStringField
  | EvidenceMonthField
  | EvidenceMonthsField
  | EvidenceNumberField;

export type Phase8EvidenceGate = {
  resume: VerificationEvidenceGateStatus;
  socialSecurity: VerificationEvidenceGateStatus;
};

export type VerificationV2Item = Phase8VerificationItem & {
  status: VerificationV2Status;
  description: string;
  resume?: ResumeEvidenceExperience;
  socialSecurity?: SocialSecurityEvidenceRecord;
  companyComparison?: {
    rawExactMatch: boolean;
    normalizedCandidateMatch: boolean;
    manualReview: boolean;
  };
  timeline?: {
    startMonthDifference: number | null;
    endMonthDifference: number | null;
    overlapMonths: string[];
    gapMonths: string[];
  };
  rules: string[];
};

export type Phase8VerificationResult = {
  conclusion: Phase8TaskConclusion;
  items: VerificationV2Item[];
};

export type Phase8VerificationInput = {
  evidenceGate: Phase8EvidenceGate;
  resumeExperiences: ResumeEvidenceExperience[];
  socialSecurityRecords: SocialSecurityEvidenceRecord[];
};

export function normalizedCompanyName(rawCompanyName: string) {
  return rawCompanyName
    .normalize("NFKC")
    .toLocaleLowerCase("zh-CN")
    .replace(/[\s（）()·•,，.。\-—_]/g, "")
    .replace(/^(?:深圳市|广东省|广州市)/, "")
    .replace(/(?:有限责任公司|股份有限公司|有限公司)$/, "");
}

function levenshteinDistance(left: string, right: string) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    let diagonal = previous[0];
    previous[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const above = previous[rightIndex];
      previous[rightIndex] = Math.min(
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + 1,
        diagonal +
          (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
      diagonal = above;
    }
  }
  return previous[right.length];
}

export function companySimilarity(leftRaw: string, rightRaw: string) {
  const left = normalizedCompanyName(leftRaw);
  const right = normalizedCompanyName(rightRaw);
  if (!left.length || !right.length) return 0;
  return (
    1 -
    levenshteinDistance(left, right) / Math.max(left.length, right.length)
  );
}

export function classifyCompanyMatch(
  resumeRaw: string,
  socialSecurityRaw: string,
): CompanyMatchType {
  if (resumeRaw === socialSecurityRaw) return "EXACT";
  if (
    normalizedCompanyName(resumeRaw) ===
    normalizedCompanyName(socialSecurityRaw)
  ) {
    return "NORMALIZED_MATCH";
  }
  return companySimilarity(resumeRaw, socialSecurityRaw) >= 0.72
    ? "FUZZY_CANDIDATE"
    : "NO_MATCH";
}

export function monthFromIndex(index: number) {
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

export function monthRange(startMonth: string, endMonth: string) {
  const months: string[] = [];
  for (
    let index = monthIndex(startMonth);
    index <= monthIndex(endMonth);
    index += 1
  ) {
    months.push(monthFromIndex(index));
  }
  return months;
}

function uniqueMonths(months: string[]) {
  return [...new Set(months)].sort(
    (left, right) => monthIndex(left) - monthIndex(right),
  );
}

function difference(left: string[], right: string[]) {
  const rightSet = new Set(right);
  return left.filter((month) => !rightSet.has(month));
}

function fieldRef(field: EvidenceField, name: string) {
  return {
    field: name,
    sourceFile: field.sourceFile,
    sourcePage: field.sourcePage,
    sourceQuote: field.sourceQuote,
    extractionMethod: field.extractionMethod,
  };
}

function evidenceRefs(
  resume?: ResumeEvidenceExperience,
  social?: SocialSecurityEvidenceRecord,
) {
  const refs = [
    ...(resume
      ? [
          fieldRef(resume.resumeCompany, "resumeCompanyRaw"),
          fieldRef(resume.resumeStartMonth, "resumeStartMonth"),
          fieldRef(resume.resumeEndMonth, "resumeEndMonth"),
        ]
      : []),
    ...(social
      ? [
          fieldRef(social.companyRaw, "socialSecurityCompanyRaw"),
          fieldRef(social.startMonth, "socialSecurityStartMonth"),
          fieldRef(social.endMonth, "socialSecurityEndMonth"),
          fieldRef(social.paidMonths, "paidMonths"),
        ]
      : []),
  ];
  const seen = new Set<string>();
  return refs.filter((ref) => {
    const key = [
      ref.field,
      ref.sourceFile,
      ref.sourcePage,
      ref.sourceQuote,
      ref.extractionMethod,
    ].join("\u001f");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function minimumConfidence(
  resume?: ResumeEvidenceExperience,
  social?: SocialSecurityEvidenceRecord,
) {
  const values = [
    ...(resume
      ? [
          resume.resumeCompany.confidence,
          resume.resumeStartMonth.confidence,
          resume.resumeEndMonth.confidence,
        ]
      : []),
    ...(social
      ? [
          social.companyRaw.confidence,
          social.startMonth.confidence,
          social.endMonth.confidence,
          social.paidMonths.confidence,
        ]
      : []),
  ];
  return values.length ? Math.min(...values) : 0;
}

function allFieldsVerified(input: Phase8VerificationInput) {
  const resumeValid = input.resumeExperiences.every(
    (record) =>
      record.resumeCompany.status === "verified" &&
      record.resumeStartMonth.status === "verified" &&
      record.resumeEndMonth.status === "verified" &&
      record.resumeCompany.value !== null &&
      record.resumeStartMonth.value !== null &&
      record.resumeEndMonth.value !== null &&
      record.warnings.length === 0,
  );
  const socialValid = input.socialSecurityRecords.every(
    (record) =>
      [
        record.companyRaw,
        record.startMonth,
        record.endMonth,
        record.paidMonths,
        record.pensionMonths,
        record.injuryMonths,
        record.unemploymentMonths,
      ].every((field) => field.status === "verified" && field.value !== null) &&
      record.warnings.length === 0,
  );
  return resumeValid && socialValid;
}

function legacyStatus(matchStatus: Phase8MatchStatus): VerificationV2Status {
  switch (matchStatus) {
    case "EXACT_MATCH":
      return "EXACT_MATCH";
    case "COMPANY_MISMATCH":
      return "COMPANY_MISMATCH";
    case "START_MONTH_MISMATCH":
    case "END_MONTH_MISMATCH":
    case "PERIOD_MISMATCH":
      return "TIME_MISMATCH";
    case "GAP_DETECTED":
      return "GAP_DETECTED";
    case "RESUME_ONLY":
      return "RESUME_ONLY";
    case "SOCIAL_SECURITY_ONLY":
      return "SOCIAL_SECURITY_ONLY";
    case "PERSONAL_INSURANCE":
      return "PERSONAL_INSURANCE";
    case "INSUFFICIENT_EVIDENCE":
      return "EXTRACTION_UNCERTAIN";
    case "MULTIPLE_COMPANIES_SAME_MONTH":
    case "MANUAL_REVIEW_REQUIRED":
      return "MANUAL_REVIEW_REQUIRED";
  }
}

function makeItem(input: {
  matchStatus: Phase8MatchStatus;
  description: string;
  companyMatchType?: CompanyMatchType | null;
  resume?: ResumeEvidenceExperience;
  social?: SocialSecurityEvidenceRecord;
  warnings?: string[];
  requiresManualReview?: boolean;
  rules: string[];
}): VerificationV2Item {
  const resumePeriod =
    input.resume?.resumeStartMonth.value && input.resume.resumeEndMonth.value
      ? {
          startMonth: input.resume.resumeStartMonth.value,
          endMonth: input.resume.resumeEndMonth.value,
        }
      : null;
  const socialSecurityPeriod =
    input.social?.startMonth.value && input.social.endMonth.value
      ? {
          startMonth: input.social.startMonth.value,
          endMonth: input.social.endMonth.value,
        }
      : null;
  const paidMonths = uniqueMonths(input.social?.paidMonths.value ?? []);
  const resumeMonths = resumePeriod
    ? monthRange(resumePeriod.startMonth, resumePeriod.endMonth)
    : [];
  const socialSpan = socialSecurityPeriod
    ? monthRange(
        socialSecurityPeriod.startMonth,
        socialSecurityPeriod.endMonth,
      )
    : [];
  const companyMatchType = input.companyMatchType ?? null;
  const base: Phase8VerificationItem = {
    matchStatus: input.matchStatus,
    companyMatchType,
    rawResumeCompanyName: input.resume?.resumeCompany.value ?? null,
    rawSocialSecurityCompanyName: input.social?.companyRaw.value ?? null,
    normalizedCompanyName:
      input.resume?.resumeCompany.value && input.social?.companyRaw.value
        ? `${normalizedCompanyName(input.resume.resumeCompany.value)} | ${normalizedCompanyName(input.social.companyRaw.value)}`
        : null,
    resumePeriod,
    socialSecurityPeriod,
    paidMonths,
    missingMonths: difference(resumeMonths, paidMonths),
    extraMonths: difference(paidMonths, resumeMonths),
    gapMonths: difference(socialSpan, paidMonths),
    warnings: uniqueStrings(input.warnings ?? []),
    evidenceRefs: evidenceRefs(input.resume, input.social),
    confidence: minimumConfidence(input.resume, input.social),
    requiresManualReview: input.requiresManualReview ?? false,
  };
  Phase8VerificationItemSchema.parse(base);
  const startMonthDifference =
    resumePeriod && socialSecurityPeriod
      ? monthIndex(resumePeriod.startMonth) -
        monthIndex(socialSecurityPeriod.startMonth)
      : null;
  const endMonthDifference =
    resumePeriod && socialSecurityPeriod
      ? monthIndex(resumePeriod.endMonth) -
        monthIndex(socialSecurityPeriod.endMonth)
      : null;
  return {
    ...base,
    status: legacyStatus(input.matchStatus),
    description: input.description,
    resume: input.resume,
    socialSecurity: input.social,
    companyComparison:
      companyMatchType && input.resume && input.social
        ? {
            rawExactMatch: companyMatchType === "EXACT",
            normalizedCandidateMatch:
              companyMatchType === "EXACT" ||
              companyMatchType === "NORMALIZED_MATCH",
            manualReview:
              companyMatchType === "NORMALIZED_MATCH" ||
              companyMatchType === "FUZZY_CANDIDATE",
          }
        : undefined,
    timeline:
      resumePeriod && socialSecurityPeriod
        ? {
            startMonthDifference,
            endMonthDifference,
            overlapMonths: resumeMonths.filter((month) =>
              paidMonths.includes(month),
            ),
            gapMonths: base.gapMonths,
          }
        : undefined,
    rules: input.rules,
  };
}

function uniqueStrings(values: string[]) {
  return [...new Set(values)];
}

function gateFailure(input: Phase8VerificationInput): Phase8VerificationResult | null {
  const statuses = [
    input.evidenceGate.resume,
    input.evidenceGate.socialSecurity,
  ];
  if (statuses.every((status) => status === "VALIDATED")) {
    if (allFieldsVerified(input)) return null;
    return {
      conclusion: "INSUFFICIENT_EVIDENCE",
      items: [
        makeItem({
          matchStatus: "INSUFFICIENT_EVIDENCE",
          description:
            "Evidence Gate 声称已验证，但存在未验证、缺失或带 warning 的关键字段",
          warnings: ["VALIDATED_GATE_FIELD_CONTRADICTION"],
          requiresManualReview: true,
          rules: ["记录级 VALIDATED 不能覆盖字段级证据缺口"],
        }),
      ],
    };
  }
  const manual = statuses.some((status) =>
    ["CONFLICT", "MANUAL_REQUIRED", "UNCERTAIN", "UNSUPPORTED"].includes(
      status,
    ),
  );
  return {
    conclusion: manual
      ? "MANUAL_REVIEW_REQUIRED"
      : "INSUFFICIENT_EVIDENCE",
    items: [
      makeItem({
        matchStatus: manual
          ? "MANUAL_REVIEW_REQUIRED"
          : "INSUFFICIENT_EVIDENCE",
        description: `Evidence Gate 未通过：${statuses.join(" / ")}`,
        warnings: statuses.map((status) => `EVIDENCE_${status}`),
        requiresManualReview: true,
        rules: ["只有 VALIDATED Evidence 可进入确定性核验"],
      }),
    ],
  };
}

function periodDistance(
  resume: ResumeEvidenceExperience,
  social: SocialSecurityEvidenceRecord,
) {
  return (
    Math.abs(
      monthIndex(resume.resumeStartMonth.value!) -
        monthIndex(social.startMonth.value!),
    ) +
    Math.abs(
      monthIndex(resume.resumeEndMonth.value!) -
        monthIndex(social.endMonth.value!),
    )
  );
}

function companyRank(type: CompanyMatchType) {
  return {
    EXACT: 0,
    NORMALIZED_MATCH: 1,
    FUZZY_CANDIDATE: 2,
    NO_MATCH: 3,
  }[type];
}

function periodsOverlap(
  resume: ResumeEvidenceExperience,
  social: SocialSecurityEvidenceRecord,
) {
  return (
    monthIndex(resume.resumeStartMonth.value!) <=
      monthIndex(social.endMonth.value!) &&
    monthIndex(resume.resumeEndMonth.value!) >=
      monthIndex(social.startMonth.value!)
  );
}

function deriveTaskConclusion(items: VerificationV2Item[]): Phase8TaskConclusion {
  if (!items.length) return "INSUFFICIENT_EVIDENCE";
  if (items.some((item) => item.requiresManualReview)) {
    return "MANUAL_REVIEW_REQUIRED";
  }
  if (items.some((item) => item.matchStatus === "INSUFFICIENT_EVIDENCE")) {
    return "INSUFFICIENT_EVIDENCE";
  }
  const exact = items.filter(
    (item) => item.matchStatus === "EXACT_MATCH",
  ).length;
  if (exact === items.length) return "CONSISTENT";
  return exact > 0 ? "PARTIALLY_CONSISTENT" : "INCONSISTENT";
}

function comparePair(input: {
  resume: ResumeEvidenceExperience;
  social: SocialSecurityEvidenceRecord;
  companyMatchType: CompanyMatchType;
  warnings: string[];
  multipleCompaniesSameMonth: boolean;
}) {
  const { resume, social, companyMatchType } = input;
  const paidMonths = uniqueMonths(social.paidMonths.value!);
  const paidStart = paidMonths[0];
  const paidEnd = paidMonths.at(-1);
  if (
    !paidStart ||
    paidStart !== social.startMonth.value ||
    paidEnd !== social.endMonth.value
  ) {
    return makeItem({
      matchStatus: "MANUAL_REVIEW_REQUIRED",
      description:
        "社保起止月份不是由已验证 paidMonths 的首末月份确定性派生",
      companyMatchType,
      resume,
      social,
      warnings: [...input.warnings, "PAID_MONTH_DERIVATION_CONFLICT"],
      requiresManualReview: true,
      rules: ["paidMonths 是社保时间主事实"],
    });
  }
  if (input.multipleCompaniesSameMonth) {
    return makeItem({
      matchStatus: "MULTIPLE_COMPANIES_SAME_MONTH",
      description: "同一缴费月份存在多个社保单位记录，必须人工复核",
      companyMatchType,
      resume,
      social,
      warnings: [...input.warnings, "MULTIPLE_COMPANIES_SAME_MONTH"],
      requiresManualReview: true,
      rules: ["同月份多单位记录禁止自动归属"],
    });
  }
  if (
    companyMatchType === "NORMALIZED_MATCH" ||
    companyMatchType === "FUZZY_CANDIDATE"
  ) {
    return makeItem({
      matchStatus: "MANUAL_REVIEW_REQUIRED",
      description:
        companyMatchType === "NORMALIZED_MATCH"
          ? "公司规范化候选一致，但原文不一致"
          : "公司名称仅达到模糊候选阈值",
      companyMatchType,
      resume,
      social,
      warnings: [...input.warnings, companyMatchType],
      requiresManualReview: true,
      rules: ["只有公司原文 EXACT 才可自动判定一致"],
    });
  }
  if (companyMatchType === "NO_MATCH") {
    return makeItem({
      matchStatus: "COMPANY_MISMATCH",
      description: "简历公司原文与社保公司原文不一致",
      companyMatchType,
      resume,
      social,
      warnings: input.warnings,
      rules: ["公司名称使用原文逐字比较"],
    });
  }
  const item = makeItem({
    matchStatus: "EXACT_MATCH",
    description: "公司原文、起止月份及逐月缴费事实一致",
    companyMatchType,
    resume,
    social,
    warnings: input.warnings,
    rules: ["公司原文 EXACT", "月份零容差", "paidMonths 逐月比较"],
  });
  const startDifference = item.timeline!.startMonthDifference!;
  const endDifference = item.timeline!.endMonthDifference!;
  if (item.gapMonths.length) {
    return makeItem({
      matchStatus: "GAP_DETECTED",
      description: `${item.gapMonths.join("、")} 未发现缴费记录`,
      companyMatchType,
      resume,
      social,
      warnings: [...input.warnings, "GAP_DETECTED"],
      rules: ["断缴由 paidMonths 与首末月区间确定性计算"],
    });
  }
  if (startDifference !== 0 && endDifference !== 0) {
    return makeItem({
      matchStatus: "PERIOD_MISMATCH",
      description: "简历起止月份均与社保缴费月份不一致",
      companyMatchType,
      resume,
      social,
      warnings: input.warnings,
      rules: ["起止月份零容差比较"],
    });
  }
  if (startDifference !== 0) {
    return makeItem({
      matchStatus: "START_MONTH_MISMATCH",
      description: `简历入职月与社保首缴月相差 ${Math.abs(startDifference)} 个月`,
      companyMatchType,
      resume,
      social,
      warnings: input.warnings,
      rules: ["入职月份零容差比较"],
    });
  }
  if (endDifference !== 0) {
    return makeItem({
      matchStatus: "END_MONTH_MISMATCH",
      description: `简历离职月与社保末缴月相差 ${Math.abs(endDifference)} 个月`,
      companyMatchType,
      resume,
      social,
      warnings: input.warnings,
      rules: ["离职月份零容差比较"],
    });
  }
  return item;
}

export function verifyValidatedEvidence(
  input: Phase8VerificationInput,
): Phase8VerificationResult {
  const blocked = gateFailure(input);
  if (blocked) return blocked;

  const usedSocial = new Set<number>();
  const items: VerificationV2Item[] = [];
  const companyPeriodCounts = new Map<string, number>();
  for (const record of input.socialSecurityRecords) {
    const company = record.companyRaw.value!;
    companyPeriodCounts.set(
      company,
      (companyPeriodCounts.get(company) ?? 0) + 1,
    );
  }
  const monthCompanies = new Map<string, Set<string>>();
  input.socialSecurityRecords.forEach((record) => {
    if (record.personalInsurance) return;
    record.paidMonths.value!.forEach((month) => {
      const companies = monthCompanies.get(month) ?? new Set<string>();
      companies.add(record.companyRaw.value!);
      monthCompanies.set(month, companies);
    });
  });
  const conflictingMonths = new Set(
    [...monthCompanies]
      .filter(([, companies]) => companies.size > 1)
      .map(([month]) => month),
  );

  for (const resume of input.resumeExperiences) {
    const candidates = input.socialSecurityRecords
      .map((social, index) => ({
        social,
        index,
        companyMatchType: classifyCompanyMatch(
          resume.resumeCompany.value!,
          social.companyRaw.value!,
        ),
      }))
      .filter(
        ({ social, index, companyMatchType }) =>
          !usedSocial.has(index) &&
          !social.personalInsurance &&
          (companyMatchType !== "NO_MATCH" ||
            periodsOverlap(resume, social)),
      )
      .sort(
        (left, right) =>
          companyRank(left.companyMatchType) -
            companyRank(right.companyMatchType) ||
          periodDistance(resume, left.social) -
            periodDistance(resume, right.social) ||
          left.index - right.index,
      );
    const candidate = candidates[0];
    if (!candidate) {
      items.push(
        makeItem({
          matchStatus: "RESUME_ONLY",
          description: "简历经历没有对应的已验证社保记录",
          resume,
          rules: ["已验证社保记录中未找到可配对经历"],
        }),
      );
      continue;
    }
    const firstRank = companyRank(candidate.companyMatchType);
    const firstDistance = periodDistance(resume, candidate.social);
    const ambiguous = candidates.slice(1).some(
      (entry) =>
        companyRank(entry.companyMatchType) === firstRank &&
        periodDistance(resume, entry.social) === firstDistance,
    );
    if (ambiguous) {
      items.push(
        makeItem({
          matchStatus: "MANUAL_REVIEW_REQUIRED",
          description: "存在多个同优先级社保候选，无法确定性配对",
          companyMatchType: candidate.companyMatchType,
          resume,
          warnings: ["AMBIGUOUS_SOCIAL_SECURITY_CANDIDATES"],
          requiresManualReview: true,
          rules: ["候选配对有并列时禁止自动选择"],
        }),
      );
      continue;
    }
    usedSocial.add(candidate.index);
    const multiPeriod =
      (companyPeriodCounts.get(candidate.social.companyRaw.value!) ?? 0) > 1;
    items.push(
      comparePair({
        resume,
        social: candidate.social,
        companyMatchType: candidate.companyMatchType,
        warnings: multiPeriod ? ["MULTIPLE_PERIODS_SAME_COMPANY"] : [],
        multipleCompaniesSameMonth: candidate.social.paidMonths.value!.some(
          (month) => conflictingMonths.has(month),
        ),
      }),
    );
  }

  input.socialSecurityRecords.forEach((social, index) => {
    if (social.personalInsurance) {
      items.push(
        makeItem({
          matchStatus: "PERSONAL_INSURANCE",
          description: "社保记录为个人参保或灵活就业，必须人工复核",
          social,
          warnings: ["PERSONAL_INSURANCE"],
          requiresManualReview: true,
          rules: ["个人参保记录不自动归属工作经历"],
        }),
      );
    } else if (
      !usedSocial.has(index) &&
      social.paidMonths.value!.some((month) => conflictingMonths.has(month))
    ) {
      items.push(
        makeItem({
          matchStatus: "MULTIPLE_COMPANIES_SAME_MONTH",
          description: "同一缴费月份存在多个社保单位记录，必须人工复核",
          social,
          warnings: ["MULTIPLE_COMPANIES_SAME_MONTH"],
          requiresManualReview: true,
          rules: ["同月份多单位记录禁止自动归属"],
        }),
      );
    } else if (!usedSocial.has(index)) {
      items.push(
        makeItem({
          matchStatus: "SOCIAL_SECURITY_ONLY",
          description: "社保记录存在，但简历未披露对应经历",
          social,
          warnings:
            (companyPeriodCounts.get(social.companyRaw.value!) ?? 0) > 1
              ? ["MULTIPLE_PERIODS_SAME_COMPANY"]
              : [],
          rules: ["没有可配对的已验证简历经历"],
        }),
      );
    }
  });

  return {
    conclusion: deriveTaskConclusion(items),
    items,
  };
}

export function verifyEvidenceRecords(input: {
  evidenceGate?: Phase8EvidenceGate;
  resumeExperiences: ResumeEvidenceExperience[];
  socialSecurityRecords: SocialSecurityEvidenceRecord[];
}): VerificationV2Item[] {
  return verifyValidatedEvidence({
    ...input,
    evidenceGate: input.evidenceGate ?? {
      resume: "UNVERIFIED",
      socialSecurity: "UNVERIFIED",
    },
  }).items;
}
