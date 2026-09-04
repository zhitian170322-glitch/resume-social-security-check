"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { displayStatusLabel, recordHref, statusToneClass } from "@/lib/status-tone";

type Item = {
  id: string;
  status: string;
  candidateName: string | null;
  overallConclusion: string;
  overallConclusionLabel: string;
  passCount: number | null;
  failCount: number | null;
  reviewCount: number | null;
  createdAt: string;
  updatedAt: string | null;
  reviewStatus: string | null;
};

const STATUS_OPTIONS = [
  { value: "", label: "全部" },
  { value: "处理中", label: "处理中" },
  { value: "通过", label: "通过" },
  { value: "不通过", label: "不通过" },
  { value: "待人工确认", label: "待人工确认" },
  { value: "已终止", label: "已终止" },
  { value: "处理失败", label: "处理失败" },
];

export function HistoryView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [items, setItems] = useState<Item[]>([]);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [form, setForm] = useState({
    candidateName: searchParams.get("candidateName") ?? "",
    resumeCompany: searchParams.get("resumeCompany") ?? "",
    socialCompany: searchParams.get("socialCompany") ?? "",
    status: searchParams.get("status") ?? (searchParams.get("review") === "1" ? "待人工确认" : ""),
    from: searchParams.get("from") ?? "",
    to: searchParams.get("to") ?? "",
  });

  useEffect(() => {
    if (searchParams.get("review") === "1" && !searchParams.get("status")) {
      router.replace("/history?status=待人工确认");
    }
  }, [router, searchParams]);

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(form)) {
      if (value) params.set(key, value);
    }
    return params.toString();
  }, [form]);

  useEffect(() => {
    fetch(`/api/history?${queryString}`)
      .then((response) => response.json())
      .then(setItems);
  }, [queryString]);

  function applySearch(event: React.FormEvent) {
    event.preventDefault();
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(form)) {
      if (value) params.set(key, value);
    }
    router.replace(`/history?${params.toString()}`);
  }

  async function remove(id: string) {
    const response = await fetch(`/api/verification/${id}`, { method: "DELETE" });
    if (response.ok) {
      setItems((current) => current.filter((item) => item.id !== id));
      setPendingDelete(null);
    }
  }

  return (
    <main className="shell history-page">
      <div className="result-header">
        <div>
          <p className="eyebrow">核验档案</p>
          <h1>核查记录</h1>
        </div>
        <nav>
          <Link className="soft-button" href="/">返回工作台</Link>
        </nav>
      </div>

      <form className="search-panel" onSubmit={applySearch}>
        <label>
          候选人姓名
          <input
            value={form.candidateName}
            onChange={(event) => setForm({ ...form, candidateName: event.target.value })}
          />
        </label>
        <label>
          简历公司
          <input
            value={form.resumeCompany}
            onChange={(event) => setForm({ ...form, resumeCompany: event.target.value })}
          />
        </label>
        <label>
          社保公司
          <input
            value={form.socialCompany}
            onChange={(event) => setForm({ ...form, socialCompany: event.target.value })}
          />
        </label>
        <label>
          核验状态
          <select
            value={form.status}
            onChange={(event) => setForm({ ...form, status: event.target.value })}
          >
            {STATUS_OPTIONS.map((option) => (
              <option key={option.label} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        <label>
          开始日期
          <input type="date" value={form.from} onChange={(event) => setForm({ ...form, from: event.target.value })} />
        </label>
        <label>
          结束日期
          <input type="date" value={form.to} onChange={(event) => setForm({ ...form, to: event.target.value })} />
        </label>
        <button className="soft-button" type="submit">搜索</button>
      </form>

      {items.length === 0 ? (
        <div className="empty">暂无核验记录</div>
      ) : (
        <div className="history-table-wrap">
          <table className="history-table history-access-table">
            <thead>
              <tr>
                <th>候选人</th>
                <th>整体结论</th>
                <th>一致数量</th>
                <th>不通过数量</th>
                <th>待确认数量</th>
                <th>更新时间</th>
                <th>查看结果</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const href = recordHref(item);
                const label = displayStatusLabel(item);
                return (
                  <tr className="history-access" key={item.id}>
                    <td className="history-name">
                      <Link className="row-link" href={href}>{item.candidateName || "姓名待人工确认"}</Link>
                    </td>
                    <td>
                      <span className={`tone-chip ${statusToneClass(label)}`}>{label}</span>
                    </td>
                    <td>{item.status === "COMPLETED" ? item.passCount ?? "—" : "—"}</td>
                    <td>{item.status === "COMPLETED" ? item.failCount ?? "—" : "—"}</td>
                    <td>{item.status === "COMPLETED" ? item.reviewCount ?? "—" : "—"}</td>
                    <td className="history-time nowrap">
                      {new Date(item.updatedAt || item.createdAt).toLocaleString("zh-CN")}
                    </td>
                    <td className="nowrap">
                      <Link className="row-cta" href={href}>查看结果 →</Link>
                      <button
                        className="danger-text"
                        type="button"
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          setPendingDelete(item.id);
                        }}
                      >
                        删除
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {pendingDelete && (
        <div className="modal-backdrop">
          <div className="modal">
            <h2>确认删除</h2>
            <p>删除记录及仍保留的原始文件？此操作不可撤销。</p>
            <div className="modal-actions">
              <button type="button" onClick={() => setPendingDelete(null)}>取消</button>
              <button className="danger-button" type="button" onClick={() => remove(pendingDelete)}>
                确认删除
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
