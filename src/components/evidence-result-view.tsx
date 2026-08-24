"use client";

import { useState } from "react";
import type {
  DisplayEvidenceStatus,
  HumanReview,
  HumanReviewStatus,
  ResultEvidenceDisplay,
  ResultViewItem,
  ResultViewModel,
} from "@/lib/result-view-model";

const evidenceStatusLabels: Record<DisplayEvidenceStatus, string> = {
  VALIDATED: "✓ 已验证",
  UNCERTAIN: "⚠ 需确认",
  CONFLICT: "× 存在冲突",
  LOW_CONFIDENCE: "⚠ OCR 低置信度",
  MISSING: "— 缺失",
  UNSUPPORTED: "— 不支持自动确认",
};

const reviewLabels: Record<HumanReviewStatus, string> = {
  PENDING: "待人工复核",
  CONFIRMED: "人工已确认",
  REJECTED: "人工已驳回",
};

function periodText(period: ResultViewItem["resumePeriod"]) {
  return period ? `${period.startMonth} ～ ${period.endMonth}` : "无";
}

function evidenceText(item: ResultViewItem) {
  return [
    `公司：${item.rawResumeCompanyName ?? item.rawSocialSecurityCompanyName ?? "无法确定"}`,
    `简历时间：${periodText(item.resumePeriod)}`,
    `社保时间：${periodText(item.socialSecurityPeriod)}`,
    `公司匹配：${item.companyMatchLabel}`,
    `实际缴费：${item.paidMonths.join("、") || "无"}`,
    `缺失月份：${item.missingMonths.join("、") || "无"}`,
    `额外月份：${item.extraMonths.join("、") || "无"}`,
    `断缴月份：${item.gapMonths.join("、") || "无"}`,
    `结论：${item.statusLabel}`,
    `说明：${item.description}`,
    ...item.evidence.map(
      (evidence) =>
        `${evidence.field}：${evidence.rawValue ?? "缺失"}\n${evidence.sourceFile} 第 ${evidence.sourcePage} 页\n${evidence.sourceQuote}`,
    ),
  ].join("\n");
}

function MonthChips({
  title,
  months,
  tone = "paid",
}: {
  title: string;
  months: string[];
  tone?: "paid" | "missing" | "extra";
}) {
  if (!months.length) return null;
  return (
    <div className="month-group">
      <strong>{title}</strong>
      <div className="month-chips">
        {months.map((month) => (
          <span className={`month-chip ${tone}`} key={`${title}-${month}`}>
            {month}
          </span>
        ))}
      </div>
    </div>
  );
}

function EvidenceBlock({ evidence }: { evidence: ResultEvidenceDisplay }) {
  return (
    <article className="evidence-block">
      <div className="evidence-block-title">
        <strong>{evidence.field}</strong>
        <span className={`evidence-status ${evidence.validationStatus.toLowerCase()}`}>
          {evidenceStatusLabels[evidence.validationStatus]}
        </span>
      </div>
      <dl>
        <div><dt>原始字段</dt><dd>{evidence.rawValue ?? "—"}</dd></div>
        <div><dt>来源</dt><dd>{evidence.sourceFile} · 第 {evidence.sourcePage} 页</dd></div>
        <div><dt>提取方式</dt><dd>{evidence.extractionMethod}</dd></div>
        {evidence.confidence !== null && (
          <div><dt>Provider 置信度</dt><dd>{evidence.confidence.toFixed(2)}</dd></div>
        )}
      </dl>
      <blockquote>{evidence.sourceQuote || "未保存可展示的原文片段"}</blockquote>
      {evidence.tableCells.map((cell) => (
        <p className="cell-location" key={cell.id}>
          表格 {cell.tableIndex + 1} · 第 {cell.rowIndex + 1} 行 · 第 {cell.columnIndex + 1} 列
          {cell.bbox ? " · 已保存位置坐标" : ""}
        </p>
      ))}
    </article>
  );
}

function EvidenceInspector({ item }: { item: ResultViewItem }) {
  const resumeEvidence = item.evidence.filter((entry) =>
    entry.field.startsWith("resume"),
  );
  const socialEvidence = item.evidence.filter((entry) =>
    entry.field.startsWith("social") || entry.field === "paidMonths",
  );
  return (
    <div className="evidence-inspector-content">
      <div className="evidence-layer">
        <h4>简历依据</h4>
        {resumeEvidence.length ? (
          resumeEvidence.map((entry) => <EvidenceBlock evidence={entry} key={entry.id} />)
        ) : (
          <p className="muted">无对应简历 Evidence</p>
        )}
      </div>
      <div className="evidence-layer">
        <h4>社保依据</h4>
        {socialEvidence.length ? (
          socialEvidence.map((entry) => <EvidenceBlock evidence={entry} key={entry.id} />)
        ) : (
          <p className="muted">无对应社保 Evidence</p>
        )}
      </div>
      <div className="evidence-layer">
        <h4>派生事实</h4>
        {item.derivedFact ? (
          <>
            <p><strong>公司原文：</strong>{item.derivedFact.companyRaw}</p>
            <p><strong>paidMonths 来源：</strong>{item.derivedFact.paidMonthsSource}</p>
            <MonthChips title="已验证缴费月份" months={item.derivedFact.paidMonths} />
          </>
        ) : (
          <p className="muted">没有可用于自动核验的 Derived Facts</p>
        )}
      </div>
      <div className="evidence-layer">
        <h4>核验结果</h4>
        <p>{item.description}</p>
        <p><strong>规则：</strong>{item.rules.join("；")}</p>
        <p><strong>人工复核：</strong>{item.requiresManualReview ? "需要" : "不需要"}</p>
      </div>
    </div>
  );
}

