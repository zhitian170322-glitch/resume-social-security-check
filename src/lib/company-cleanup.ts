const REGION_LABEL = /^(?:[\u4e00-\u9fff]{2,8}(?:省|市|县|区|自治州|地区))：\s*/u;

export function stripRegionLabelPrefix(value: string): string {
  let cleaned = value.trim();
  while (REGION_LABEL.test(cleaned)) {
    cleaned = cleaned.replace(REGION_LABEL, "").trim();
  }
  return cleaned;
}

export function normalizeCompanyName(value: string | null | undefined): string {
  return stripRegionLabelPrefix(value ?? "")
    .normalize("NFKC")
    .replace(/\s+/gu, " ")
    .trim();
}

export function isUnitCode(value: string | null | undefined): boolean {
  return /^\d{4,12}$/u.test((value ?? "").trim());
}

export function companyFromMappedName(
  rawName: string | null | undefined,
  sourceQuote?: string,
): { companyRaw: string | null; sourceQuote: string } {
  const quote = sourceQuote ?? rawName ?? "";
  if (!rawName?.trim() || isUnitCode(rawName)) {
    return { companyRaw: null, sourceQuote: quote };
  }
  const companyRaw = stripRegionLabelPrefix(rawName);
  return {
    companyRaw: companyRaw || null,
    sourceQuote: quote,
  };
}
