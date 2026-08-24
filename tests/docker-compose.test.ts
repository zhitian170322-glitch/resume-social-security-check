import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("production Compose topology", () => {
  it("runs only app on the external orangeito network without host web ports", async () => {
    const compose = await readFile("docker-compose.yml", "utf8");

    expect(compose).not.toMatch(/^\s+nginx:/m);
    expect(compose).not.toMatch(/^\s+ports:/m);
    expect(compose).not.toMatch(/(?:^|\D)(?:80|443):/m);
    expect(compose).not.toContain("/opt/orangeito");
    expect(compose).toMatch(
      /networks:\s*\n\s+- orangeito_default[\s\S]*orangeito_default:\s*\n\s+external: true\s*\n\s+name: orangeito_default/,
    );
  });
});
