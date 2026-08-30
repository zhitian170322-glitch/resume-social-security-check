"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import type {
  HumanReview,
  HumanReviewStatus,
  RecruiterComparisonRow,
  ResultViewModel,
} from "@/lib/result-view-model";
import type { FieldOverride, OverrideField } from "@/lib/manual-override";
import {
  companyHighlight,
  differenceHighlight,
  highlightLabel,
  rowStatusHighlight,
  type FieldHighlight,
} from "@/lib/result-highlight";

const reviewLabels: Record<HumanReviewStatus, string> = {
  PENDING: "待人工复核",
  CONFIRMED: "人工已确认",
  REJECTED: "人工已驳回",
};

const overrideFields: Array<{ field: OverrideField; label: string }> = [
  { field: "resumeCompany", label: "简历公司" },
  { field: "socialCompany", label: "社保公司" },
  { field: "position", label: "职位" },
  { field: "startMonth", label: "开始月份" },
  { field: "endMonth", label: "结束月份" },
  { field: "paymentType", label: "缴费类型" },
  { field: "unitCompany", label: "单位编号对应公司" },
];

function Highlight({
  kind,
  children,
}: {
  kind: FieldHighlight;
  children: React.ReactNode;
}) {
  return (
    <div className={`hl-cell hl-${kind}`}>
      <div>{children}</div>
      {kind !== "plain" && <small>{highlightLabel(kind)}</small>}
    </div>
  );
}

function currentValue(row: RecruiterComparisonRow, field: OverrideField) {
  if (field === "resumeCompany") return row.resumeCompany === "—" ? "" : row.resumeCompany;
  if (field === "socialCompany" || field === "unitCompany") {
    return row.socialCompany === "—" ? "" : row.socialCompany;
  }
  if (field === "position") return row.position === "—" ? "" : row.position;
  if (field === "startMonth") return row.resumePeriod.split(" 至 ")[0] ?? "";
  if (field === "endMonth") return row.endIsPresent ? "至今" : row.resumePeriod.split(" 至 ")[1] ?? "";
  if (field === "paymentType") return row.personalInsurance ? "personal" : "company";
  return "";
}