function MonthsTimeline({ item }: { item: ResultViewItem }) {
  const months = Array.from(
    new Set([...item.paidMonths, ...item.missingMonths, ...item.extraMonths, ...item.gapMonths]),
  ).sort();
  if (!months.length) return <p className="muted">没有可展示的月度事实</p>;
  const years = Array.from(new Set(months.map((month) => month.slice(0, 4))));
  return (
    <div className="months-timeline">
      {years.map((year) => (
        <div className="timeline-year" key={year}>
          <strong>{year}</strong>
          <div className="timeline-months">
            {months.filter((month) => month.startsWith(year)).map((month) => {
              const tone = item.gapMonths.includes(month) || item.missingMonths.includes(month)
                ? "missing"
                : item.extraMonths.includes(month)
                  ? "extra"
                  : "paid";
              const label = tone === "paid" ? "已验证缴纳" : tone === "extra" ? "额外月份" : "缺失或断缴";
              return (
                <span className={`timeline-month ${tone}`} key={month} title={`${month} · ${label}`}>
                  <i />
                  <small>{month.slice(5)}</small>
                </span>
              );
            })}
          </div>
        </div>
      ))}
      <div className="timeline-legend">
        <span><i className="paid" />已验证缴纳</span>
        <span><i className="missing" />缺失 / 断缴</span>
        <span><i className="extra" />额外月份</span>
      </div>
    </div>
  );
}

