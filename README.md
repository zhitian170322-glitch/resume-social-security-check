# 简历与社保智能核验系统 V1.0

以社保缴纳记录为核验基准，客观展示候选人简历声明与社保事实之间的差异。系统不会判断候选人的动机或使用“造假”等定性表述。

## 本地运行

系统依赖 Node.js 22、Poppler（`pdfinfo`、`pdftotext`、`pdftoppm`）和 SQLite。

```bash
cp .env.example .env
npm install
npm run db:init
npm run dev
```

未配置真实 API Key 时，自动化测试和 Build 可正常运行；实际扫描件 OCR 或材料结构化任务会返回明确错误，不会伪造 API 结果。

## 验证

```bash
npm run lint
npm run test
npm run build
```

## Docker 与现有 Caddy 部署

1. 将 `.env.example` 复制为 `.env`，仅在服务器填写 DeepSeek 与阿里云 RAM 凭证。
2. 执行 `docker compose up -d --build`。
3. 用 `docker compose ps`、`docker stats --no-stream`、`free -h` 和 `df -h` 检查状态。

Compose 只将应用绑定到宿主机 `127.0.0.1:${APP_PORT:-3100}`，不启动新的
Nginx，也不占用 80/443。生产流量保持
`check.orangeito.com → orangeito-caddy → resume-social-security-check-app:3000`。
如果 Caddy 在容器内运行，只需把应用容器接入 Caddy 已有 Docker network；禁止修改
`/opt/orangeito`。Caddy 上传上限应允许 52MB multipart 请求，应用仍逐文件限制 20MB、
单任务总量限制 50MB。上传目录没有静态路由。

## P0 准确率流水线

- 简历逐页评估原生 PDF 文本；双栏、表格、错序或低质量页执行 OCR 双通道比较。
- 社保页使用阿里云 `RecognizeTableOcr`，保留 cells/rows/columns，再进入深圳、广东或通用模板 Parser。
- DeepSeek 只定位简历经历候选区块；所有输出必须引用同页、同一段连续原文。
- Evidence Validator 验证 quote、公司原文和受控月份转换；失败字段不能进入自动核验。
- 只有公司原文、时间和社保证据全部验证通过才可能输出 `EXACT_MATCH`。
- 未知模板、低置信度、PDF/OCR冲突、疑似同主体、外包/派遣及个人参保均转人工复核。
- 阶段结果和 OCR 页面按 SHA-256 缓存，失败从当前阶段重试，不重复成功的付费识别。

数据库 migration 只新增列和表。旧记录保留 `schema_version=1`，结果页显示
“旧版本任务，无完整证据链”；新版任务使用 `schema_version=2`。

## 2C2G 服务器与 Swap

先执行 `free -h`。仅在 Swap 为 0 时创建 1GB OOM 保险：

```bash
sudo fallocate -l 1G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

Swap 不能作为正常工作内存。应用容器限制为 1400MB，任务由 SQLite 单 Worker 串行处理，PDF 按页提取与转图。

## 数据与维护

- SQLite 和上传文件位于 Docker volume `app-data`。
- 原始文件最长保留 7 天；服务启动时和之后每 24 小时自动清理。
- PDF 转图等中间文件在每页处理后立即删除。
- 结构化数据、核验结果、OCR 文字和 OCR 调用统计长期保留。
- 每个新版任务记录 OCR 页数、OCR/DeepSeek 调用次数、缓存命中及预估成本。
- 手动清理可执行 `npm run cleanup`。

## 回滚

部署前保留当前镜像并备份 volume：

```bash
docker compose images
docker image tag resume-social-security-check:latest resume-social-security-check:rollback
docker run --rm -v resume-social-security-check_app-data:/data \
  -v "$PWD":/backup alpine tar czf /backup/app-data-backup.tgz -C /data .
```

应用回滚使用当前 Compose（避免旧版 Nginx重新占用80/443）：

```bash
IMAGE_TAG=rollback docker compose up -d --no-build app
```

Migration 只向前新增表和列，通常不回滚数据库。如确需恢复数据，先保留当前副本，再从
`app-data-backup.tgz` 恢复 `/data`。禁止直接删除 volume。
