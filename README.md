# 简历与社保严格核验

以社保缴纳记录为事实依据，逐段对照简历公司完整名称与起止月份。候选人姓名只用于标识任务，不参与核验结论。

自动通过必须同时满足：公司完整法律名称一致、开始月份差 = 0、结束月份差 = 0。相差 1 个月也不通过。简称、母子公司、集团与子公司、总分公司不得模糊自动通过。职位、实际缴费月数和定薪有效月数不再参与核验或展示。

## 业务主链

文件文字 → 轻量字段提取 → 单位编号映射 → 字段级人工修正 → 一一配对 → TypeScript 确定性计算 → 对照表及复制

DeepSeek 只返回候选人姓名和经历原文字段，不判断通过、不配对社保、不修改公司原文、不计算月份差或缴费年限。

新任务使用 `schemaVersion: 7`。简历每页同时保留原生文字和 General OCR，社保继续 Table OCR + General OCR。来源合并由 TypeScript 确定性规则完成，不用 AI 选边。旧 schema 2、4、5、6 只读展示，不自动改写或重算；无法解释时显示“旧版记录”。不得把 `task completed` 显示为完全一致。

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
npx tsc --noEmit
npm run test
npm run build
```

脱敏真实结构测试位于 `tests/v5-anonymized-structure.test.ts`、`tests/v6-hybrid-ocr.test.ts` 和 `tests/v7-core-review.test.ts`，不调用真实 DeepSeek 或阿里云 API。生产真实材料验收见 `docs/v6-local-manual-qa.md`，真实材料不得进入仓库。

## Docker 与现有 Caddy 部署

1. 将 `.env.example` 复制为 `.env`，仅在服务器填写 DeepSeek 与阿里云 RAM 凭证。
2. 执行 `docker compose up -d --build`。
3. 用 `docker compose ps`、`docker stats --no-stream`、`free -h` 和 `df -h` 检查状态。

Compose 只将应用绑定到宿主机 `127.0.0.1` 对应端口，不启动新的 Nginx，也不占用 80/443。生产流量保持 `check.orangeito.com → orangeito-caddy → resume-social-security-check-app:3000`。必须保留外部网络 `orangeito_default` 和 Caddy alias `resume-social-security-check-app-1`。Dockerfile 保留 `python3`、`make`、`g++` 以便构建 `better-sqlite3`。

禁止修改 `/opt/orangeito`，禁止操作 `orangeito-app`、`orangeito-caddy` 或无关 Docker Volume。

## 安全更新

```bash
./scripts/build-update-package.sh
./scripts/scan-sensitive.sh
./scripts/deploy-update.sh 更新包.tar.gz 更新包.tar.gz.sha256
```

`deploy-update.sh` 默认 dry-run，不连接生产服务器。它会校验明确路径、SHA256、磁盘和内存、更新包内容，并检查 Compose/Dockerfile 约束。远程 `--apply` 为 `MANUAL_ONLY`，本仓库不声称支持正式远程部署。服务器本机部署必须同时传入 `--apply-local --confirm=APPLY-LOCAL --app-dir=<生产根目录>`。禁止默认使用 `/home/admin`。SQLite 必须通过运行中容器 Docker Mount 解析。构建使用不可变标签 `resume-social-security-check:v7-<shortSha>`，必须 `docker image inspect` 确认镜像存在后才能提升 `latest`。systemd `Result=success` 不能代替镜像存在。

更新包不得包含 `.env`、密钥、SQLite、uploads、真实 PDF/图片、真实 OCR 原文、`node_modules`、构建缓存或 Git 脏文件。

## 核验规则摘要

- 单位编号优先从 Table OCR 行级对应映射到单位名称；Table 不可用时按 General OCR 编号列表与名称列表顺序映射。
- 不得把数字编号当作公司名称，不得用 AI 猜测对应关系。
- 只清除公司名前独立出现且带冒号的行政区域标签；法律名称中的“深圳市”等不得删除。
- 个人缴费窗口 / 个人缴费 / 灵活就业 → 待人工确认，不自动通过。
- 不再计算或展示实际缴费月数、定薪有效月数。
- 不得为表格整齐而强行配对；未配对记录保持待确认。
- 简历写“至今”时不得自动猜测结束月份，必须人工确认后才能严格比较。
- 同一任务中重复文件（SHA256）或重复页面（OCR 文本指纹）只提取一次，不删除用户上传，不视为核验不通过。
- 人工修正保存在版本化 `result_json` 中，包含 original/system/override/reviewStatus/updatedAt；保存后立即重算；无登录系统记录为 `manual-review`。

## 2C2G 服务器与 Swap

先执行 `free -h`。仅在 Swap 为 0 时创建 1GB OOM 保险。Swap 不能作为正常工作内存。应用容器限制为 1400MB，任务由 SQLite 单 Worker 串行处理。

## 数据与维护

- SQLite 和上传文件位于 Docker volume `app-data`。
- 原始文件最长保留 7 天；服务启动时和之后每 24 小时自动清理。
- 禁止新增数据库表或进行生产数据库迁移来保存人工修正。
- 手动清理可执行 `npm run cleanup`。
