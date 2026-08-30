#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ -n "$(git status --porcelain)" ]]; then
  echo "工作区不干净，拒绝打包。" >&2
  git status --porcelain >&2
  exit 1
fi

SHORT_SHA="$(git rev-parse --short=7 HEAD)"
NAME="resume-social-security-check-update-${SHORT_SHA}.tar.gz"
OUT_DIR="${1:-$ROOT}"
mkdir -p "$OUT_DIR"
PACKAGE="$OUT_DIR/$NAME"

git archive --format=tar.gz --prefix="resume-social-security-check/" -o "$PACKAGE" HEAD

python3 - "$PACKAGE" <<'PY'
import sys, tarfile
forbidden_parts = (
    "/node_modules/",
    "/.next/",
    "/.git/",
    "/uploads/",
    "/data/",
)
forbidden_suffix = (".db", ".sqlite", ".pdf", ".png", ".jpg", ".jpeg", ".webp")
with tarfile.open(sys.argv[1], "r:gz") as archive:
    for member in archive.getmembers():
        name = member.name
        base = name.rsplit("/", 1)[-1]
        if base == ".env" or any(token in f"/{name}/" for token in forbidden_parts) or name.endswith(forbidden_suffix):
            raise SystemExit(f"更新包包含禁止文件: {name}")
print("package-content-scan: ok")
PY

sha256sum "$PACKAGE" | tee "$PACKAGE.sha256"
echo "$PACKAGE"
echo "$PACKAGE.sha256"
