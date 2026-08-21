import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().default("file:./data/app.db"),
  DEEPSEEK_API_KEY: z.string().default(""),
  DEEPSEEK_BASE_URL: z.string().url().default("https://api.deepseek.com"),
  DEEPSEEK_MODEL: z.string().default("deepseek-chat"),
  OCR_PROVIDER: z.literal("aliyun").default("aliyun"),
  ALIYUN_ACCESS_KEY_ID: z.string().default(""),
  ALIYUN_ACCESS_KEY_SECRET: z.string().default(""),
  MAX_FILE_SIZE_MB: z.coerce.number().positive().default(20),
  MAX_TASK_UPLOAD_MB: z.coerce.number().positive().default(50),
  MAX_CONCURRENT_VERIFICATION_TASKS: z.coerce
    .number()
    .int()
    .refine((value) => value === 1, "V1.0 仅允许单 Worker")
    .default(1),
  RAW_FILE_RETENTION_DAYS: z.coerce.number().int().positive().default(7),
  OCR_MONTHLY_WARNING_LIMIT: z.coerce.number().int().nonnegative().default(170),
  OCR_MONTHLY_FREE_SAFE_LIMIT: z.coerce.number().int().nonnegative().default(190),
  OCR_MONTHLY_ABSOLUTE_LIMIT: z.coerce.number().int().positive().default(1000),
  OCR_ALLOW_PAID_OVERRIDE: z.enum(["true", "false"]).default("true"),
  UPLOAD_DIR: z.string().default("./data/uploads"),
  PROCESSING_DIR: z.string().default("./data/processing"),
  REPORT_DIR: z.string().default("./data/reports"),
});

const parsed = envSchema.parse(process.env);

export const config = {
  ...parsed,
  DATABASE_PATH: parsed.DATABASE_URL.replace(/^file:/, ""),
  OCR_ALLOW_PAID_OVERRIDE: parsed.OCR_ALLOW_PAID_OVERRIDE === "true",
  MAX_FILE_SIZE: parsed.MAX_FILE_SIZE_MB * 1024 * 1024,
  MAX_TASK_UPLOAD: parsed.MAX_TASK_UPLOAD_MB * 1024 * 1024,
};
