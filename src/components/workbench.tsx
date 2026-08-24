"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type HistoryItem = {
  id: string;
  status: string;
  candidateName: string | null;
  anomalyCount: number;
  conclusion: string | null;
  createdAt: string;
};

export function Workbench() {
  const router = useRouter();
  const [resume, setResume] = useState<File | null>(null);
  const [socials, setSocials] = useState<File[]>([]);
  const [usage, setUsage] = useState({ usage: 0, safeLimit: 190, warning: false });
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch("/api/ocr-usage").then((response) => response.json()),
      fetch("/api/history").then((response) => response.json()),
    ]).then(([ocr, records]) => {
      setUsage(ocr);
      setHistory(records);
    });
  }, []);

  async function submit() {
    if (!resume || socials.length === 0) {
      setError("请上传一份简历和至少一份社保材料");
      return;
    }
    setSubmitting(true);
    setError("");
    const form = new FormData();
    form.append("resume", resume);
    socials.forEach((file) => form.append("socialSecurity", file));
    const response = await fetch("/api/verification", { method: "POST", body: form });
    const data = await response.json();
    if (!response.ok) {
      setError(data.message || "任务创建失败");
      setSubmitting(false);
      return;
    }
    router.push(`/processing/${data.taskId}`);
  }

  const pendingCount = history.filter((item) => !["COMPLETED", "FAILED"].includes(item.status)).length;
  const completedToday = history.filter((item) => {
    const created = new Date(item.createdAt);
    const today = new Date();
    return (
      item.status === "COMPLETED" &&
      created.getFullYear() === today.getFullYear() &&
      created.getMonth() === today.getMonth() &&
      created.getDate() === today.getDate()
    );
  }).length;
  const anomalyCount = history.filter((item) => item.anomalyCount > 0).length;

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">今日工作台</p>
          <h1>下午好</h1>
          <p className="subtitle">
            {pendingCount > 0 ? `还有 ${pendingCount} 个核查任务正在处理。` : "当前没有正在处理的核查任务。"}
          </p>
        </div>
        <div className={`quota ${usage.warning ? "warning" : ""}`}>
          {usage.warning && "⚠ "}
          OCR {usage.usage} / {usage.safeLimit}
          {usage.warning && <small>本月免费 OCR 额度即将用完</small>}
        </div>
      </header>

      <section className="dashboard-widgets" aria-label="任务概览">
        {[
          ["待处理", pendingCount, "info"],
          ["待人工复核", "—", "neutral"],
          ["今日完成", completedToday, "success"],
          ["证据异常", anomalyCount, "warning"],
        ].map(([label, value, tone]) => (
          <div className={`dashboard-widget ${tone}`} key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </section>

      <section className="new-review-sheet" id="new-verification">
        <div className="sheet-heading">
          <div>
            <p className="eyebrow">新建核查</p>
            <h2>添加候选人材料</h2>
            <p>上传后将进入证据提取与确定性核验流程。</p>
          </div>
          <span className="sheet-status">本地文件 · 安全处理</span>
        </div>
        <div className="upload-grid">
          <label className={`upload-card ${resume ? "selected" : ""}`}>
            <span className="file-symbol">PDF</span>
            <span className="upload-copy">
              <strong>简历</strong>
              <small>{resume ? resume.name : "选择一份 PDF，最大 20MB"}</small>
            </span>
            <span className="upload-action">{resume ? "已读取" : "选择文件"}</span>
            <input
              type="file"
              accept=".pdf,application/pdf"
              onChange={(event) => setResume(event.target.files?.[0] ?? null)}
            />
          </label>
          <label className={`upload-card ${socials.length ? "selected" : ""}`}>
            <span className="file-symbol social">SS</span>
            <span className="upload-copy">
              <strong>社保证明</strong>
              <small>{socials.length ? `已选择 ${socials.length} 份材料` : "PDF 或图片，可选择多份"}</small>
            </span>
            <span className="upload-action">{socials.length ? "已读取" : "选择文件"}</span>
            <input
              type="file"
              multiple
              accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
              onChange={(event) => setSocials(Array.from(event.target.files ?? []))}
            />
          </label>
        </div>
        {error && <p className="form-error">{error}</p>}
        <div className="sheet-actions">
          <span>核验过程不会修改原始材料</span>
          <button className="primary-button" disabled={submitting} onClick={submit}>
            {submitting ? "正在创建任务…" : "开始核查"}
          </button>
        </div>
      </section>

      <section className="history-preview">
        <div className="section-heading">
          <h2>最近核验</h2>
          <Link href="/history">查看全部</Link>
        </div>
        {history.length === 0 ? (
          <div className="empty"><span>⌁</span><strong>暂无核验记录</strong><p>完成一次核查后，记录会显示在这里。</p></div>
        ) : (
          <div className="records-list">
            <div className="records-head">
              <span>候选人</span><span>状态</span><span>Evidence</span><span>更新时间</span><span />
            </div>
            {history.slice(0, 6).map((item) => (
              <Link className="history-row" href={item.status === "COMPLETED" ? `/result/${item.id}` : `/processing/${item.id}`} key={item.id}>
                <strong>{item.candidateName || "待识别候选人"}</strong>
                <span className={`row-status ${item.status.toLowerCase()}`}>
                  {item.status === "COMPLETED" ? "已完成" : item.status === "FAILED" ? "处理失败" : "处理中"}
                </span>
                <span>{item.anomalyCount ? `${item.anomalyCount} 项需关注` : "未发现异常"}</span>
                <time>{new Date(item.createdAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</time>
                <i>›</i>
              </Link>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
