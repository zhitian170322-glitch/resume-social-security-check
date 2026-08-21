"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Item = {
  id: string;
  status: string;
  candidateName: string | null;
  anomalyCount: number;
  conclusion: string | null;
  createdAt: string;
};

export function HistoryView() {
  const [items, setItems] = useState<Item[]>([]);
  useEffect(() => {
    fetch("/api/history").then((response) => response.json()).then(setItems);
  }, []);

  async function remove(id: string) {
    if (!window.confirm("删除记录及仍保留的原始文件？")) return;
    const response = await fetch(`/api/verification/${id}`, { method: "DELETE" });
    if (response.ok) setItems((current) => current.filter((item) => item.id !== id));
  }

  return (
    <main className="shell history-page">
      <div className="result-header">
        <div>
          <p className="eyebrow">核验档案</p>
          <h1>历史记录</h1>
        </div>
        <nav><Link className="soft-button" href="/">返回工作台</Link></nav>
      </div>
      {items.length === 0 ? (
        <div className="empty">暂无核验记录</div>
      ) : items.map((item) => (
        <div className="history-row" key={item.id}>
          <Link href={item.status === "COMPLETED" ? `/result/${item.id}` : `/processing/${item.id}`}>
            <strong>{item.candidateName || "待识别候选人"}</strong>
            <span>{new Date(item.createdAt).toLocaleString("zh-CN")}</span>
          </Link>
          <div className={item.anomalyCount ? "status-warn" : "status-ok"}>
            <strong>
              {item.status === "COMPLETED"
                ? item.anomalyCount ? `⚠ 发现 ${item.anomalyCount} 项差异` : "✓ 完全一致"
                : item.status === "FAILED" ? "处理失败" : "处理中"}
            </strong>
            <span>{item.conclusion || "等待核验结论"}</span>
            <button onClick={() => remove(item.id)}>删除记录</button>
          </div>
        </div>
      ))}
    </main>
  );
}
