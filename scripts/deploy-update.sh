#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "用法: $0 更新包.tar.gz 更新包.tar.gz.sha256" >&2
  echo "本脚本默认 dry-run。仅在显式传入 --apply 且设置 DEPLOY_HOST 时才会连接目标机。" >&2
  exit 2
}

APPLY=0
ARGS=()
for arg in "$@"; do
  if [[ "$arg" == "--apply" ]]; then
    APPLY=1
  else
    ARGS+=("$arg")
  fi
done

if [[ ${#ARGS[@]} -ne 2 ]]; then
  usage
fi

PACKAGE="${ARGS[0]}"
CHECKSUM="${ARGS[1]}"

if [[ "$PACKAGE" == *"*"* || "$CHECKSUM" == *"*"* || "$PACKAGE" == "-" || "$CHECKSUM" == "-" ]]; then
  echo "必须使用明确文件路径，禁止通配符或标准输入。" >&2
  exit 1
fi

if [[ ! -f "$PACKAGE" || ! -f "$CHECKSUM" ]]; then
  echo "更新包或校验文件不存在: $PACKAGE $CHECKSUM" >&2
  exit 1
fi

PACKAGE="$(cd "$(dirname "$PACKAGE")" && pwd)/$(basename "$PACKAGE")"
CHECKSUM="$(cd "$(dirname "$CHECKSUM")" && pwd)/$(basename "$CHECKSUM")"

echo "==> 校验 SHA256"
EXPECTED="$(awk '{print $1}' "$CHECKSUM")"
ACTUAL="$(sha256sum "$PACKAGE" | awk '{print $1}')"
if [[ -z "$EXPECTED" || "$EXPECTED" != "$ACTUAL" ]]; then
  echo "SHA256 不一致。expected=$EXPECTED actual=$ACTUAL" >&2
  exit 1
fi

echo "==> 检查磁盘与内存"
PACKAGE_BYTES="$(wc -c < "$PACKAGE")"
NEED_BYTES="$((PACKAGE_BYTES * 3 + 2 * 1024 * 1024 * 1024))"
AVAIL_KB="$(df -Pk . | awk 'NR==2 {print $4}')"
AVAIL_BYTES="$((AVAIL_KB * 1024))"
if [[ "$AVAIL_BYTES" -lt "$NEED_BYTES" ]]; then
  echo "磁盘空间不足。" >&2
  exit 1
fi
MEM_AVAILABLE_KB="$(awk '/MemAvailable:/ {print $2}' /proc/meminfo)"
if [[ "${MEM_AVAILABLE_KB:-0}" -lt 200000 ]]; then
  echo "可用内存过低。" >&2
  exit 1
fi

echo "==> 检查更新包内容"
if tar -tzf "$PACKAGE" | grep -E '(^|/)\.env$|(^|/)data/|(^|/)uploads/|\.db$|node_modules/|\.next/|\.git/'; then
  echo "更新包包含禁止内容。" >&2
  exit 1
fi

COMPOSE_OK=0
if tar -xOf "$PACKAGE" docker-compose.yml 2>/dev/null | grep -q "orangeito_default" \
  && tar -xOf "$PACKAGE" docker-compose.yml 2>/dev/null | grep -q "resume-social-security-check-app-1"; then
  COMPOSE_OK=1
fi
DOCKERFILE_OK=0
if tar -xOf "$PACKAGE" Dockerfile 2>/dev/null | grep -q "python3" \
  && tar -xOf "$PACKAGE" Dockerfile 2>/dev/null | grep -q "make" \
  && tar -xOf "$PACKAGE" Dockerfile 2>/dev/null | grep -q "g++"; then
  DOCKERFILE_OK=1
fi
if [[ "$COMPOSE_OK" -ne 1 || "$DOCKERFILE_OK" -ne 1 ]]; then
  echo "更新包未保留 Compose 外部网络/Caddy alias 或 better-sqlite3 构建依赖。" >&2
  exit 1
fi

echo "==> dry-run 计划"
cat <<PLAN
将执行（仅 --apply 时）:
1. 备份当前代码目录到 ../resume-social-security-check-backup-<ts>
2. sqlite3 .backup 一致性备份当前 SQLite，不覆盖生产 .env
3. docker tag 当前 resume-social-security-check:latest 为 rollback
4. 解包更新代码，复制已有生产 .env 到新目录（不覆盖原 .env）
5. docker compose config 验证，禁止 --remove-orphans
6. systemd-run 后台构建，只重建 resume-social-security-check-app
7. 确认新旧镜像 ID 不同
8. 检查容器 health 与本机 HTTPS/反代健康
9. 失败则恢复旧代码和 rollback 镜像
禁止: orangeito-app、orangeito-caddy、无关 Volume、宽泛 rm -rf、覆盖生产 .env
PLAN

if [[ "$APPLY" -eq 0 || "${DEPLOY_DRY_RUN:-1}" == "1" ]]; then
  echo "DRY-RUN 完成，未连接生产服务器，未修改任何容器或数据库。"
  exit 0
fi

if [[ -z "${DEPLOY_HOST:-}" ]]; then
  echo "未设置 DEPLOY_HOST，拒绝进入 apply。" >&2
  exit 1
fi

echo "本轮禁止连接生产服务器。" >&2
exit 1
