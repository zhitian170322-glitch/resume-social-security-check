"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import type {
  RecruiterComparisonRow,
  ResultViewModel,
} from "@/lib/result-view-model";
import type { OverrideField } from "@/lib/manual-override";
import { fieldOriginFromOverride, fieldOriginLabel } from "@/lib/review-state";
import { statusToneClass } from "@/lib/status-tone";

const CORE_FIELDS: Array<{ field: OverrideField; label: string }> = [
  { field: "resumeCompany", label: "简历公司" },
  { field: "resumeStartMonth", label: "简历开始月份" },
  { field: "resumeEndMonth", label: "简历结束月份" },
  { field: "socialCompany", label: "社保公司" },
  { field: "socialStartMonth", label: "社保开始月份" },
  { field: "socialEndMonth", label: "社保结束月份" },
];

function FieldEvidence({
  evidence,
}: {
  evidence?: {
    label: string;
    sourceLabel: string;
    sourceFile?: string | null;
    pageNumber: number | null;
    quote: string;
    conflict: boolean;
    alternatives?: Array<{
      sourceLabel: string;
      pageNumber: number | null;
      quote: string;
    }>;
  };
}) {
  if (!evidence) return null;
  return (
    <details className={`field-evidence ${evidence.conflict ? "conflict" : ""}`}>
      <summary>识别依据</summary>
      {evidence.conflict && <p className="source-conflict-flag">来源冲突，待确认</p>}
      <p>来源文件：{evidence.sourceFile || "—"}</p>
      <p>页码：{evidence.pageNumber ?? "—"}</p>
      <p>识别通道：{evidence.sourceLabel}</p>
      <p className="evidence-quote">原文片段：{evidence.quote}</p>
      {evidence.alternatives?.map((item) => (
        <p className="evidence-quote" key={`${item.sourceLabel}-${item.quote}`}>
          {item.sourceLabel}
          {item.pageNumber ? ` 第${item.pageNumber}页` : ""}：{item.quote}
        </p>
      ))}
    </details>
  );
}

function CompanyDiff({ row }: { row: RecruiterComparisonRow }) {
  if (!row.companyDiff) return null;
  return (
    <p className="company-diff" aria-label="公司名称字符差异">
      <span>
        {row.companyDiff.left.map((item, index) => (
          <b key={`l${index}`} className={item.changed ? "diff-char" : undefined}>{item.char}</b>
        ))}
      </span>
      <span className="diff-sep">↔</span>
      <span>
        {row.companyDiff.right.map((item, index) => (
          <b key={`r${index}`} className={item.changed ? "diff-char" : undefined}>{item.char}</b>
        ))}
      </span>
    </p>
  );
}

