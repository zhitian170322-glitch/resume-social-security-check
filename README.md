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

## Docker 部署

1. 将 `.env.example` 复制为 `.env`，仅在服务器填写 DeepSeek 与阿里云 RAM 凭证。
2. 将正式证书放到 `deploy/certs/fullchain.pem` 和 `deploy/certs/privkey.pem`。未提供时容器只会生成短期自签名证书，供启动检查使用。
3. 执行 `docker compose up -d --build`。
4. 用 `docker compose ps`、`docker stats --no-stream`、`free -h` 和 `df -h` 检查状态。

Nginx 默认对请求设置 `client_max_body_size 20M`，仅核验多文件上传接口按需求允许总计 50MB（预留 multipart 开销为 52MB）。上传目录没有静态路由，不能从公网访问。

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
- 手动清理可执行 `npm run cleanup`。

## 回滚

部署前记录当前镜像 ID，并备份 volume：

```bash
docker compose images
docker run --rm -v resume-social-security-check_app-data:/data \
  -v "$PWD":/backup alpine tar czf /backup/app-data-backup.tgz -C /data .
```

回滚时停止新版本，恢复上一镜像标签；如数据库也需回退，先保留当前副本，再从备份恢复 `/data`。禁止直接删除 volume。
