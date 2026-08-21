import { z } from "zod";

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export const YearMonthSchema = z.string().regex(MONTH_PATTERN, "月份必须使用 YYYY-MM 格式");

export type YearMonth = z.infer<typeof YearMonthSchema>;

export function monthIndex(month: string): number {
  const [year, value] = month.split("-").map(Number);
  return year * 12 + value - 1;
}

export const ResumeRecordSchema = z
  .object({
    resumeDeclaredCompany: z.string().min(1),
    resumeDeclaredStartMonth: YearMonthSchema,
    resumeDeclaredEndMonth: YearMonthSchema,
  })
  .strict()
  .refine((record) => record.resumeDeclaredStartMonth <= record.resumeDeclaredEndMonth, {
    message: "开始月份不得晚于结束月份",
    path: ["resumeDeclaredEndMonth"],
  });

export const SocialSecurityRecordSchema = z
  .object({
    verifiedSocialSecurityCompany: z.string().min(1),
    verifiedSocialSecurityStartMonth: YearMonthSchema,
    verifiedSocialSecurityEndMonth: YearMonthSchema,
    verifiedSocialSecurityMonths: z.number().int().nonnegative(),
    pensionMonths: z.number().int().nonnegative(),
    injuryMonths: z.number().int().nonnegative(),
    unemploymentMonths: z.number().int().nonnegative(),
    paidMonths: z.array(YearMonthSchema).default([]),
    sourceFile: z.string().min(1),
    personalInsurance: z.boolean().default(false),
  })
  .strict()
  .refine(
    (record) =>
      record.verifiedSocialSecurityStartMonth <= record.verifiedSocialSecurityEndMonth,
    {
      message: "开始月份不得晚于结束月份",
      path: ["verifiedSocialSecurityEndMonth"],
    },
  );

export const ResumeExtractionSchema = z.object({
  candidateName: z.string().min(1),
  resumeExperiences: z.array(ResumeRecordSchema),
}).strict();

export const SocialSecurityExtractionSchema = z.object({
  socialSecurityRecords: z.array(SocialSecurityRecordSchema),
}).strict();

export const VerificationStatusSchema = z.enum([
  "MATCHED",
  "COMPANY_MISMATCH",
  "START_DATE_MISMATCH",
  "END_DATE_MISMATCH",
  "DATE_MISMATCH",
  "RESUME_ONLY",
  "SOCIAL_SECURITY_ONLY",
  "PERSONAL_INSURANCE",
  "GAP_PERIOD",
]);

export const VerificationInputSchema = z.object({
  resumeExperiences: z.array(ResumeRecordSchema),
  socialSecurityRecords: z.array(SocialSecurityRecordSchema),
}).strict();

export const VerificationResultSchema = z
  .object({
    status: VerificationStatusSchema,
    description: z.string().min(1),
    resumeDeclaredCompany: z.string().optional(),
    resumeDeclaredStartMonth: YearMonthSchema.optional(),
    resumeDeclaredEndMonth: YearMonthSchema.optional(),
    verifiedSocialSecurityCompany: z.string().optional(),
    verifiedSocialSecurityStartMonth: YearMonthSchema.optional(),
    verifiedSocialSecurityEndMonth: YearMonthSchema.optional(),
    verifiedSocialSecurityMonths: z.number().int().nonnegative().optional(),
    pensionMonths: z.number().int().nonnegative().optional(),
    injuryMonths: z.number().int().nonnegative().optional(),
    unemploymentMonths: z.number().int().nonnegative().optional(),
    paidMonths: z.array(YearMonthSchema).optional(),
    gapMonths: z.array(YearMonthSchema).default([]),
    startMonthDifference: z.number().int().optional(),
    endMonthDifference: z.number().int().optional(),
  })
  .strict();

export type ResumeRecord = z.infer<typeof ResumeRecordSchema>;
export type SocialSecurityRecord = z.infer<
  typeof SocialSecurityRecordSchema
>;
export type ResumeExtraction = z.infer<typeof ResumeExtractionSchema>;
export type SocialSecurityExtraction = z.infer<typeof SocialSecurityExtractionSchema>;
export type VerificationStatus = z.infer<typeof VerificationStatusSchema>;
export type VerificationInput = z.output<typeof VerificationInputSchema>;
export type ParsedVerificationInput = VerificationInput;
export type VerificationResult = z.infer<typeof VerificationResultSchema>;

// Conventional camel-case exports are provided for consumers that name schemas
// after their domain values.
export const yearMonthSchema = YearMonthSchema;
export const resumeRecordSchema = ResumeRecordSchema;
export const socialSecurityRecordSchema = SocialSecurityRecordSchema;
export const verificationInputSchema = VerificationInputSchema;
export const verificationResultSchema = VerificationResultSchema;
