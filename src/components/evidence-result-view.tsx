"use client";

import { useState } from "react";
import type {
  DisplayEvidenceStatus,
  HumanReview,
  HumanReviewStatus,
  RecruiterComparisonRow,
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
      </dl>
      <blockquote>{evidence.sourceQuote || "未保存可展示的原文片段"}</blockquote>
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
    </div>
  );
}

function rowTone(status: RecruiterComparisonRow["rowStatus"]) {
  if (status === "PASS") return "pass";
  if (status === "FAIL" || status === "SOCIAL_ONLY" || status === "RESUME_ONLY") {
    return "fail";
  }
  return "review";
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
  const [selectedId, setSelectedId] = useState(model.recruiterTable[0]?.id ?? "");
  const selectedRow =
    model.recruiterTable.find((row) => row.id === selectedId) ??
    model.recruiterTable[0];
  const selected =
    model.items.find((item) => item.id === selectedRow?.id) ?? model.items[0];
  const summary = model.recruiterSummary;
  const totals = model.recruiterTotals;

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
      <section className={`result-hero recruiter-hero conclusion-${summary.conclusion.toLowerCase()}`}>
        <div className="result-icon" aria-hidden="true">
          {summary.conclusion === "PASS" ? "✓" : "!"}
        </div>
        <div>
          <p className="eyebrow">核验结果</p>
          <div className="verdict">{summary.headline}</div>
          {summary.detailLines.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
        <div className="trust-row">
          <button className="soft-button" onClick={() => copy(summary.fullText)}>
            复制完整核验结果
          </button>
        </div>
      </section>

      <section className="stat-grid recruiter-totals">
        {[
          ["实际缴费", `${totals.actualPaidMonthCount}个月`],
          ["折算年限", totals.actualPaidDuration],
          ["公司缴纳", `${totals.companyPaidMonthCount}个月`],
          ["个人缴纳", `${totals.personalPaidMonthCount}个月`],
          ["定薪有效缴纳", `${totals.salaryEffectiveMonthCount}个月`],
          ["核验记录", `${summary.totalRows}段`],
        ].map(([label, value]) => (
          <div className="stat" key={label}>
            <span>{label}</span>
            <b>{value}</b>
          </div>
        ))}
      </section>

      <section className="table-card recruiter-table-card">
        <div className="section-heading">
          <h2>完整核验表</h2>
          <button className="soft-button" onClick={() => copy(summary.fullText)}>
            复制完整核验结果
          </button>
        </div>
        <table>
          <thead>
            <tr>
              <th>序号</th>
              <th>简历公司</th>
              <th>职位</th>
              <th>简历时间</th>
              <th>社保公司</th>
              <th>社保时间</th>
              <th>公司是否一致</th>
              <th>开始月份差</th>
              <th>结束月份差</th>
              <th>该段结果</th>
              <th>实际社保月数</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {model.recruiterTable.map((row) => (
              <tr
                className={`${rowTone(row.rowStatus)} ${row.id === selectedRow?.id ? "selected" : ""}`}
                key={row.id}
                onClick={() => setSelectedId(row.id)}
              >
                <td>{row.index}</td>
                <td>{row.resumeCompany}</td>
                <td>{row.position}</td>
                <td>{row.resumePeriod}</td>
                <td>{row.socialCompany}</td>
                <td>{row.socialPeriod}</td>
                <td>{row.companyConsistentLabel}</td>
                <td>{row.startDifferenceLabel}</td>
                <td>{row.endDifferenceLabel}</td>
                <td>
                  <span className={`badge ${row.rowStatus === "PASS" ? "" : "warn"}`}>
                    {row.rowStatusLabel}
                  </span>
                </td>
                <td>{row.paidMonthLabel}</td>
                <td>
                  <div className="table-actions">
                    <button
                      className="copy-button"
                      onClick={(event) => {
                        event.stopPropagation();
                        void copy(row.itemText);
                      }}
                    >
                      复制该段
                    </button>
                    <button
                      className="copy-button"
                      onClick={(event) => {
                        event.stopPropagation();
                        void copy(row.socialStandardText);
                      }}
                    >
                      复制社保信息
                    </button>
                    <button
                      className="copy-button"
                      onClick={(event) => {
                        event.stopPropagation();
                        void copy(row.correctionReference);
                      }}
                    >
                      复制修正参考
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {selectedRow && selected && (
        <article className="experience-card recruiter-detail-card">
          <div className="experience-title">
            <div>
              <small>第 {selectedRow.index} 段对照</small>
              <h3>{selectedRow.resumeCompany !== "—" ? selectedRow.resumeCompany : selectedRow.socialCompany}</h3>
            </div>
            <span className={`badge ${selectedRow.rowStatus === "PASS" ? "" : "warn"}`}>
              {selectedRow.rowStatusLabel}
            </span>
          </div>
          <div className="detail-grid">
            <div className="field">
              <label>简历公司</label>
              <p>{selectedRow.resumeCompany}</p>
            </div>
            <div className="field">
              <label>社保公司</label>
              <p>{selectedRow.socialCompany}</p>
            </div>
            <div className="field">
              <label>职位</label>
              <p>{selectedRow.position}</p>
            </div>
            <div className="field">
              <label>简历时间</label>
              <p>{selectedRow.resumePeriod}</p>
            </div>
            <div className="field">
              <label>社保时间</label>
              <p>{selectedRow.socialPeriod}</p>
            </div>
            <div className="field">
              <label>实际社保月数</label>
              <p>{selectedRow.paidMonthLabel}</p>
            </div>
          </div>
          <p className={selectedRow.rowStatus === "PASS" ? "result-note" : "difference"}>
            {selectedRow.reason}
          </p>
          <div className="review-actions recruiter-copy-actions">
            <button className="soft-button" onClick={() => copy(selectedRow.itemText)}>
              复制该段结果
            </button>
            <button className="soft-button" onClick={() => copy(selectedRow.socialStandardText)}>
              复制社保标准信息
            </button>
            <button className="soft-button" onClick={() => copy(selectedRow.correctionReference)}>
              复制修正参考
            </button>
          </div>
          {selected.evidence.length > 0 ? (
            <details className="evidence-details">
              <summary>技术调试信息</summary>
              <EvidenceInspector item={selected} />
            </details>
          ) : null}
        </article>
      )}

      <section className="summary-card human-review-card">
        <div>
          <p className="eyebrow">人工复核</p>
          <h2>{reviewLabels[review.reviewStatus]}</h2>
          <p>机器原始结论：{model.machineResult.label}</p>
          <p className="review-separation">人工复核不会修改机器原始结论，也不会改写简历原文。</p>
        </div>
        <label>
          复核备注
          <textarea
            maxLength={2000}
            onChange={(event) => setReviewNote(event.target.value)}
            placeholder="记录人工判断依据，不会修改原始字段"
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
    </>
  );
}
