"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

type Item = {
  id: string;
  status: string;
  candidateName: string | null;
  overallConclusion: string;
  overallConclusionLabel: string;
  passCount: number | null;
  failCount: number | null;
  reviewCount: number | null;
  actualPaidMonthCount: number | null;
  salaryEffectiveMonthCount: number | null;
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

export function HistoryView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [items, setItems] = useState<Item[]>([]);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [form, setForm] = useState({
    candidateName: searchParams.get("candidateName") ?? "",
    resumeCompany: searchParams.get("resumeCompany") ?? "",
    socialCompany: searchParams.get("socialCompany") ?? "",
    status: searchParams.get("status") ?? "",
    from: searchParams.get("from") ?? "",
    to: searchParams.get("to") ?? "",
  });
  const reviewOnly = searchParams.get("review") === "1";

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(form)) {
      if (value) params.set(key, value);
    }
    if (reviewOnly) params.set("review", "1");
    return params.toString();
  }, [form, reviewOnly]);

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
    if (reviewOnly) params.set("review", "1");
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
          <p className="eyebrow">{reviewOnly ? "复核队列" : "核验档案"}</p>
          <h1>{reviewOnly ? "待人工复核" : "历史记录"}</h1>
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
            <option value="">全部</option>
            <option value="通过">通过</option>
            <option value="不通过">不通过</option>
            <option value="待人工确认">待人工确认</option>
            <option value="旧版记录">旧版记录</option>
          </select>
        </label>
        <label>
          开始日期
          <input
            type="date"
            value={form.from}
            onChange={(event) => setForm({ ...form, from: event.target.value })}
          />
        </label>
        <label>
          结束日期
          <input
            type="date"
            value={form.to}
            onChange={(event) => setForm({ ...form, to: event.target.value })}
          />
        </label>
        <button className="soft-button" type="submit">搜索</button>
      </form>

      {items.length === 0 ? (
        <div className="empty">暂无核验记录</div>
      ) : (
        <div className="history-table-wrap">
          <table className="history-table">
            <thead>
              <tr>
                <th>候选人</th>
                <th>整体结论</th>
                <th>一致数量</th>
                <th>不通过数量</th>
                <th>待确认数量</th>
                <th>实际缴费月数</th>
                <th>定薪有效月数</th>
                <th>更新时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td className="history-name">{item.candidateName || "姓名待人工确认"}</td>
                  <td>
                    <span className={`tone-chip ${conclusionClass(item.overallConclusionLabel)}`}>
                      {item.status === "FAILED"
                        ? "处理失败"
                        : item.status !== "COMPLETED"
                          ? "处理中"
                          : item.overallConclusionLabel}
                    </span>
                  </td>
                  <td>{item.passCount ?? "—"}</td>
                  <td>{item.failCount ?? "—"}</td>
                  <td>{item.reviewCount ?? "—"}</td>
                  <td className="nowrap">{item.actualPaidMonthCount ?? "—"}</td>
                  <td className="nowrap">{item.salaryEffectiveMonthCount ?? "—"}</td>
                  <td className="history-time nowrap">
                    {new Date(item.updatedAt || item.createdAt).toLocaleString("zh-CN")}
                  </td>
                  <td>
                    <div className="table-actions">
                      <Link
                        className="soft-button"
                        href={
                          item.status === "COMPLETED"
                            ? `/result/${item.id}${reviewOnly ? "?focus=review" : ""}`
                            : `/processing/${item.id}`
                        }
                      >
                        查看
                      </Link>
                      <button className="danger-text" onClick={() => setPendingDelete(item.id)}>
                        删除
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
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
              <button onClick={() => setPendingDelete(null)}>取消</button>
              <button className="danger-button" onClick={() => remove(pendingDelete)}>
                确认删除
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
