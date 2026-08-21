import { NextResponse } from "next/server";
import { currentMonthOCRUsage } from "@/lib/ocr";
import { config } from "@/lib/config";

export const runtime = "nodejs";

export function GET() {
  const usage = currentMonthOCRUsage();
  return NextResponse.json({
    usage,
    warningLimit: config.OCR_MONTHLY_WARNING_LIMIT,
    safeLimit: config.OCR_MONTHLY_FREE_SAFE_LIMIT,
    absoluteLimit: config.OCR_MONTHLY_ABSOLUTE_LIMIT,
    warning: usage >= config.OCR_MONTHLY_WARNING_LIMIT,
  });
}
