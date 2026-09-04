export type CompanyCharDiff = {
  left: Array<{ char: string; changed: boolean }>;
  right: Array<{ char: string; changed: boolean }>;
};

export function diffCompanyChars(
  left: string | null | undefined,
  right: string | null | undefined,
): CompanyCharDiff {
  const a = [...(left ?? "")];
  const b = [...(right ?? "")];
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const keepLeft = new Set<number>();
  const keepRight = new Set<number>();
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      keepLeft.add(i);
      keepRight.add(j);
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      i += 1;
    } else {
      j += 1;
    }
  }
  return {
    left: a.map((char, index) => ({ char, changed: !keepLeft.has(index) })),
    right: b.map((char, index) => ({ char, changed: !keepRight.has(index) })),
  };
}
