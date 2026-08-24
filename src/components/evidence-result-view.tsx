"use client";

import type { VerificationReportV2 } from "@/lib/result";
import type { VerificationV2Item } from "@/lib/verification-engine-v2";

const statusNames: Record<string, string> = {
  EXACT_MATCH: "完全一致",
  COMPANY_MISMATCH: "公司原文不一致",
  TIME_MISMATCH: "时间不一致",
  RESUME_ONLY: "未被社保佐证",
  SOCIAL_SECURITY_ONLY: "简历未披露",
  GAP_DETECTED: "社保断缴",
  PERSONAL_INSURANCE: "个人参保",
  EXTRACTION_UNCERTAIN: "提取结果不确定",
  MANUAL_REVIEW_REQUIRED: "需要人工复核",
};

function evidenceText(item: VerificationV2Item) {
  const resume = item.resume;
  const social = item.socialSecurity;
  return [
    resume
      ? `简历原文：${resume.resumeCompany.sourceQuote}\n简历提取：${resume.resumeCompany.value ?? "无法确定"}，${resume.resumeStartMonth.value ?? "?"}～${resume.resumeEndMonth.value ?? "?"}`
      : null,
    social
      ? `社保原文：${social.sourceEvidence.join("\n")}\n社保提取：${social.companyRaw.value ?? "无法确定"}，${social.startMonth.value ?? "?"}～${social.endMonth.value ?? "?"}`
      : null,
    `核验规则：${item.rules.join("；")}`,
    `结论：${item.description}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function EvidenceResultView({
  report,
  copy,
}: {
  report: VerificationReportV2;
  copy: (text: string) => Promise<void>;
}) {
  const hasAnomaly = report.summary.anomalyCount > 0;
  return (
    <>
      <section className={`result-hero ${hasAnomaly ? "anomaly" : ""}`}>
        <span>{hasAnomaly ? "⚠️" : "✓"}</span>
        <div className="verdict">
          {hasAnomaly ? `发现 ${report.summary.anomalyCount} 项需关注记录` : "核验通过"}
        </div>
        <p>{report.summary.conclusion} · 核验结果以社保原文证据为基准</p>
        {report.summary.manualReviewCount > 0 && (
          <p>其中 {report.summary.manualReviewCount} 项禁止自动判定，必须人工复核。</p>
        )}
      </section>
      <section className="stat-grid">
        {[
          ["简历声明经历", report.summary.resumeExperienceCount],
          ["社保实际单位", report.summary.socialSecurityCompanyCount],
          ["严格一致", report.summary.exactMatchCount],
          ["人工复核", report.summary.manualReviewCount],
          ["OCR 页数", report.usage.ocrPages],
          ["OCR 调用", report.usage.ocrCalls],
          ["DeepSeek 调用", report.usage.deepseekCalls],
          ["预估成本（元）", report.usage.estimatedCost.toFixed(2)],
        ].map(([label, value]) => (
          <div className="stat" key={label}>
            <span>{label}</span>
            <b>{value}</b>
          </div>
        ))}
      </section>
      {report.evidenceIssues.length > 0 && (
        <section className="summary-card evidence-warning">
          <h2>证据校验未通过</h2>
          {report.evidenceIssues.map((issue, index) => (
            <p key={`${issue.field}-${index}`}>
              {issue.code} · {issue.sourceFile} 第 {issue.sourcePage} 页 · {issue.message}
            </p>
          ))}
        </section>
      )}
      <section className="experience-list">
        {report.items.map((item, index) => (
          <article className="experience-card" key={`${item.status}-${index}`}>
            <div className="experience-title">
              <div>
                <small>核验记录 {String(index + 1).padStart(2, "0")}</small>
                <h3>
                  {item.resume?.resumeCompany.value ||
                    item.socialSecurity?.companyRaw.value ||
                    "关键字段无法确定"}
                </h3>
              </div>
              <span className={`badge ${item.status !== "EXACT_MATCH" ? "warn" : ""}`}>
                {statusNames[item.status]}
              </span>
            </div>
            <p className={item.status === "EXACT_MATCH" ? "" : "difference"}>
              {item.description}
            </p>
            <details className="evidence-details">
              <summary>查看核验依据</summary>
              <div className="evidence-columns">
                <section>
                  <h4>简历原文与提取结果</h4>
                  <pre>{item.resume ? item.resume.resumeCompany.sourceQuote : "无对应简历证据"}</pre>
                  {item.resume && (
                    <p>
                      {item.resume.resumeCompany.value ?? "公司无法确定"} ·{" "}
                      {item.resume.resumeStartMonth.value ?? "?"} ～{" "}
                      {item.resume.resumeEndMonth.value ?? "?"}
                    </p>
                  )}
                </section>
                <section>
                  <h4>社保原文与提取结果</h4>
                  <pre>
                    {item.socialSecurity
                      ? item.socialSecurity.sourceEvidence.join("\n")
                      : "无对应社保证据"}
                  </pre>
                  {item.socialSecurity && (
                    <p>
                      {item.socialSecurity.companyRaw.value ?? "公司无法确定"} ·{" "}
                      {item.socialSecurity.startMonth.value ?? "?"} ～{" "}
                      {item.socialSecurity.endMonth.value ?? "?"}
                    </p>
                  )}
                </section>
              </div>
              <h4>核验规则</h4>
              <p>{item.rules.join("；")}</p>
              <h4>结论</h4>
              <p>{item.description}</p>
            </details>
            <button className="soft-button" onClick={() => copy(evidenceText(item))}>
              复制本条
            </button>
          </article>
        ))}
      </section>
      <section className="summary-card">
        <h2>核验摘要</h2>
        <p>候选人：{report.candidateName}</p>
        <p>核验时间：{new Date(report.verifiedAt).toLocaleString("zh-CN")}</p>
        <p><strong>结论：{report.summary.conclusion}</strong></p>
        {report.summary.concerns.map((concern, index) => (
          <p key={index}>{index + 1}. {concern}</p>
        ))}
      </section>
    </>
  );
}
