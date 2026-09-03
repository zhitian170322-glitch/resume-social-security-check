"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type HistoryItem = {
  id: string;
  status: string;
  candidateName: string | null;
  overallConclusion: string;
  overallConclusionLabel: string;
  createdAt: string;
  updatedAt: string | null;
  reviewStatus: string | null;
};

function conclusionClass(label: string) {
  if (label === "通过") return "tone-pass";
  if (label === "不通过") return "tone-fail";
  if (label === "待人工确认") return "tone-review";
  return "tone-legacy";
}

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
  const reviewCount = history.filter(
    (item) => item.overallConclusion === "NEEDS_REVIEW" || item.reviewStatus === "PENDING",
  ).length;
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
  const failCount = history.filter((item) => item.overallConclusion === "FAIL").length;

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">今日工作台</p>
          <h1>简历与社保严格核验</h1>
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
        <div className="dashboard-widget info">
          <span>待处理</span>
          <strong>{pendingCount}</strong>
        </div>
        <Link className="dashboard-widget warning" href="/history?review=1">
          <span>待人工复核</span>
          <strong>{reviewCount}</strong>
        </Link>
        <div className="dashboard-widget success">
          <span>今日完成</span>
          <strong>{completedToday}</strong>
        </div>
        <div className="dashboard-widget warning">
          <span>不通过</span>
          <strong>{failCount}</strong>
        </div>
      </section>

      <section className="new-review-sheet" id="new-verification">
        <div className="sheet-heading">
          <div>
            <p className="eyebrow">新建核查</p>
            <h2>添加候选人材料</h2>
            <p>上传后按社保事实依据逐段对照简历经历。</p>
          </div>
          <span className="sheet-status">本地文件 · 安全处理</span>
        </div>
        <div className="upload-grid">
          <label className={`upload-card ${resume ? "selected" : ""}`}>
            <span className="file-symbol">PDF</span>
            <span className="upload-copy">
              <strong>简历</strong>
              <small>{resume ? resume.name : "PDF / 图片 / DOCX，最大 20MB"}</small>
            </span>
            <span className="upload-action">{resume ? "已读取" : "选择文件"}</span>
            <input
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,.docx,application/pdf,image/jpeg,image/png,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
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
          <div className="empty"><strong>暂无核验记录</strong><p>完成一次核查后，记录会显示在这里。</p></div>
        ) : (
          <div className="records-list">
            <div className="records-head">
              <span>候选人</span><span>整体结论</span><span>更新时间</span><span />
            </div>
            {history.slice(0, 6).map((item) => (
              <Link
                className="history-row"
                href={item.status === "COMPLETED" ? `/result/${item.id}` : `/processing/${item.id}`}
                key={item.id}
              >
                <strong>{item.candidateName || "姓名待人工确认"}</strong>
                <span className={`tone-chip ${conclusionClass(item.overallConclusionLabel)}`}>
                  {item.status === "FAILED"
                    ? "处理失败"
                    : item.status !== "COMPLETED"
                      ? "处理中"
                      : item.overallConclusionLabel}
                </span>
                <time>
                  {new Date(item.updatedAt || item.createdAt).toLocaleString("zh-CN", {
                    month: "2-digit",
                    day: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </time>
                <i>›</i>
              </Link>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
