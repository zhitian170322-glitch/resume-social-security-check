import {
  VerificationInputSchema,
  monthIndex,
  type SocialSecurityRecord,
  type VerificationInput,
  type VerificationResult,
  type VerificationStatus,
} from "./schemas";

export function signedMonthDifference(left: string, right: string) {
  return monthIndex(left) - monthIndex(right);
}

export function differenceInMonths(left: string, right: string) {
  return Math.abs(signedMonthDifference(left, right));
}

function monthFromIndex(index: number) {
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  return `${year}-${String(month).padStart(2, "0")}`;
}

function uniqueSocialRecords(records: SocialSecurityRecord[]) {
  const groups = new Map<string, SocialSecurityRecord>();
  for (const record of records) {
    const key = [
      record.verifiedSocialSecurityCompany,
      record.verifiedSocialSecurityStartMonth,
      record.verifiedSocialSecurityEndMonth,
    ].join("\u0000");
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, { ...record, paidMonths: [...new Set(record.paidMonths)] });
      continue;
    }
    existing.paidMonths = [...new Set([...existing.paidMonths, ...record.paidMonths])];
    existing.verifiedSocialSecurityMonths = Math.max(
      existing.verifiedSocialSecurityMonths,
      record.verifiedSocialSecurityMonths,
    );
  }
  return [...groups.values()];
}

function pairedResult(
  resume: VerificationInput["resumeExperiences"][number],
  social: SocialSecurityRecord,
): VerificationResult {
  const sameCompany = resume.resumeDeclaredCompany === social.verifiedSocialSecurityCompany;
  const sameStart =
    resume.resumeDeclaredStartMonth === social.verifiedSocialSecurityStartMonth;
  const sameEnd = resume.resumeDeclaredEndMonth === social.verifiedSocialSecurityEndMonth;
  let status: VerificationStatus;
  if (!sameCompany) status = "COMPANY_MISMATCH";
  else if (sameStart && sameEnd) status = "MATCHED";
  else if (!sameStart && sameEnd) status = "START_DATE_MISMATCH";
  else if (sameStart) status = "END_DATE_MISMATCH";
  else status = "DATE_MISMATCH";
  const startDiff = signedMonthDifference(
    resume.resumeDeclaredStartMonth,
    social.verifiedSocialSecurityStartMonth,
  );
  const endDiff = signedMonthDifference(
    resume.resumeDeclaredEndMonth,
    social.verifiedSocialSecurityEndMonth,
  );
  const differences = [];
  if (!sameCompany) differences.push("简历公司信息与社保记录不一致");
  if (!sameStart) {
    differences.push(
      `简历声明的入职时间比社保首缴时间${startDiff < 0 ? "早" : "晚"}${Math.abs(startDiff)}个月`,
    );
  }
  if (!sameEnd) {
    differences.push(
      `简历声明的离职时间比社保末缴时间${endDiff < 0 ? "早" : "晚"}${Math.abs(endDiff)}个月`,
    );
  }
  return {
    status,
    description:
      differences.join("；") ||
      "简历声明的公司与起止月份均与社保缴纳记录完全一致",
    ...resume,
    verifiedSocialSecurityCompany: social.verifiedSocialSecurityCompany,
    verifiedSocialSecurityStartMonth: social.verifiedSocialSecurityStartMonth,
    verifiedSocialSecurityEndMonth: social.verifiedSocialSecurityEndMonth,
    verifiedSocialSecurityMonths: social.verifiedSocialSecurityMonths,
    pensionMonths: social.pensionMonths,
    injuryMonths: social.injuryMonths,
    unemploymentMonths: social.unemploymentMonths,
    paidMonths: social.paidMonths,
    gapMonths: [],
    startMonthDifference: startDiff,
    endMonthDifference: endDiff,
  };
}