export function EvidenceResultView({
  model,
  copy,
  taskId,
}: {
  model: Extract<ResultViewModel, { legacy: false }>;
  copy: (text: string) => Promise<void>;
  taskId: string;
}) {
  const [review, setReview] = useState<HumanReview>(model.humanReview);
  const [reviewNote, setReviewNote] = useState(model.humanReview.reviewNote ?? "");
  const [reviewMessage, setReviewMessage] = useState("");
  const [selectedId, setSelectedId] = useState(model.items[0]?.id ?? "");
  const selected = model.items.find((item) => item.id === selectedId) ?? model.items[0];

  async function saveReview(reviewStatus: HumanReviewStatus) {
    setReviewMessage("正在保存…");
    const response = await fetch(`/api/verification/${taskId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reviewStatus, reviewNote }),
    });
    const payload = await response.json();
    if (!response.ok) {
      setReviewMessage(payload.message ?? "人工复核保存失败");
      return;
    }
    setReview(payload.humanReview);
    setReviewMessage("已保存，机器结论保持不变");
  }

  return (
    <>
    <section className={`mobile-result-summary result-hero conclusion-${model.machineResult.conclusion.toLowerCase()}`}>
      <div className="result-icon" aria-hidden="true">{model.machineResult.conclusion === "CONSISTENT" ? "✓" : "!"}</div>
      <div>
        <p className="eyebrow">机器核验结果</p>
        <div className="verdict">{model.machineResult.label}</div>
        <p>{model.trustStatus.label} · 系统只陈述材料事实</p>
      </div>
    </section>
    <div className="result-workspace">
      <aside className="experiences-pane">
        <div className="pane-heading">
          <span>工作经历</span>
          <small>{model.items.length}</small>
        </div>
        <div className="experience-nav">
          {model.items.map((item, index) => (
            <button
              className={item.id === selected?.id ? "selected" : ""}
              key={item.id}
              onClick={() => setSelectedId(item.id)}
            >
              <span className="experience-index">{String(index + 1).padStart(2, "0")}</span>
              <strong>{item.rawResumeCompanyName || item.rawSocialSecurityCompanyName || "无法确定公司"}</strong>
              <small>{periodText(item.resumePeriod ?? item.socialSecurityPeriod)}</small>
              <span className={item.matchStatus === "EXACT_MATCH" ? "nav-state success" : "nav-state warning"}>
                {item.matchStatus === "EXACT_MATCH" ? "✓" : "⚠"} {item.statusLabel}
              </span>
            </button>
          ))}
        </div>
      </aside>

      <section className="verification-pane">
        <section className={`result-hero conclusion-${model.machineResult.conclusion.toLowerCase()}`}>
          <div className="result-icon" aria-hidden="true">
            {model.machineResult.conclusion === "CONSISTENT" ? "✓" : "!"}
          </div>
          <div>
            <p className="eyebrow">机器核验结果</p>
            <div className="verdict">{model.machineResult.label}</div>
            <p>系统只陈述材料事实，不判断候选人动机。</p>
          </div>
          <div className="trust-row">
            <span className={`trust-badge ${model.trustStatus.code.toLowerCase()}`}>
              {model.trustStatus.label}
            </span>
          </div>
        </section>
        <section className="compact-stats">
          {[
            ["简历经历", model.summary.resumeExperienceCount],
            ["社保单位", model.summary.socialSecurityCompanyCount],
            ["严格一致", model.summary.exactMatchCount],
            ["需复核", model.summary.manualReviewCount],
          ].map(([label, value]) => <div key={label}><strong>{value}</strong><span>{label}</span></div>)}
        </section>
        {model.evidenceIssues.length > 0 && (
          <details className="attention-panel">
            <summary>{model.evidenceIssues.length} 项证据状态需要关注</summary>
            {model.evidenceIssues.map((issue, index) => (
              <p key={`${issue.field}-${index}`}>{issue.code} · 第 {issue.sourcePage} 页 · {issue.message}</p>
            ))}
          </details>
        )}
        {selected ? (
          <article className="verification-card">
            <div className="experience-title">
              <div>
                <small>当前核验记录</small>
                <h3>{selected.rawResumeCompanyName || selected.rawSocialSecurityCompanyName || "关键字段无法确定"}</h3>
              </div>
              <span className={`badge ${selected.matchStatus !== "EXACT_MATCH" ? "warn" : ""}`}>
                {selected.statusLabel}
              </span>
            </div>
            {selected.specialLabels.length > 0 && (
              <div className="special-labels">{selected.specialLabels.map((label) => <span key={label}>{label}</span>)}</div>
            )}
            <div className="comparison-grid">
              <section>
                <small>简历记录</small>
                <strong>{selected.rawResumeCompanyName ?? "—"}</strong>
                <span>{periodText(selected.resumePeriod)}</span>
              </section>
              <div className="versus">VS</div>
              <section>
                <small>社保记录</small>
                <strong>{selected.rawSocialSecurityCompanyName ?? "—"}</strong>
                <span>{periodText(selected.socialSecurityPeriod)}</span>
              </section>
            </div>
            <dl className="match-metadata">
              <div><dt>公司匹配</dt><dd>{selected.companyMatchLabel}</dd></div>
              <div><dt>核验状态</dt><dd>{selected.statusLabel}</dd></div>
            </dl>
            {selected.normalizedCompanyName && (
              <p className="normalized-hint">辅助标准化：{selected.normalizedCompanyName}（不参与完全一致判定）</p>
            )}
            <section className="timeline-section">
              <div className="section-heading"><h4>月份时间轴</h4><span>仅展示 Engine 输出</span></div>
              <MonthsTimeline item={selected} />
            </section>
            <div className="month-summary">
              <MonthChips title="实际缴费" months={selected.paidMonths} />
              <MonthChips title="缺失月份" months={selected.missingMonths} tone="missing" />
              <MonthChips title="额外月份" months={selected.extraMonths} tone="extra" />
              <MonthChips title="断缴月份" months={selected.gapMonths} tone="missing" />
            </div>
            <p className={selected.matchStatus === "EXACT_MATCH" ? "result-note" : "difference"}>{selected.description}</p>
            <button className="soft-button" onClick={() => copy(evidenceText(selected))}>复制本条核验依据</button>
          </article>
        ) : <div className="empty"><strong>没有可展示的工作经历</strong></div>}
      </section>

      <aside className="inspector-pane">
        <div className="pane-heading">
          <span>Evidence Inspector</span>
          <span className={`review-badge ${review.reviewStatus.toLowerCase()}`}>{reviewLabels[review.reviewStatus]}</span>
        </div>
        {selected ? <EvidenceInspector item={selected} /> : <p className="muted">选择一段经历查看证据</p>}
        <section className="human-review-card">
        <div>
          <p className="eyebrow">人工复核</p>
          <h2>{reviewLabels[review.reviewStatus]}</h2>
          <p>机器原始结论：{model.machineResult.label}</p>
          <p className="review-separation">人工复核不会修改机器原始结论。</p>
          {review.reviewedAt && <p>复核时间：{new Date(review.reviewedAt).toLocaleString("zh-CN")}</p>}
        </div>
        <label>
          复核备注
          <textarea
            maxLength={2000}
            onChange={(event) => setReviewNote(event.target.value)}
            placeholder="记录人工判断依据，不会修改原始 Evidence"
            value={reviewNote}
          />
        </label>
        <div className="review-actions">
          <button className="soft-button" onClick={() => saveReview("PENDING")}>标记待复核</button>
          <button className="review-confirm" onClick={() => saveReview("CONFIRMED")}>确认机器结果</button>
          <button className="review-reject" onClick={() => saveReview("REJECTED")}>驳回机器结果</button>
        </div>
        {reviewMessage && <p className="muted">{reviewMessage}</p>}
      </section>
      </aside>
    </div>
    </>
  );
}