function currentValue(row: RecruiterComparisonRow, field: OverrideField) {
  if (field === "resumeCompany") return row.resumeCompany === "—" ? "" : row.resumeCompany;
  if (field === "socialCompany") return row.socialCompany === "—" ? "" : row.socialCompany;
  if (field === "resumeStartMonth" || field === "startMonth") return row.resumeStartMonth ?? "";
  if (field === "resumeEndMonth" || field === "endMonth") return row.resumeEndMonth ?? "";
  if (field === "socialStartMonth") return row.socialStartMonth ?? "";
  if (field === "socialEndMonth") return row.socialEndMonth ?? "";
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
  const report = model as Extract<ResultViewModel, { legacy: false }> & {
    reviewLock?: { locked: boolean };
    reviewProgress?: {
      pendingFieldCount: number;
      confirmedFieldCount: number;
      correctedFieldCount: number;
    };
    conclusionSourceLabel?: string;
    sourceConflicts?: unknown[];
  };
  const [message, setMessage] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [relinkId, setRelinkId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const initialId = model.recruiterTable.find(
    (row) => row.rowStatus === "NEEDS_REVIEW" || row.hasManualOverride,
  )?.id;
  const [selectedId, setSelectedId] = useState(
    searchParams.get("focus") === "review"
      ? initialId ?? model.recruiterTable[0]?.id ?? ""
      : model.recruiterTable[0]?.id ?? "",
  );
  const selected = useMemo(
    () => model.recruiterTable.find((row) => row.id === selectedId) ?? model.recruiterTable[0],
    [model.recruiterTable, selectedId],
  );
  const locked = Boolean(report.reviewLock?.locked);
  const progress = report.reviewProgress ?? {
    pendingFieldCount: model.recruiterTable.filter((row) => row.rowStatus === "NEEDS_REVIEW" || row.rowStatus === "RESUME_ONLY" || row.rowStatus === "SOCIAL_ONLY").length,
    confirmedFieldCount: 0,
    correctedFieldCount: 0,
  };
  const unpairedResume = model.recruiterTable.filter((row) => row.rowStatus === "RESUME_ONLY");
  const unpairedSocial = model.recruiterTable.filter((row) => row.rowStatus === "SOCIAL_ONLY");

  useEffect(() => {
    if (searchParams.get("focus") !== "review" || !initialId) return;
    document.getElementById(initialId)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [initialId, searchParams]);

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    setMessage("");
    const response = await fetch(`/api/verification/${taskId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    setBusy(false);
    if (!response.ok) {
      setMessage(data.message || "保存失败");
      return null;
    }
    if (data.result && onResultChange) {
      onResultChange({
        ...model,
        recruiterTable: data.result.recruiterTable,
        recruiterSummary: data.result.recruiterSummary,
        recruiterTotals: data.result.recruiterTotals,
        overallConclusion: data.result.overallConclusion,
        overallConclusionLabel: data.result.overallConclusionLabel,
        fieldOverrides: data.result.fieldOverrides,
        reviewLock: data.result.reviewLock,
        reviewProgress: data.result.reviewProgress,
        conclusionSourceLabel: data.result.conclusionSourceLabel,
        sourceConflicts: data.result.sourceConflicts,
      });
    }
    return data;
  }

  async function confirmRow(row: RecruiterComparisonRow, index: number) {
    await patch({
      confirmFields: {
        rowIndex: index,
        fields: CORE_FIELDS.map((item) => item.field),
      },
    });
  }

  async function saveEdits(row: RecruiterComparisonRow, index: number) {
    for (const item of CORE_FIELDS) {
      const next = draft[item.field] ?? currentValue(row, item.field);
      const previous = currentValue(row, item.field);
      if (next === previous) continue;
      await patch({
        manualOverride: {
          id: `edit-${index}-${item.field}`,
          rowIndex: index,
          field: item.field,
          originalValue: previous || null,
          systemValue: previous || null,
          overrideValue: next || null,
          kind: "correct",
        },
      });
    }
    setEditingId(null);
  }

  const copyText = model.recruiterSummary.fullText;

  return (
    <section className="v7-result">
      <div className={`result-hero recruiter-hero conclusion-${model.overallConclusion?.toLowerCase()}`}>
        <div>
          <p className="eyebrow">整体结论</p>
          <h2 className="verdict">{model.overallConclusionLabel}</h2>
          <p>{report.conclusionSourceLabel || model.recruiterSummary.headline}</p>
        </div>
        <button className="primary-button" type="button" onClick={() => copy(copyText)}>
          一键复制核验结果
        </button>
      </div>

      <div className="review-progress">
        <span>待确认字段 {progress.pendingFieldCount}</span>
        <span>已人工确认 {progress.confirmedFieldCount}</span>
        <span>已人工修正 {progress.correctedFieldCount}</span>
        <span>复核进度 {progress.pendingFieldCount === 0 ? "可锁定" : "未完成"}</span>
      </div>

      {model.sourceConflicts && model.sourceConflicts.length > 0 && (
        <p className="source-conflict-banner">来源冲突，待确认</p>
      )}

      <div className="review-lock-bar">
        {locked ? (
          <button type="button" className="soft-button" disabled={busy} onClick={() => patch({ unlockReview: true })}>
            解除锁定
          </button>
        ) : (
          <button type="button" className="primary-button" disabled={busy} onClick={() => patch({ lockReview: true })}>
            完成复核并锁定
          </button>
        )}
        {message && <p className="form-error">{message}</p>}
      </div>

      {(unpairedResume.length > 0 || unpairedSocial.length > 0) && (
        <section className="unpaired-panel">
          <h3>未配对记录</h3>
          {unpairedResume.length > 0 && (
            <p>简历有、社保未找到：{unpairedResume.map((row) => row.resumeCompany).join("、")}</p>
          )}
          {unpairedSocial.length > 0 && (
            <p>社保有、简历未体现：{unpairedSocial.map((row) => row.socialCompany).join("、")}</p>
          )}
        </section>
      )}

      <div className="table-card recruiter-table-card desktop-result-table">
        <div className="result-table-scroll">
          <table>
            <thead>
              <tr>
                <th>序号</th>
                <th>简历公司</th>
                <th>简历工作时间</th>
                <th>社保公司</th>
                <th>社保缴费时间</th>
                <th>公司匹配</th>
                <th>开始月份匹配</th>
                <th>结束月份匹配</th>
                <th>该段结论</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {model.recruiterTable.map((row, index) => (
                <tr
                  id={row.id}
                  key={row.id}
                  className={row.id === selectedId ? "selected" : ""}
                  onClick={() => setSelectedId(row.id)}
                >
                  <td>{row.index}</td>
                  <td className="company-cell">
                    <b className="company-name">{row.resumeCompany}</b>
                    <CompanyDiff row={row} />
                    <FieldEvidence evidence={row.fieldEvidence?.resumeCompany} />
                  </td>
                  <td className="nowrap">{row.resumePeriod}</td>
                  <td className="company-cell">
                    <b className="company-name">{row.socialCompany}</b>
                    <FieldEvidence evidence={row.fieldEvidence?.socialCompany} />
                  </td>
                  <td className="nowrap">{row.socialPeriod}</td>
                  <td><span className={`tone-chip ${statusToneClass(row.companyConsistentLabel)}`}>{row.companyConsistentLabel}</span></td>
                  <td><span className={`tone-chip ${statusToneClass(row.startDifferenceLabel)}`}>{row.startDifferenceLabel}</span></td>
                  <td><span className={`tone-chip ${statusToneClass(row.endDifferenceLabel)}`}>{row.endDifferenceLabel}</span></td>
                  <td><span className={`tone-chip ${statusToneClass(row.rowStatusLabel)}`}>{row.rowStatusLabel}</span></td>
                  <td>
                    <div className="table-actions">
                      <button type="button" className="copy-button" disabled={locked} onClick={() => confirmRow(row, index)}>确认无误</button>
                      <button type="button" className="copy-button" disabled={locked} onClick={() => {
                        setEditingId(row.id);
                        setDraft(Object.fromEntries(CORE_FIELDS.map((item) => [item.field, currentValue(row, item.field)])));
                      }}>修改字段</button>
                      <button type="button" className="copy-button" disabled={locked} onClick={() => setRelinkId(row.id)}>重新关联</button>
                      {row.hasManualOverride && (
                        <button
                          type="button"
                          className="copy-button"
                          disabled={locked}
                          onClick={() => patch({
                            revertOverrideId: (model.fieldOverrides as Array<{ id: string; rowIndex: number }> | undefined)
                              ?.find((item) => item.rowIndex === index)?.id,
                          })}
                        >
                          撤销修改
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mobile-result-cards">
        {model.recruiterTable.map((row, index) => (
          <article className="mobile-experience v7-card" key={row.id}>
            <div className="source-card resume-card">
              <h3>简历</h3>
              <p className="company-name">{row.resumeCompany}</p>
              <p className="nowrap">{row.resumePeriod}</p>
              <FieldEvidence evidence={row.fieldEvidence?.resumeCompany} />
            </div>
            <div className="source-card social-card">
              <h3>社保</h3>
              <p className="company-name">{row.socialCompany}</p>
              <p className="nowrap">{row.socialPeriod}</p>
              <FieldEvidence evidence={row.fieldEvidence?.socialCompany} />
            </div>
            <div className="source-card result-card">
              <p>公司匹配：{row.companyConsistentLabel}</p>
              <p>开始月份：{row.startDifferenceLabel}</p>
              <p>结束月份：{row.endDifferenceLabel}</p>
              <p>该段结论：{row.rowStatusLabel}</p>
              <p>{row.matchScoreLabel}</p>
              <CompanyDiff row={row} />
              <div className="table-actions">
                <button type="button" className="copy-button" disabled={locked} onClick={() => confirmRow(row, index)}>确认无误</button>
                <button type="button" className="copy-button" disabled={locked} onClick={() => {
                  setEditingId(row.id);
                  setDraft(Object.fromEntries(CORE_FIELDS.map((item) => [item.field, currentValue(row, item.field)])));
                }}>修改字段</button>
                <button type="button" className="copy-button" disabled={locked} onClick={() => setRelinkId(row.id)}>重新关联</button>
              </div>
            </div>
          </article>
        ))}
      </div>

      {selected && editingId === selected.id && (
        <form
          className="override-panel"
          onSubmit={(event) => {
            event.preventDefault();
            saveEdits(selected, model.recruiterTable.indexOf(selected));
          }}
        >
          <h3>修改字段</h3>
          <p>人工只能改事实字段。保存后系统重新严格比较。</p>
          <div className="override-grid">
            {CORE_FIELDS.map((item) => (
              <label key={item.field}>
                {item.label}
                <small>
                  {fieldOriginLabel(
                    fieldOriginFromOverride(
                      (model.fieldOverrides as Array<{
                        field: string;
                        reviewStatus?: string;
                        kind?: "confirm" | "correct";
                        rowIndex?: number;
                      }> | undefined)?.find(
                        (entry) =>
                          entry.field === item.field &&
                          entry.rowIndex === model.recruiterTable.indexOf(selected),
                      ) as never,
                      selected.rowStatus === "NEEDS_REVIEW" ||
                        selected.rowStatus === "RESUME_ONLY" ||
                        selected.rowStatus === "SOCIAL_ONLY",
                    ),
                  )}
                </small>
                {item.field.includes("Month") ? (
                  <input
                    type="month"
                    value={draft[item.field] ?? ""}
                    onChange={(event) => setDraft({ ...draft, [item.field]: event.target.value })}
                  />
                ) : (
                  <input
                    value={draft[item.field] ?? ""}
                    onChange={(event) => setDraft({ ...draft, [item.field]: event.target.value })}
                  />
                )}
                <FieldEvidence
                  evidence={
                    item.field.startsWith("social")
                      ? selected.fieldEvidence?.socialCompany
                      : item.field.includes("start")
                        ? selected.fieldEvidence?.startMonth
                        : item.field.includes("end")
                          ? selected.fieldEvidence?.endMonth
                          : selected.fieldEvidence?.resumeCompany
                  }
                />
              </label>
            ))}
          </div>
          <div className="modal-actions">
            <button type="button" onClick={() => setEditingId(null)}>取消</button>
            <button className="primary-button" type="submit" disabled={busy}>保存并重算</button>
          </div>
        </form>
      )}

      {selected && relinkId === selected.id && (
        <form
          className="override-panel"
          onSubmit={(event) => {
            event.preventDefault();
            const socialSourceId = (event.currentTarget.elements.namedItem("socialSourceId") as HTMLSelectElement).value;
            if (selected.resumeSourceId) {
              patch({ relink: { resumeSourceId: selected.resumeSourceId, socialSourceId } });
            }
            setRelinkId(null);
          }}
        >
          <h3>重新关联</h3>
          <label>
            选择社保记录
            <select name="socialSourceId" defaultValue={selected.socialSourceId ?? ""}>
              {model.recruiterTable
                .filter((row) => row.socialSourceId)
                .map((row) => (
                  <option key={row.socialSourceId} value={row.socialSourceId}>
                    {row.socialCompany} {row.socialPeriod}
                  </option>
                ))}
            </select>
          </label>
          <div className="modal-actions">
            <button type="button" onClick={() => selected.resumeSourceId && patch({ unlink: { resumeSourceId: selected.resumeSourceId } })}>
              撤销关联
            </button>
            <button type="button" onClick={() => setRelinkId(null)}>取消</button>
            <button className="primary-button" type="submit">保存关联</button>
          </div>
        </form>
      )}
    </section>
  );
}