function gapResult(record: SocialSecurityRecord): VerificationResult | null {
  if (record.personalInsurance || record.paidMonths.length === 0) return null;
  const paid = new Set(record.paidMonths);
  const missing: string[] = [];
  for (
    let month = monthIndex(record.verifiedSocialSecurityStartMonth);
    month <= monthIndex(record.verifiedSocialSecurityEndMonth);
    month += 1
  ) {
    const value = monthFromIndex(month);
    if (!paid.has(value)) missing.push(value);
  }
  if (!missing.length) return null;
  return {
    status: "GAP_PERIOD",
    description: `${missing.join("、")} 未发现社保缴费记录`,
    verifiedSocialSecurityCompany: record.verifiedSocialSecurityCompany,
    verifiedSocialSecurityStartMonth: record.verifiedSocialSecurityStartMonth,
    verifiedSocialSecurityEndMonth: record.verifiedSocialSecurityEndMonth,
    verifiedSocialSecurityMonths: record.verifiedSocialSecurityMonths,
    pensionMonths: record.pensionMonths,
    injuryMonths: record.injuryMonths,
    unemploymentMonths: record.unemploymentMonths,
    paidMonths: record.paidMonths,
    gapMonths: missing,
  };
}

export function verifyEmployment(input: VerificationInput): VerificationResult[] {
  const parsed = VerificationInputSchema.parse(input);
  const resumes = parsed.resumeExperiences;
  const socials = uniqueSocialRecords(parsed.socialSecurityRecords);
  const usedSocial = new Set<number>();
  const results: VerificationResult[] = [];

  for (const resume of resumes) {
    const candidates = socials
      .map((social, index) => ({ social, index }))
      .filter(
        ({ social, index }) =>
          !usedSocial.has(index) &&
          !social.personalInsurance &&
          social.verifiedSocialSecurityCompany === resume.resumeDeclaredCompany,
      )
      .sort(
        (left, right) =>
          differenceInMonths(
            resume.resumeDeclaredStartMonth,
            left.social.verifiedSocialSecurityStartMonth,
          ) +
            differenceInMonths(
              resume.resumeDeclaredEndMonth,
              left.social.verifiedSocialSecurityEndMonth,
            ) -
            (differenceInMonths(
              resume.resumeDeclaredStartMonth,
              right.social.verifiedSocialSecurityStartMonth,
            ) +
              differenceInMonths(
                resume.resumeDeclaredEndMonth,
                right.social.verifiedSocialSecurityEndMonth,
              )) ||
          left.index - right.index,
      );
    const candidate =
      candidates[0] ??
      socials
        .map((social, index) => ({ social, index }))
        .find(
          ({ social, index }) =>
            !usedSocial.has(index) &&
            !social.personalInsurance &&
            social.verifiedSocialSecurityStartMonth === resume.resumeDeclaredStartMonth &&
            social.verifiedSocialSecurityEndMonth === resume.resumeDeclaredEndMonth,
        );
    if (!candidate) {
      results.push({
        status: "RESUME_ONLY",
        description: "简历存在未被社保记录佐证的工作经历",
        ...resume,
        gapMonths: [],
      });
      continue;
    }
    usedSocial.add(candidate.index);
    results.push(pairedResult(resume, candidate.social));
  }

  socials.forEach((social, index) => {
    if (social.personalInsurance) {
      results.push({
        status: "PERSONAL_INSURANCE",
        description: "社保材料显示个人参保记录，建议人工复核",
        verifiedSocialSecurityCompany: social.verifiedSocialSecurityCompany,
        verifiedSocialSecurityStartMonth: social.verifiedSocialSecurityStartMonth,
        verifiedSocialSecurityEndMonth: social.verifiedSocialSecurityEndMonth,
        verifiedSocialSecurityMonths: social.verifiedSocialSecurityMonths,
        pensionMonths: social.pensionMonths,
        injuryMonths: social.injuryMonths,
        unemploymentMonths: social.unemploymentMonths,
        paidMonths: social.paidMonths,
        gapMonths: [],
      });
    } else if (!usedSocial.has(index)) {
      results.push({
        status: "SOCIAL_SECURITY_ONLY",
        description: "社保存在简历未披露的工作经历",
        verifiedSocialSecurityCompany: social.verifiedSocialSecurityCompany,
        verifiedSocialSecurityStartMonth: social.verifiedSocialSecurityStartMonth,
        verifiedSocialSecurityEndMonth: social.verifiedSocialSecurityEndMonth,
        verifiedSocialSecurityMonths: social.verifiedSocialSecurityMonths,
        pensionMonths: social.pensionMonths,
        injuryMonths: social.injuryMonths,
        unemploymentMonths: social.unemploymentMonths,
        paidMonths: social.paidMonths,
        gapMonths: [],
      });
    }
    const gap = gapResult(social);
    if (gap) results.push(gap);
  });
  return results;
}

export const verifyRecords = verifyEmployment;
export const runVerification = verifyEmployment;
