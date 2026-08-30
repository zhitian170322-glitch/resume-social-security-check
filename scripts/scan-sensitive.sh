#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> 扫描工作区敏感文件"
if git ls-files | grep -E '(^|/)\.env$|\.pem$|\.p12$|id_rsa|uploads/|\.db$'; then
  echo "Git 跟踪了敏感文件。" >&2
  exit 1
fi

echo "==> 扫描明文密钥模式"
if git grep -I -n -E 'AKID[A-Z0-9]{10,}|sk-[A-Za-z0-9]{20,}|BEGIN (RSA |OPENSSH )?PRIVATE KEY' -- ':!.env.example' ':!scripts/scan-sensitive.sh'; then
  echo "发现疑似密钥。" >&2
  exit 1
fi

echo "sensitive-scan: ok"
