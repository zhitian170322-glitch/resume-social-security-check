import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("production Compose topology", () => {
  it("runs only app on the external orangeito network without host web ports", async () => {
    const compose = await readFile("docker-compose.yml", "utf8");

    expect(compose).not.toMatch(/^\s+nginx:/m);
    expect(compose).not.toMatch(/^\s+ports:/m);
    expect(compose).not.toMatch(/(?:^|\D)(?:80|443):/m);
    expect(compose).not.toContain("/opt/orangeito");
    expect(compose).toContain("orangeito_default");
    expect(compose).toMatch(/external:\s*true/);
    expect(compose).toContain("resume-social-security-check-app-1");
    expect(compose).toMatch(
      /orangeito_default:\s*\n\s+external:\s*true\s*\n\s+name:\s*orangeito_default/,
    );
  });

  it("installs better-sqlite3 build tools in the image", async () => {
    const dockerfile = await readFile("Dockerfile", "utf8");
    expect(dockerfile).toContain("python3");
    expect(dockerfile).toContain("make");
    expect(dockerfile).toContain("g++");
  });
});
