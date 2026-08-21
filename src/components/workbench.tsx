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

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">内部核验工具</p>
          <h1>简历与社保智能核验</h1>
          <p className="subtitle">以社保缴纳记录为基准，核验候选人简历工作经历</p>
        </div>
        <div className={`quota ${usage.warning ? "warning" : ""}`}>
          {usage.warning && "⚠ "}
          OCR {usage.usage} / {usage.safeLimit}
          {usage.warning && <small>本月免费 OCR 额度即将用完</small>}
        </div>
      </header>

      <section className="upload-grid">
        <label className={`upload-card ${resume ? "selected" : ""}`}>
          <span className="upload-icon">📄</span>
          <strong>上传简历</strong>
          <span>仅支持 PDF</span>
          <span>单文件最大 20MB</span>
          <input
            type="file"
            accept=".pdf,application/pdf"
            onChange={(event) => setResume(event.target.files?.[0] ?? null)}
          />
          {resume && <b className="filename">{resume.name}</b>}
        </label>
        <label className={`upload-card ${socials.length ? "selected" : ""}`}>
          <span className="upload-icon">🧾</span>
          <strong>上传社保证明</strong>
          <span>支持 PDF / JPG / JPEG / PNG</span>
          <span>支持多份，单文件最大 20MB</span>
          <input
            type="file"
            multiple
            accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
            onChange={(event) => setSocials(Array.from(event.target.files ?? []))}
          />
          {socials.length > 0 && (
            <b className="filename">已选择 {socials.length} 份材料</b>
          )}
        </label>
      </section>
      {error && <p className="form-error">{error}</p>}
      <button className="primary-button" disabled={submitting} onClick={submit}>
        {submitting ? "正在创建任务…" : "开始智能核验"}
      </button>

      <section className="history-preview">
        <div className="section-heading">
          <h2>最近核验</h2>
          <Link href="/history">查看全部</Link>
        </div>
        {history.length === 0 ? (
          <div className="empty">暂无核验记录</div>
        ) : (
          history.slice(0, 5).map((item) => (
            <Link className="history-row" href={`/result/${item.id}`} key={item.id}>
              <div>
                <strong>{item.candidateName || "待识别候选人"}</strong>
                <span>{new Date(item.createdAt).toLocaleString("zh-CN")}</span>
              </div>
              <div className={item.anomalyCount ? "status-warn" : "status-ok"}>
                {item.status === "COMPLETED"
                  ? item.anomalyCount
                    ? `⚠ 发现 ${item.anomalyCount} 项差异`
                    : "✓ 完全一致"
                  : item.status === "FAILED"
                    ? "处理失败"
                    : "处理中"}
                <span>查看结果 →</span>
              </div>
            </Link>
          ))
        )}
      </section>
    </main>
  );
}
