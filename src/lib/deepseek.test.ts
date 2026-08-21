import { afterEach, describe, expect, it, vi } from "vitest";

describe("DeepSeek 固定 Schema", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("非法 JSON 自动重试一次后返回 AI_PARSE_FAILED", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "mock-key");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ choices: [{ message: { content: "{invalid" } }] }),
      }),
    );
    const { extractResume } = await import("./deepseek");
    await expect(extractResume("测试简历")).rejects.toMatchObject({
      code: "AI_PARSE_FAILED",
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
