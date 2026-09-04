const YEAR_MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function isValidYearMonth(value: string | null | undefined): boolean {
  return Boolean(value && YEAR_MONTH.test(value));
}

export function parseYearMonth(value: string | null | undefined): {
  year: number;
  month: number;
} | null {
  const match = value?.trim().match(YEAR_MONTH);
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]) };
}

export function assertMonthRange(
  startMonth: string | null | undefined,
  endMonth: string | null | undefined,
): { ok: true } | { ok: false; message: string } {
  if (startMonth && !isValidYearMonth(startMonth)) {
    return { ok: false, message: "开始月份格式无效，须为 YYYY-MM" };
  }
  if (endMonth && !isValidYearMonth(endMonth)) {
    return { ok: false, message: "结束月份格式无效，须为 YYYY-MM" };
  }
  if (startMonth && endMonth && startMonth > endMonth) {
    return { ok: false, message: "开始月份不得晚于结束月份" };
  }
  return { ok: true };
}

export function gapMonthsBetween(
  startMonth: string | null | undefined,
  endMonth: string | null | undefined,
  paidMonths: string[],
): string[] {
  if (!isValidYearMonth(startMonth) || !isValidYearMonth(endMonth)) return [];
  const paid = new Set(paidMonths.filter((month) => isValidYearMonth(month)));
  const gaps: string[] = [];
  let [year, month] = startMonth!.split("-").map(Number);
  const [endYear, endMonthNum] = endMonth!.split("-").map(Number);
  while (year < endYear || (year === endYear && month <= endMonthNum)) {
    const value = `${year}-${String(month).padStart(2, "0")}`;
    if (paid.size > 0 && !paid.has(value)) gaps.push(value);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return gaps;
}
