import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("P0 accuracy fixture catalog", () => {
  it("tracks every required high-risk document scenario", async () => {
    const manifest = JSON.parse(
      await readFile("tests/fixtures/accuracy/manifest.json", "utf8"),
    ) as Array<{ id: string }>;
    expect(manifest).toHaveLength(20);
    expect(new Set(manifest.map((fixture) => fixture.id)).size).toBe(20);
  });
});
