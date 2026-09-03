#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "用法: $0 更新包.tar.gz 更新包.tar.gz.sha256 [--apply-local --confirm=APPLY-LOCAL]" >&2
  echo "默认 dry-run，只校验包，不改容器、不改数据库、不连接生产。" >&2
  echo "MODE=MANUAL_ONLY：不支持远程 --apply。本机部署必须同时传入 --apply-local 和 --confirm=APPLY-LOCAL。" >&2
  exit 2
}

MODE="dry-run"
CONFIRM=""
ARGS=()
for arg in "$@"; do
  if [[ "$arg" == "--apply-local" ]]; then
    MODE="apply-local"
  elif [[ "$arg" == "--apply" ]]; then
    MODE="manual-only"
  elif [[ "$arg" == --confirm=* ]]; then
    CONFIRM="${arg#--confirm=}"
  else
    ARGS+=("$arg")
  fi
done

if [[ ${#ARGS[@]} -ne 2 ]]; then
  usage
fi

PACKAGE="${ARGS[0]}"
CHECKSUM="${ARGS[1]}"
DOCKER_BIN="${DOCKER_BIN:-docker}"
COMPOSE_BIN="${COMPOSE_BIN:-}"
SQLITE_BIN="${SQLITE_BIN:-sqlite3}"
CURL_BIN="${CURL_BIN:-curl}"
APP_SERVICE="${APP_SERVICE:-resume-social-security-check-app}"
IMAGE_REPO="${IMAGE_REPO:-resume-social-security-check}"
HEALTH_URL="${HEALTH_URL:-https://check.orangeito.com}"
APP_DIR="${DEPLOY_APP_DIR:-}"

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
if tar -tzf "$PACKAGE" | grep -E '(^|/)\.env$|(^|/)data/|(^|/)uploads/|(^|/)data/processing/|(^|/)data/reports/|\.db$|node_modules/|\.next/|\.git/'; then
  echo "更新包包含禁止内容。" >&2
  exit 1
fi

COMPOSE_FILE="$(tar -tzf "$PACKAGE" | grep -E '(^|/)docker-compose\.yml$' | head -1)"
DOCKERFILE="$(tar -tzf "$PACKAGE" | grep -E '(^|/)Dockerfile$' | head -1)"
COMPOSE_OK=0
if [[ -n "$COMPOSE_FILE" ]] \
  && tar -xOf "$PACKAGE" "$COMPOSE_FILE" | grep -q "orangeito_default" \
  && tar -xOf "$PACKAGE" "$COMPOSE_FILE" | grep -q "resume-social-security-check-app-1"; then
  COMPOSE_OK=1
fi
DOCKERFILE_OK=0
if [[ -n "$DOCKERFILE" ]] \
  && tar -xOf "$PACKAGE" "$DOCKERFILE" | grep -q "python3" \
  && tar -xOf "$PACKAGE" "$DOCKERFILE" | grep -q "make" \
  && tar -xOf "$PACKAGE" "$DOCKERFILE" | grep -q "g++"; then
  DOCKERFILE_OK=1
fi
if [[ "$COMPOSE_OK" -ne 1 || "$DOCKERFILE_OK" -ne 1 ]]; then
  echo "更新包未保留 Compose 外部网络/Caddy alias 或 better-sqlite3 构建依赖。" >&2
  exit 1
fi

SHORT_SHA="$(basename "$PACKAGE" | sed -n 's/.*update-\([0-9a-f]\{7,40\}\).*/\1/p')"
if [[ -z "$SHORT_SHA" ]]; then
  SHORT_SHA="unknown"
fi
IMAGE_TAG="v6-${SHORT_SHA:0:7}"

echo "==> dry-run 计划"
cat <<PLAN
MODE=MANUAL_ONLY：远程 --apply 不受支持，禁止把 dry-run 当成可正式部署。
本机模式必须同时传入 --apply-local --confirm=APPLY-LOCAL。
将执行（仅 --apply-local 且确认后）:
1. 校验包 SHA256 与包内容
2. 检查磁盘和内存
3. 备份当前代码目录，不覆盖生产 .env
4. sqlite3 .backup 并 PRAGMA integrity_check
5. 给旧镜像打 rollback 标签
6. 使用不可变标签构建 ${IMAGE_REPO}:${IMAGE_TAG}
7. docker image inspect 确认镜像存在；systemd Result=success 不能代替镜像存在
8. 新镜像 ID 与旧镜像 ID 不同后，才提升 latest
9. 只重建 ${APP_SERVICE}，禁止 --remove-orphans
10. 健康检查：容器 healthy、实际 Image ID、${HEALTH_URL} HTTP 200、SQLite integrity_check=ok
11. 失败则恢复旧源码、旧镜像标签并重建旧容器
禁止: orangeito-app、orangeito-caddy、Caddy、OrangeITO、Docker Volume、生产 .env、宽泛 rm -rf
PLAN

if [[ "$MODE" == "dry-run" ]]; then
  echo "DRY-RUN 完成，未连接生产服务器，未修改任何容器或数据库。"
  exit 0
fi

if [[ "$MODE" == "manual-only" ]]; then
  echo "MANUAL_ONLY: 远程 --apply 未实现。本仓库禁止声称支持正式远程部署。" >&2
  echo "如需服务器本机部署，请使用: $0 包.tar.gz 包.tar.gz.sha256 --apply-local --confirm=APPLY-LOCAL" >&2
  exit 1
fi

if [[ "$CONFIRM" != "APPLY-LOCAL" ]]; then
  echo "拒绝执行 --apply-local：缺少显式确认参数 --confirm=APPLY-LOCAL。" >&2
  exit 1
fi

resolve_compose() {
  if [[ -n "$COMPOSE_BIN" ]]; then
    echo "$COMPOSE_BIN"
    return
  fi
  if "$DOCKER_BIN" compose version >/dev/null 2>&1; then
    echo "$DOCKER_BIN compose"
    return
  fi
  if command -v docker-compose >/dev/null 2>&1; then
    echo "docker-compose"
    return
  fi
  echo "$DOCKER_BIN compose"
}

image_id() {
  local ref="$1"
  "$DOCKER_BIN" image inspect "$ref" --format '{{.Id}}' 2>/dev/null || true
}

require_image() {
  local ref="$1"
  if ! "$DOCKER_BIN" image inspect "$ref" >/dev/null 2>&1; then
    echo "镜像不存在: $ref。不得把 systemd Result=success 当成构建成功。" >&2
    return 1
  fi
}

backup_sqlite() {
  local db_path="$1"
  local dest="$2"
  if [[ ! -f "$db_path" ]]; then
    echo "未找到 SQLite，跳过库备份: $db_path"
    return 0
  fi
  "$SQLITE_BIN" "$db_path" ".backup '$dest'"
  local check
  check="$("$SQLITE_BIN" "$dest" "PRAGMA integrity_check;")"
  if [[ "$check" != "ok" ]]; then
    echo "SQLite integrity_check 失败: $check" >&2
    return 1
  fi
  echo "SQLite backup ok: $dest"
}

restore_previous() {
  local backup_dir="$1"
  local rollback_tag="$2"
  echo "==> 失败回滚"
  if [[ -d "$backup_dir" && -n "$APP_DIR" ]]; then
    mkdir -p "$APP_DIR"
    cp -a "$backup_dir"/. "$APP_DIR"/
  fi
  if [[ -n "$rollback_tag" ]] && "$DOCKER_BIN" image inspect "$rollback_tag" >/dev/null 2>&1; then
    "$DOCKER_BIN" tag "$rollback_tag" "${IMAGE_REPO}:latest"
    local compose
    compose="$(resolve_compose)"
    (
      cd "$APP_DIR"
      # shellcheck disable=SC2086
      IMAGE_TAG=latest $compose up -d --no-deps app
    ) || true
  fi
}

apply_local() {
  if [[ -z "$APP_DIR" ]]; then
    APP_DIR="$(pwd)"
  fi
  if [[ ! -d "$APP_DIR" ]]; then
    echo "部署目录不存在: $APP_DIR" >&2
    exit 1
  fi
  local ts backup_dir extract_dir rollback_tag old_id new_id db_path db_backup compose
  ts="$(date +%Y%m%d%H%M%S)"
  backup_dir="${APP_DIR%/}-backup-${ts}"
  extract_dir="$(mktemp -d "${TMPDIR:-/tmp}/rssc-extract-${ts}-XXXXXX")"
  rollback_tag="${IMAGE_REPO}:rollback-${ts}"
  db_path="${SQLITE_PATH:-$APP_DIR/data/app.db}"
  db_backup="${backup_dir}.sqlite"
  compose="$(resolve_compose)"

  echo "==> 备份源码目录到 $backup_dir"
  mkdir -p "$backup_dir"
  cp -a "$APP_DIR"/. "$backup_dir"/

  echo "==> SQLite .backup 与 integrity_check"
  backup_sqlite "$db_path" "$db_backup"

  old_id="$(image_id "${IMAGE_REPO}:latest")"
  if [[ -n "$old_id" ]]; then
    echo "==> 为旧镜像建立 rollback 标签 $rollback_tag"
    "$DOCKER_BIN" tag "${IMAGE_REPO}:latest" "$rollback_tag"
  fi

  echo "==> 解包更新代码（保留现有生产 .env）"
  tar -xzf "$PACKAGE" -C "$extract_dir"
  local src
  src="$(find "$extract_dir" -mindepth 1 -maxdepth 2 -type d -name "resume-social-security-check" | head -1)"
  if [[ -z "$src" ]]; then
    src="$(find "$extract_dir" -mindepth 1 -maxdepth 1 -type d | head -1)"
  fi
  if [[ -z "$src" ]]; then
    echo "更新包没有可部署的源码目录。" >&2
    exit 1
  fi
  if [[ -f "$APP_DIR/.env" ]]; then
    cp -a "$APP_DIR/.env" "$extract_dir/.env.keep"
  fi
  find "$src" -mindepth 1 -maxdepth 1 ! -name ".env" -exec cp -a {} "$APP_DIR"/ \;
  if [[ -f "$extract_dir/.env.keep" ]]; then
    cp -a "$extract_dir/.env.keep" "$APP_DIR/.env"
  fi

  echo "==> 构建不可变标签 ${IMAGE_REPO}:${IMAGE_TAG}"
  (
    cd "$APP_DIR"
    # systemd-run 即使 Result=success 也不能代替镜像检查。
    # shellcheck disable=SC2086
    IMAGE_TAG="$IMAGE_TAG" $compose build app
  )

  echo "==> docker image inspect ${IMAGE_REPO}:${IMAGE_TAG}"
  if ! require_image "${IMAGE_REPO}:${IMAGE_TAG}"; then
    restore_previous "$backup_dir" "$rollback_tag"
    exit 1
  fi
  new_id="$(image_id "${IMAGE_REPO}:${IMAGE_TAG}")"
  if [[ -z "$new_id" ]]; then
    echo "构建未导出镜像。" >&2
    restore_previous "$backup_dir" "$rollback_tag"
    exit 1
  fi
  if [[ -n "$old_id" && "$new_id" == "$old_id" ]]; then
    echo "新镜像 ID 与旧镜像 ID 相同，拒绝提升 latest。" >&2
    restore_previous "$backup_dir" "$rollback_tag"
    exit 1
  fi

  echo "==> 提升 ${IMAGE_REPO}:${IMAGE_TAG} 为 latest"
  "$DOCKER_BIN" tag "${IMAGE_REPO}:${IMAGE_TAG}" "${IMAGE_REPO}:latest"

  echo "==> 只重建 ${APP_SERVICE}，禁止 --remove-orphans"
  (
    cd "$APP_DIR"
    # shellcheck disable=SC2086
    IMAGE_TAG="$IMAGE_TAG" $compose up -d --no-deps app
  ) || {
    restore_previous "$backup_dir" "$rollback_tag"
    exit 1
  }

  echo "==> 健康检查"
  local container_id container_image container_health http_code sqlite_check
  container_id="$("$DOCKER_BIN" inspect -f '{{.Id}}' "$APP_SERVICE" 2>/dev/null || true)"
  container_image="$("$DOCKER_BIN" inspect -f '{{.Image}}' "$APP_SERVICE" 2>/dev/null || true)"
  container_health="$("$DOCKER_BIN" inspect -f '{{.State.Health.Status}}' "$APP_SERVICE" 2>/dev/null || echo "unknown")"
  if [[ "$container_health" != "healthy" && "${DEPLOY_SKIP_HEALTHCHECK:-0}" != "1" ]]; then
    echo "容器未 healthy: $container_health" >&2
    restore_previous "$backup_dir" "$rollback_tag"
    exit 1
  fi
  if [[ -n "$new_id" && -n "$container_image" && "$container_image" != "$new_id" && "${DEPLOY_SKIP_HEALTHCHECK:-0}" != "1" ]]; then
    echo "容器 Image ID 与新镜像不一致。" >&2
    restore_previous "$backup_dir" "$rollback_tag"
    exit 1
  fi
  http_code="$("$CURL_BIN" -ks -o /dev/null -w '%{http_code}' "$HEALTH_URL" || true)"
  if [[ "$http_code" != "200" && "${DEPLOY_SKIP_HEALTHCHECK:-0}" != "1" ]]; then
    echo "${HEALTH_URL} 未返回 HTTP 200: $http_code" >&2
    restore_previous "$backup_dir" "$rollback_tag"
    exit 1
  fi
  if [[ -f "$db_path" ]]; then
    sqlite_check="$("$SQLITE_BIN" "$db_path" "PRAGMA integrity_check;")"
    if [[ "$sqlite_check" != "ok" ]]; then
      echo "部署后 SQLite integrity_check 失败。" >&2
      restore_previous "$backup_dir" "$rollback_tag"
      exit 1
    fi
  fi

  if [[ -d "$extract_dir" ]]; then
    find "$extract_dir" -mindepth 1 -delete
    rmdir "$extract_dir" || true
  fi
  echo "APPLY-LOCAL 完成。镜像=${IMAGE_REPO}:${IMAGE_TAG} id=${new_id} container=${container_id:-unknown}"
}

apply_local
