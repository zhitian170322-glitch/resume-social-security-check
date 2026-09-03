import sharp from "sharp";

export const OCR_MAX_CONCURRENCY = 2;
export const OCR_RENDER_DPI = 300;

export async function preprocessPageImage(input: Buffer): Promise<Buffer> {
  try {
    return await sharp(input)
      .rotate()
      .trim({ threshold: 16 })
      .normalize()
      .png({ compressionLevel: 9 })
      .toBuffer();
  } catch {
    try {
      return await sharp(input).rotate().normalize().png().toBuffer();
    } catch {
      return input;
    }
  }
}

export async function withOcrRetry<T>(
  operation: () => Promise<T>,
  attempts = 3,
  baseDelayMs = 400,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt === attempts - 1) break;
      await new Promise((resolve) =>
        setTimeout(resolve, baseDelayMs * 2 ** attempt),
      );
    }
  }
  throw lastError instanceof Error ? lastError : new Error("OCR_RETRY_EXHAUSTED");
}

export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function run() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) || 0 }, () => run()),
  );
  return results;
}
