import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("deploy-update.sh safety", () => {
  const source = readFileSync(new URL("./deploy-update.sh", import.meta.url), "utf8");

  it("validates explicit paths, sha256, disk, memory and forbids unsafe operations", () => {
    expect(source).toContain("sha256sum");
    expect(source).toContain("MemAvailable");
    expect(source).toContain("orangeito_default");
    expect(source).toContain("resume-social-security-check-app-1");
    expect(source).toContain("python3");
    expect(source).toContain("better-sqlite3");
    expect(source).toContain("DRY-RUN");
    expect(source).toContain("禁止 --remove-orphans");
    expect(source).toMatch(/禁止:[\s\S]*orangeito-app/);
    expect(source).toMatch(/禁止:[\s\S]*orangeito-caddy/);
    expect(source).not.toMatch(/rm -rf \//);
    expect(source).not.toMatch(/rm -rf \.\./);
  });
});
