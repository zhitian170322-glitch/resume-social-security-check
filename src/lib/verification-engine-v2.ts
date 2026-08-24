import {
  monthIndex,
  type ResumeEvidenceExperience,
  type SocialSecurityEvidenceRecord,
  type VerificationV2Status,
} from "./schemas";
import { normalizeCompanyCandidate } from "./evidence-validator";
import {
  verifyEvidenceRecords as verifyPhase8EvidenceRecords,
  type Phase8EvidenceGate,
} from "./verification-engine-phase8";

export type VerificationV2Item = {
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

function monthFromIndex(index: number) {
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

function monthRange(start: string, end: string) {
  const values = [];
  for (let index = monthIndex(start); index <= monthIndex(end); index += 1) {
    values.push(monthFromIndex(index));
  }
  return values;
}

function usableResume(record: ResumeEvidenceExperience) {
  return (
    record.resumeCompany.status === "verified" &&
    record.resumeStartMonth.status === "verified" &&
    record.resumeEndMonth.status === "verified" &&
    record.resumeCompany.value !== null &&
    record.resumeStartMonth.value !== null &&
    record.resumeEndMonth.value !== null
  );
}

function usableSocial(record: SocialSecurityEvidenceRecord) {
  return (
    record.companyRaw.status === "verified" &&
    record.startMonth.status === "verified" &&
    record.endMonth.status === "verified" &&
    record.paidMonths.status === "verified" &&
    record.companyRaw.value !== null &&
    record.startMonth.value !== null &&
    record.endMonth.value !== null &&
    record.paidMonths.value !== null &&
    !record.warnings.some((warning) =>
      [
        "TEMPLATE_UNKNOWN",
        "TEMPLATE_INCOMPLETE",
        "OCR_CONFIDENCE_LOW",
        "OCR_COMPANY_UNCERTAIN",
        "OUTSOURCING_OR_DISPATCH",
      ].includes(warning),
    )
  );
}

function overlap(
  resume: ResumeEvidenceExperience,
  social: SocialSecurityEvidenceRecord,
) {
  const start = Math.max(
    monthIndex(resume.resumeStartMonth.value!),
    monthIndex(social.startMonth.value!),
  );
  const end = Math.min(
    monthIndex(resume.resumeEndMonth.value!),
    monthIndex(social.endMonth.value!),
  );
  return start <= end ? monthRange(monthFromIndex(start), monthFromIndex(end)) : [];
}

function comparePair(
  resume: ResumeEvidenceExperience,
  social: SocialSecurityEvidenceRecord,
): VerificationV2Item {
  const resumeCompany = resume.resumeCompany.value!;
  const socialCompany = social.companyRaw.value!;
  const rawExactMatch = resumeCompany === socialCompany;
  const normalizedCandidateMatch =
    normalizeCompanyCandidate(resumeCompany) === normalizeCompanyCandidate(socialCompany);
  const startDifference =
    monthIndex(resume.resumeStartMonth.value!) - monthIndex(social.startMonth.value!);
  const endDifference =
    monthIndex(resume.resumeEndMonth.value!) - monthIndex(social.endMonth.value!);
  const gapMonths = monthRange(social.startMonth.value!, social.endMonth.value!).filter(
    (month) => !social.paidMonths.value!.includes(month),
  );
  const timeline = {
    startMonthDifference: startDifference,
    endMonthDifference: endDifference,
    overlapMonths: overlap(resume, social),
    gapMonths,
  };
  const companyComparison = {
    rawExactMatch,
    normalizedCandidateMatch,
    manualReview: !rawExactMatch && normalizedCandidateMatch,
  };
  if (!rawExactMatch && normalizedCandidateMatch) {
    return {
      status: "MANUAL_REVIEW_REQUIRED",
      description: "疑似同一主体，但公司名称原文不一致，禁止自动判定",
      resume,
      socialSecurity: social,
      companyComparison,
      timeline,
      rules: ["公司原文严格比较", "公司规范化仅作为候选提示"],
    };
  }
  if (!rawExactMatch) {
    return {
      status: "COMPANY_MISMATCH",
      description: "简历公司名称原文与社保单位名称原文不一致",
      resume,
      socialSecurity: social,
      companyComparison,
      timeline,
      rules: ["公司原文严格比较"],
    };
  }
  if (gapMonths.length) {
    return {
      status: "GAP_DETECTED",
      description: `${gapMonths.join("、")} 未发现社保缴费记录`,
      resume,
      socialSecurity: social,
      companyComparison,
      timeline,
      rules: ["公司原文严格一致", "按月检查社保连续性"],
    };
  }
  if (startDifference !== 0 || endDifference !== 0) {
    return {
      status: "TIME_MISMATCH",
      description: [
        startDifference
          ? `简历入职月比社保首缴月${startDifference < 0 ? "早" : "晚"}${Math.abs(startDifference)}个月`
          : null,
        endDifference
          ? `简历离职月比社保末缴月${endDifference < 0 ? "早" : "晚"}${Math.abs(endDifference)}个月`
          : null,
      ]
        .filter(Boolean)
        .join("；"),
      resume,
      socialSecurity: social,
      companyComparison,
      timeline,
      rules: ["公司原文严格一致", "月份零容差比较"],
    };
  }
  return {
    status: "EXACT_MATCH",
    description: "公司原文及起止月份与社保记录完全一致",
    resume,
    socialSecurity: social,
    companyComparison,
    timeline,
    rules: ["证据字段全部通过验证", "公司原文严格一致", "月份零容差比较"],
  };
}

function verifyEvidenceRecordsLegacy(input: {
  resumeExperiences: ResumeEvidenceExperience[];
  socialSecurityRecords: SocialSecurityEvidenceRecord[];
}): VerificationV2Item[] {
  const results: VerificationV2Item[] = [];
  const usedSocial = new Set<number>();
  const usableSocialRecords = input.socialSecurityRecords.map((record, index) => ({
    record,
    index,
    usable: usableSocial(record),
  }));

  for (const resume of input.resumeExperiences) {
    if (!usableResume(resume)) {
      results.push({
        status: "EXTRACTION_UNCERTAIN",
        description: "简历关键字段缺少可验证原文证据",
        resume,
        rules: ["无有效 Evidence 禁止自动核验"],
      });
      continue;
    }
    const exact = usableSocialRecords.find(
      ({ record, index, usable }) =>
        usable &&
        !usedSocial.has(index) &&
        record.companyRaw.value === resume.resumeCompany.value,
    );
    const normalized =
      exact ??
      usableSocialRecords.find(
        ({ record, index, usable }) =>
          usable &&
          !usedSocial.has(index) &&
          normalizeCompanyCandidate(record.companyRaw.value!) ===
            normalizeCompanyCandidate(resume.resumeCompany.value!),
      );
    let candidate = normalized;
    if (!candidate) {
      const remaining = usableSocialRecords.filter(
        ({ index, usable }) => usable && !usedSocial.has(index),
      );
      if (remaining.length === 1 && overlap(resume, remaining[0].record).length) {
        candidate = remaining[0];
      }
    }
    if (!candidate) {
      results.push({
        status: "RESUME_ONLY",
        description: "简历存在未被社保记录佐证的工作经历",
        resume,
        rules: ["未找到可由原文或候选规范名配对的社保单位"],
      });
      continue;
    }
    usedSocial.add(candidate.index);
    results.push(comparePair(resume, candidate.record));
  }

  usableSocialRecords.forEach(({ record, index, usable }) => {
    if (record.personalInsurance) {
      results.push({
        status: "PERSONAL_INSURANCE",
        description: "社保材料显示个人参保，必须人工复核",
        socialSecurity: record,
        rules: ["个人参保不做自动工作经历结论"],
      });
    } else if (record.warnings.includes("OUTSOURCING_OR_DISPATCH")) {
      results.push({
        status: "MANUAL_REVIEW_REQUIRED",
        description: "社保单位疑似外包或劳务派遣主体，必须人工复核",
        socialSecurity: record,
        rules: ["外包或派遣关系不做自动主体归属判断"],
      });
    } else if (!usable) {
      results.push({
        status: "EXTRACTION_UNCERTAIN",
        description: "社保关键字段或模板缺少可验证证据",
        socialSecurity: record,
        rules: ["无有效 Evidence 禁止自动核验"],
      });
    } else if (!usedSocial.has(index)) {
      results.push({
        status: "SOCIAL_SECURITY_ONLY",
        description: "社保记录存在，但简历未发现对应经历",
        socialSecurity: record,
        rules: ["未找到公司原文一致或规范名候选一致的简历经历"],
      });
    }
  });
  return results;
}

export function verifyEvidenceRecords(input: {
  evidenceGate?: Phase8EvidenceGate;
  resumeExperiences: ResumeEvidenceExperience[];
  socialSecurityRecords: SocialSecurityEvidenceRecord[];
}) {
  return verifyPhase8EvidenceRecords(input);
}

// Kept private only as a migration reference. No production caller can invoke
// the pre-Phase-8 algorithm without the explicit VALIDATED gate.
void verifyEvidenceRecordsLegacy;
