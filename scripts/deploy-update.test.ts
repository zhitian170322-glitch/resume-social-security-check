import { mkdtemp, writeFile, chmod, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const exec = promisify(execFile);
const script = new URL("./deploy-update.sh", import.meta.url).pathname;

async function makePackage(directory: string, shortSha = "abc1234") {
  const root = join(directory, "resume-social-security-check");
  await mkdir(root, { recursive: true });
  await writeFile(
    join(root, "docker-compose.yml"),
    [
      "services:",
      "  app:",
      "    container_name: resume-social-security-check-app",
      "    networks:",
      "      orangeito_default:",
      "        aliases:",
      "          - resume-social-security-check-app-1",
      "networks:",
      "  orangeito_default:",
      "    external: true",
      "",
    ].join("\n"),
  );
  await writeFile(
    join(root, "Dockerfile"),
    "FROM node:22\nRUN apt-get update && apt-get install -y python3 make g++\n# better-sqlite3\n",
  );
  const packagePath = join(directory, `resume-social-security-check-update-${shortSha}.tar.gz`);
  await exec("tar", ["-czf", packagePath, "-C", directory, "resume-social-security-check"]);
  const { stdout } = await exec("sha256sum", [packagePath]);
  const checksumPath = `${packagePath}.sha256`;
  await writeFile(checksumPath, stdout);
  return { packagePath, checksumPath };
}

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
    expect(source).toContain("MANUAL_ONLY");
    expect(source).toContain("--apply-local");
    expect(source).toContain("--confirm=APPLY-LOCAL");
    expect(source).toContain("--app-dir");
    expect(source).toContain("拒绝把 /home/admin 识别为生产根目录");
    expect(source).not.toMatch(/APP_DIR="\$\(pwd\)"/);
    expect(source).toContain("docker image inspect");
    expect(source).toContain("PRAGMA integrity_check");
    expect(source).toMatch(/禁止:[\s\S]*orangeito-app/);
    expect(source).toMatch(/禁止:[\s\S]*orangeito-caddy/);
    expect(source).not.toMatch(/up -d[^\n]*--remove-orphans/);
    expect(source).not.toMatch(/rm -rf \//);
    expect(source).not.toMatch(/rm -rf \.\./);
  });

  it("completes dry-run without applying", async () => {
    const directory = await mkdtemp(join(tmpdir(), "rssc-dry-"));
    const { packagePath, checksumPath } = await makePackage(directory);
    const { stdout } = await exec("bash", [script, packagePath, checksumPath]);
    expect(stdout).toContain("DRY-RUN 完成");
    expect(stdout).toContain("MANUAL_ONLY");
    expect(stdout).not.toContain("APPLY-LOCAL 完成");
  });

  it("rejects remote --apply as MANUAL_ONLY", async () => {
    const directory = await mkdtemp(join(tmpdir(), "rssc-apply-"));
    const { packagePath, checksumPath } = await makePackage(directory);
    await expect(exec("bash", [script, packagePath, checksumPath, "--apply"])).rejects.toMatchObject({
      stderr: expect.stringContaining("MANUAL_ONLY"),
    });
  });

  it("rejects --apply-local without explicit confirmation", async () => {
    const directory = await mkdtemp(join(tmpdir(), "rssc-noconfirm-"));
    const { packagePath, checksumPath } = await makePackage(directory);
    await expect(
      exec("bash", [script, packagePath, checksumPath, "--apply-local"]),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("--confirm=APPLY-LOCAL"),
    });
  });

  it("fails when systemd/build reports success but docker image inspect finds no image", async () => {
    const directory = await mkdtemp(join(tmpdir(), "rssc-fake-build-"));
    const appDir = join(directory, "app");
    await mkdir(join(appDir, "data"), { recursive: true });
    await writeFile(join(appDir, "data", "app.db"), "");
    await writeFile(join(appDir, "docker-compose.yml"), "services:\n  app: {}\n");
    await writeFile(join(appDir, ".env"), "DATABASE_URL=file:/data/app.db\n");
    const { packagePath, checksumPath } = await makePackage(directory, "def5678");
    const binDir = join(directory, "bin");
    await mkdir(binDir);
    const dockerPath = join(binDir, "docker");
    const sqlitePath = join(binDir, "sqlite3");
    const curlPath = join(binDir, "curl");
    await writeFile(
      dockerPath,
      `#!/usr/bin/env bash
echo "systemd-run Result=success" >&2
if [[ "\$1" == "image" && "\$2" == "inspect" ]]; then
  echo "image missing" >&2
  exit 1
fi
if [[ "\$1" == "compose" && "\$2" == "build" ]]; then
  exit 0
fi
if [[ "\$1" == "compose" && "\$2" == "version" ]]; then
  exit 0
fi
if [[ "\$1" == "tag" ]]; then
  exit 0
fi
exit 0
`,
    );
    await writeFile(
      sqlitePath,
      `#!/usr/bin/env bash
if [[ "\$2" == *integrity_check* ]]; then
  echo ok
  exit 0
fi
exit 0
`,
    );
    await writeFile(curlPath, "#!/usr/bin/env bash\necho 200\n");
    await chmod(dockerPath, 0o755);
    await chmod(sqlitePath, 0o755);
    await chmod(curlPath, 0o755);
    await expect(
      exec("bash", [script, packagePath, checksumPath, "--apply-local", "--confirm=APPLY-LOCAL"], {
        env: {
          ...process.env,
          PATH: `${binDir}:${process.env.PATH ?? ""}`,
          DOCKER_BIN: dockerPath,
          SQLITE_BIN: sqlitePath,
          CURL_BIN: curlPath,
          DEPLOY_APP_DIR: appDir,
          SQLITE_PATH: join(appDir, "data", "app.db"),
        },
      }),
    ).rejects.toMatchObject({
      stderr: expect.stringMatching(/镜像不存在|systemd Result=success/),
    });
  });

  it("promotes latest only after inspect shows a new image id", async () => {
    const directory = await mkdtemp(join(tmpdir(), "rssc-good-build-"));
    const appDir = join(directory, "app");
    await mkdir(join(appDir, "data"), { recursive: true });
    await writeFile(join(appDir, "data", "app.db"), "");
    await writeFile(join(appDir, "docker-compose.yml"), "services:\n  app: {}\n");
    await writeFile(join(appDir, ".env"), "DATABASE_URL=file:/data/app.db\n");
    const { packagePath, checksumPath } = await makePackage(directory, "aaa1111");
    const binDir = join(directory, "bin");
    await mkdir(binDir);
    const logPath = join(directory, "docker.log");
    const dockerPath = join(binDir, "docker");
    const sqlitePath = join(binDir, "sqlite3");
    const curlPath = join(binDir, "curl");
    await writeFile(
      dockerPath,
      `#!/usr/bin/env bash
echo "\$@" >> "${logPath}"
if [[ "\$1" == "image" && "\$2" == "inspect" ]]; then
  ref="\$3"
  if [[ "\$ref" == *":latest" ]]; then
    echo "sha256:oldimage"
    exit 0
  fi
  if [[ "\$ref" == *":v7-aaa1111" ]]; then
    echo "sha256:newimage"
    exit 0
  fi
  exit 1
fi
if [[ "\$1" == "inspect" ]]; then
  if [[ "\$2" == "-f" && "\$3" == "{{.State.Health.Status}}" ]]; then
    echo healthy
    exit 0
  fi
  if [[ "\$2" == "-f" && "\$3" == "{{.Image}}" ]]; then
    echo sha256:newimage
    exit 0
  fi
  echo cid
  exit 0
fi
exit 0
`,
    );
    await writeFile(
      sqlitePath,
      `#!/usr/bin/env bash
echo ok
exit 0
`,
    );
    await writeFile(
      curlPath,
      `#!/usr/bin/env bash
echo 200
exit 0
`,
    );
    await chmod(dockerPath, 0o755);
    await chmod(sqlitePath, 0o755);
    await chmod(curlPath, 0o755);
    const { stdout } = await exec(
      "bash",
      [script, packagePath, checksumPath, "--apply-local", "--confirm=APPLY-LOCAL"],
      {
        env: {
          ...process.env,
          PATH: `${binDir}:${process.env.PATH ?? ""}`,
          DOCKER_BIN: dockerPath,
          SQLITE_BIN: sqlitePath,
          CURL_BIN: curlPath,
          DEPLOY_APP_DIR: appDir,
          SQLITE_PATH: join(appDir, "data", "app.db"),
        },
      },
    );
    expect(stdout).toContain("APPLY-LOCAL 完成");
    expect(stdout).toContain("resume-social-security-check:v7-aaa1111");
    const log = await readFile(logPath, "utf8");
    expect(log).toContain("image inspect");
    expect(log).toMatch(/tag resume-social-security-check:v7-aaa1111 resume-social-security-check:latest/);
    expect(log).not.toContain("--remove-orphans");
  });

  it("rejects /home/admin as the production root before any write", async () => {
    const directory = await mkdtemp(join(tmpdir(), "rssc-bad-root-"));
    const { packagePath, checksumPath } = await makePackage(directory);
    await expect(
      exec("bash", [
        script,
        packagePath,
        checksumPath,
        "--apply-local",
        "--confirm=APPLY-LOCAL",
        "--app-dir=/home/admin",
      ]),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("/home/admin"),
    });
  });

  it("rejects a missing production .env before backup", async () => {
    const directory = await mkdtemp(join(tmpdir(), "rssc-bad-env-"));
    const appDir = join(directory, "app");
    await mkdir(appDir, { recursive: true });
    await writeFile(join(appDir, "docker-compose.yml"), "services:\n  app: {}\n");
    const { packagePath, checksumPath } = await makePackage(directory);
    await expect(
      exec("bash", [script, packagePath, checksumPath, "--apply-local", "--confirm=APPLY-LOCAL"], {
        env: { ...process.env, DEPLOY_APP_DIR: appDir, SQLITE_PATH: join(appDir, "missing.db") },
      }),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining(".env"),
    });
  });

  it("rejects a missing SQLite path before backup", async () => {
    const directory = await mkdtemp(join(tmpdir(), "rssc-bad-db-"));
    const appDir = join(directory, "app");
    await mkdir(appDir, { recursive: true });
    await writeFile(join(appDir, "docker-compose.yml"), "services:\n  app: {}\n");
    await writeFile(join(appDir, ".env"), "DATABASE_URL=file:/data/app.db\n");
    const { packagePath, checksumPath } = await makePackage(directory);
    await expect(
      exec("bash", [script, packagePath, checksumPath, "--apply-local", "--confirm=APPLY-LOCAL"], {
        env: {
          ...process.env,
          DEPLOY_APP_DIR: appDir,
          SQLITE_PATH: join(appDir, "no-such.db"),
        },
      }),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("SQLite"),
    });
  });
});