export function EvidenceResultView({
  model,
  copy,
  taskId,
  onResultChange,
}: {
  model: Extract<ResultViewModel, { legacy: false }>;
  copy: (text: string) => Promise<void>;
  taskId: string;
  onResultChange?: (next: ResultViewModel) => void;
}) {
  const searchParams = useSearchParams();
  const [review, setReview] = useState<HumanReview>(model.humanReview);
  const [reviewNote, setReviewNote] = useState(model.humanReview.reviewNote ?? "");
  const [reviewMessage, setReviewMessage] = useState("");
  const initialReviewId = model.recruiterTable.find(
    (row) => row.rowStatus === "NEEDS_REVIEW" || row.hasManualOverride,
  )?.id;
  const [selectedId, setSelectedId] = useState(
    searchParams.get("focus") === "review"
      ? initialReviewId ?? model.recruiterTable[0]?.id ?? ""
      : model.recruiterTable[0]?.id ?? "",
  );
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<OverrideField, string>>({
    resumeCompany: "",
    socialCompany: "",
    position: "",
    startMonth: "",
    endMonth: "",
    paymentType: "company",
    unitCompany: "",
  });
  const [expandedMonths, setExpandedMonths] = useState(false);
  const selectedRow =
    model.recruiterTable.find((row) => row.id === selectedId) ??
    model.recruiterTable[0];
  const summary = model.recruiterSummary;
  const totals = model.recruiterTotals;
  const firstReviewId = initialReviewId;

  useEffect(() => {
    if (searchParams.get("focus") === "review" && firstReviewId) {
      document.getElementById(`row-${firstReviewId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [firstReviewId, searchParams]);

  const appliedOverrides = useMemo(
    () => ((model.fieldOverrides ?? []) as FieldOverride[]).filter((entry) => entry.reviewStatus === "applied"),
    [model.fieldOverrides],
  );

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

  function openEdit(row: RecruiterComparisonRow) {
    setEditingId(row.id);
    setDraft({
      resumeCompany: currentValue(row, "resumeCompany"),
      socialCompany: currentValue(row, "socialCompany"),
      position: currentValue(row, "position"),
      startMonth: currentValue(row, "startMonth"),
      endMonth: currentValue(row, "endMonth"),
      paymentType: currentValue(row, "paymentType") || "company",
      unitCompany: currentValue(row, "unitCompany"),
    });
  }

  async function saveOverride(row: RecruiterComparisonRow) {
    const rowIndex = model.recruiterTable.findIndex((item) => item.id === row.id);
    for (const { field } of overrideFields) {
      const nextValue = draft[field]?.trim() || null;
      const systemValue = currentValue(row, field) || null;
      if (nextValue === systemValue) continue;
      const response = await fetch(`/api/verification/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          manualOverride: {
            id: `${row.id}-${field}`,
            rowIndex,
            field,
            originalValue: systemValue,
            systemValue,
            overrideValue: nextValue,
          },
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setReviewMessage(payload.message ?? "人工修正保存失败");
        return;
      }
      if (payload.result && onResultChange) {
        onResultChange({
          ...model,
          recruiterTable: payload.result.recruiterTable,
          recruiterTotals: payload.result.recruiterTotals,
          recruiterSummary: payload.result.recruiterSummary,
          monthDetails: payload.result.monthDetails,
          monthDetailsText: payload.result.monthDetailsText,
          fieldOverrides: payload.result.fieldOverrides,
          overallConclusion: payload.result.overallConclusion,
          overallConclusionLabel: payload.result.overallConclusionLabel,
        });
      }
    }
    setEditingId(null);
  }

  async function revertRow(row: RecruiterComparisonRow) {
    const related = appliedOverrides.filter((entry) => entry.id.startsWith(`${row.id}-`));
    for (const entry of related) {
      const response = await fetch(`/api/verification/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revertOverrideId: entry.id }),
      });
      const payload = await response.json();
      if (response.ok && payload.result && onResultChange) {
        onResultChange({
          ...model,
          recruiterTable: payload.result.recruiterTable,
          recruiterTotals: payload.result.recruiterTotals,
          recruiterSummary: payload.result.recruiterSummary,
          monthDetails: payload.result.monthDetails,
          monthDetailsText: payload.result.monthDetailsText,
          fieldOverrides: payload.result.fieldOverrides,
          overallConclusion: payload.result.overallConclusion,
          overallConclusionLabel: payload.result.overallConclusionLabel,
        });
      }
    }
  }

  const conclusionLabel = model.overallConclusionLabel ?? summary.conclusionLabel;
  const monthCards = [
    ["实际缴费", `${totals.actualPaidMonthCount}个月`, totals.actualPaidDuration],
    ["折算年限", totals.actualPaidDuration, `${totals.actualPaidMonthCount}个月`],
    ["公司缴纳", `${totals.companyPaidMonthCount}个月`, ""],
    ["个人缴纳", `${totals.personalPaidMonthCount}个月`, ""],
    ["缴费类型待确认", `${totals.unknownPaidMonthCount ?? 0}个月`, ""],
    ["定薪有效缴纳", `${totals.salaryEffectiveMonthCount}个月`, totals.salaryEffectiveDuration],
  ] as const;

  return (
    <>
      <section className={`result-hero recruiter-hero conclusion-${(model.overallConclusion ?? summary.conclusion).toLowerCase()}`}>
        <div className="result-icon" aria-hidden="true">
          {(model.overallConclusion ?? summary.conclusion) === "PASS" ? "✓" : "!"}
        </div>
        <div>
          <p className="eyebrow">核验结果</p>
          <div className="verdict">整体结论：{conclusionLabel}</div>
          {summary.detailLines.map((line) => (
            <p key={line}>{line}</p>
          ))}
          {model.nameStatus === "mismatch" && <p>姓名不一致，待人工确认</p>}
          {model.nameStatus === "unknown" && <p>姓名字段待确认</p>}
          {model.duplicateNotice && <p>{model.duplicateNotice}</p>}
          {totals.overlapMonthCount ? <p>重叠月份：{totals.overlapMonthCount}个月</p> : null}
        </div>
        <div className="trust-row">
          <button className="soft-button" onClick={() => copy(summary.fullText)}>
            复制完整核验结果
          </button>
        </div>
      </section>

      <section className="stat-grid recruiter-totals">
        {monthCards.map(([label, value]) => (
          <button
            className="stat month-card"
            key={label}
            onClick={() => setExpandedMonths((current) => !current)}
            type="button"
          >
            <span>{label}</span>
            <b className="nowrap">{value}</b>
          </button>
        ))}
      </section>

      {expandedMonths && (
        <section className="month-detail-panel">
          <div className="section-heading">
            <h2>月份明细</h2>
            <div className="table-actions">
              <button className="soft-button" onClick={() => copy(model.monthDetailsText || "待人工确认")}>
                复制月份明细
              </button>
              <button
                className="soft-button"
                onClick={() => copy(selectedRow?.socialStandardText || "待人工确认")}
              >
                复制社保标准信息
              </button>
            </div>
          </div>
          <div className="history-table-wrap">
            <table className="history-table">
              <thead>
                <tr>
                  <th>月份</th>
                  <th>单位编号</th>
                  <th>单位名称</th>
                  <th>缴费类型</th>
                  <th>来源文件</th>
                  <th>来源页</th>
                  <th>识别来源</th>
                </tr>
              </thead>
              <tbody>
                {(model.monthDetails ?? []).map((item) => (
                  <tr key={`${item.month}-${item.unitCode}-${item.companyRaw}`}>
                    <td className="nowrap">{item.month}</td>
                    <td>{item.unitCode ?? "待人工确认"}</td>
                    <td className="company-name">{item.companyRaw ?? "待人工确认"}</td>
                    <td>
                      {item.paymentType === "personal"
                        ? "个人缴纳"
                        : item.paymentType === "company"
                          ? "公司缴纳"
                          : "缴费类型待确认"}
                    </td>
                    <td>{item.sourceFile ?? "待人工确认"}</td>
                    <td>{item.sourcePage ?? "待人工确认"}</td>
                    <td>{item.origin === "manual" ? "人工修正" : "系统识别"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="table-card recruiter-table-card desktop-result-table">
        <div className="section-heading">
          <h2>完整核验表</h2>
          <button className="soft-button" onClick={() => copy(summary.fullText)}>
            复制完整核验结果
          </button>
        </div>
        <div className="result-table-scroll">
          <table>
            <thead>
              <tr>
                <th colSpan={3} className="group-resume">简历申报</th>
                <th colSpan={3} className="group-social">社保事实依据</th>
                <th colSpan={5} className="group-result">核验结果</th>
              </tr>
              <tr>
                <th className="group-resume">简历公司</th>
                <th className="group-resume">职位</th>
                <th className="group-resume">简历时间</th>
                <th className="group-social">社保公司</th>
                <th className="group-social">社保时间</th>
                <th className="group-social">实际缴费月数</th>
                <th>公司是否一致</th>
                <th>开始月份差</th>
                <th>结束月份差</th>
                <th>该段结果</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {model.recruiterTable.map((row) => (
                <tr
                  id={`row-${row.id}`}
                  className={row.id === selectedRow?.id ? "selected" : ""}
                  key={row.id}
                  onClick={() => setSelectedId(row.id)}
                >
                  <td className="cell-resume company-name">{row.resumeCompany}</td>
                  <td className="cell-resume">{row.position}</td>
                  <td className="cell-resume nowrap">{row.resumePeriod}</td>
                  <td className="cell-social company-name">{row.socialCompany}</td>
                  <td className="cell-social nowrap">{row.socialPeriod}</td>
                  <td className="cell-social nowrap">{row.paidMonthLabel}</td>
                  <td>
                    <Highlight kind={companyHighlight(row.companyConsistentLabel)}>
                      {row.companyConsistentLabel}
                    </Highlight>
                  </td>
                  <td>
                    <Highlight kind={differenceHighlight(row.startDifferenceLabel)}>
                      {row.startDifferenceLabel}
                    </Highlight>
                  </td>
                  <td>
                    <Highlight kind={differenceHighlight(row.endDifferenceLabel)}>
                      {row.endDifferenceLabel}
                    </Highlight>
                  </td>
                  <td>
                    <Highlight kind={row.hasManualOverride ? "override" : rowStatusHighlight(row.rowStatus)}>
                      {row.rowStatusLabel}
                    </Highlight>
                  </td>
                  <td>
                    <div className="table-actions">
                      <button className="copy-button" onClick={(event) => { event.stopPropagation(); void copy(row.itemText); }}>
                        复制该段结果
                      </button>
                      <button className="copy-button" onClick={(event) => { event.stopPropagation(); void copy(row.socialStandardText); }}>
                        复制社保标准信息
                      </button>
                      <button className="copy-button" onClick={(event) => { event.stopPropagation(); void copy(row.correctionReference); }}>
                        复制修正参考
                      </button>
                      <button className="copy-button" onClick={(event) => { event.stopPropagation(); openEdit(row); }}>
                        人工修正
                      </button>
                      {row.hasManualOverride && (
                        <button className="copy-button" onClick={(event) => { event.stopPropagation(); void revertRow(row); }}>
                          撤销人工修正
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mobile-result-cards">
        {model.recruiterTable.map((row) => (
          <article className="mobile-experience" id={`mobile-${row.id}`} key={row.id}>
            <section className="source-card resume-card">
              <h3>简历申报</h3>
              <p className="company-name">{row.resumeCompany}</p>
              <p>{row.position}</p>
              <p className="nowrap">{row.resumePeriod}</p>
            </section>
            <section className="source-card social-card">
              <h3>社保事实依据</h3>
              <p className="company-name">{row.socialCompany}</p>
              <p className="nowrap">{row.socialPeriod}</p>
              <p className="nowrap">{row.paidMonthLabel}</p>
              {row.verificationBaseline && (
                <p className="nowrap">核验基准：{row.verificationBaseline}</p>
              )}
            </section>
            <section className="source-card result-card">
              <h3>核验结果</h3>
              <Highlight kind={companyHighlight(row.companyConsistentLabel)}>
                公司是否一致：{row.companyConsistentLabel}
              </Highlight>
              <Highlight kind={differenceHighlight(row.startDifferenceLabel)}>
                开始月份差：{row.startDifferenceLabel}
              </Highlight>
              <Highlight kind={differenceHighlight(row.endDifferenceLabel)}>
                结束月份差：{row.endDifferenceLabel}
              </Highlight>
              <Highlight kind={row.hasManualOverride ? "override" : rowStatusHighlight(row.rowStatus)}>
                结论：{row.rowStatusLabel}
              </Highlight>
              <p>{row.reason}</p>
              <div className="table-actions">
                <button className="copy-button" onClick={() => copy(row.itemText)}>复制该段结果</button>
                <button className="copy-button" onClick={() => copy(row.socialStandardText)}>复制社保标准信息</button>
                <button className="copy-button" onClick={() => copy(row.correctionReference)}>复制修正参考</button>
                <button className="copy-button" onClick={() => openEdit(row)}>人工修正</button>
                {row.hasManualOverride && (
                  <button className="copy-button" onClick={() => revertRow(row)}>撤销人工修正</button>
                )}
              </div>
            </section>
          </article>
        ))}
      </section>

      {selectedRow && (
        <article className="experience-card recruiter-detail-card">
          <div className="experience-title">
            <div>
              <small>第 {selectedRow.index} 段对照</small>
              <h3 className="company-name">
                {selectedRow.resumeCompany !== "—" ? selectedRow.resumeCompany : selectedRow.socialCompany}
              </h3>
            </div>
            <span className={`badge ${selectedRow.rowStatus === "PASS" ? "" : "warn"}`}>
              {selectedRow.rowStatusLabel}
            </span>
          </div>
          {selectedRow.hasManualOverride && <p className="hl-override-flag">已人工修正</p>}
          {selectedRow.endIsPresent && (
            <p className="nowrap">
              简历结束：至今 · 社保截止：{selectedRow.socialPeriod.split(" 至 ")[1] ?? "待人工确认"} · 核验基准：{selectedRow.verificationBaseline ?? "待人工确认"}
            </p>
          )}
          <p className={selectedRow.rowStatus === "PASS" ? "result-note" : "difference"}>
            {selectedRow.reason}
          </p>
        </article>
      )}

      {editingId && selectedRow && (
        <section className="override-panel">
          <h2>人工修正</h2>
          <p>不修改原始 PDF、图片、简历文字或 OCR 原文。保存后立即重新配对和计算。</p>
          <div className="override-grid">
            {overrideFields.map(({ field, label }) => (
              <label key={field}>
                {label}
                {field === "paymentType" ? (
                  <select
                    value={draft.paymentType}
                    onChange={(event) => setDraft({ ...draft, paymentType: event.target.value })}
                  >
                    <option value="company">公司缴纳</option>
                    <option value="personal">个人缴纳</option>
                    <option value="unknown">缴费类型待确认</option>
                  </select>
                ) : (
                  <input
                    value={draft[field]}
                    onChange={(event) => setDraft({ ...draft, [field]: event.target.value })}
                  />
                )}
              </label>
            ))}
          </div>
          <div className="table-actions">
            <button className="soft-button" onClick={() => saveOverride(selectedRow)}>保存并重算</button>
            <button className="soft-button" onClick={() => setEditingId(null)}>取消</button>
          </div>
        </section>
      )}

      <section className="summary-card human-review-card">
        <div>
          <p className="eyebrow">人工复核</p>
          <h2>{reviewLabels[review.reviewStatus]}</h2>
          <p>机器原始结论：{conclusionLabel}</p>
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
