"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { VerificationReport } from "@/lib/result";
import type { VerificationResult } from "@/lib/schemas";

const statusNames: Record<string, string> = {
  MATCHED: "完全一致",
  COMPANY_MISMATCH: "公司异常",
  START_DATE_MISMATCH: "入职时间异常",
  END_DATE_MISMATCH: "离职时间异常",
  DATE_MISMATCH: "起止时间异常",
  RESUME_ONLY: "未被社保佐证",
  SOCIAL_SECURITY_ONLY: "简历未披露",
  PERSONAL_INSURANCE: "个人参保",
  GAP_PERIOD: "社保断缴",
};

function field(label: string, value: string | number | undefined, copy: (text: string) => void) {
  if (value === undefined) return null;
  return (
    <div className="field">
      <label>{label}<button className="copy-button" onClick={() => copy(String(value))}>复制</button></label>
      <p>{value}</p>
    </div>
  );
}

function itemText(candidateName: string, item: VerificationResult) {
  return [
    `候选人：${candidateName}`,
    `简历公司：${item.resumeDeclaredCompany || "无"}`,
    `简历时间：${item.resumeDeclaredStartMonth || "无"} ～ ${item.resumeDeclaredEndMonth || "无"}`,
    `社保公司：${item.verifiedSocialSecurityCompany || "无"}`,
    `社保时间：${item.verifiedSocialSecurityStartMonth || "无"} ～ ${item.verifiedSocialSecurityEndMonth || "无"}`,
    `核验结果：${statusNames[item.status]}`,
    `差异说明：${item.description}`,
  ].join("\n");
}

function allText(report: VerificationReport, onlyAnomalies = false) {
  const items = onlyAnomalies
    ? report.items.filter((item) => item.status !== "MATCHED")
    : report.items;
  return [
    `候选人：${report.candidateName}`,
    `核验结论：${report.summary.conclusion}`,
    `简历声明经历：${report.summary.resumeExperienceCount}`,
    `社保实际单位：${report.summary.socialSecurityCompanyCount}`,
    `完全一致：${report.summary.matchedCount}`,
    ...items.map((item, index) => `\n${onlyAnomalies ? "异常" : "记录"}${index + 1}：\n${itemText(report.candidateName, item)}`),
  ].join("\n");
}

export function ResultView({ taskId }: { taskId: string }) {
  const [report, setReport] = useState<VerificationReport | null>(null);
  const [message, setMessage] = useState("");
  useEffect(() => {
    fetch(`/api/verification/${taskId}`, { cache: "no-store" })
      .then((response) => response.json())
      .then((task) => {
        if (task.status !== "COMPLETED") window.location.replace(`/processing/${taskId}`);
        else setReport(task.result);
      });
  }, [taskId]);

  async function copy(text: string) {
    await navigator.clipboard.writeText(text);
    setMessage("✓ 已复制");
    window.setTimeout(() => setMessage(""), 1500);
  }

  if (!report) return <main className="shell"><div className="empty">正在读取核验结果…</div></main>;
  const stats = [
    ["简历声明经历", report.summary.resumeExperienceCount],
    ["社保实际单位", report.summary.socialSecurityCompanyCount],
    ["完全一致", report.summary.matchedCount],
    ["公司异常", report.summary.companyAnomalyCount],
    ["时间异常", report.summary.dateAnomalyCount],
    ["简历未披露经历", report.summary.undisclosedCount],
    ["未被社保佐证经历", report.summary.unsupportedCount],
    ["断缴月份", report.summary.gapMonthCount],
  ];
  const hasAnomaly = report.summary.anomalyCount > 0;
  return (
    <main className="shell">
      <header className="result-header">
        <div>
          <p className="eyebrow">核验结果</p>
          <h1>
            {report.candidateName}
            <button className="copy-button" onClick={() => copy(report.candidateName)}>复制</button>
          </h1>
        </div>
        <nav>
          <button className="soft-button" onClick={() => copy(allText(report, true))}>复制异常项</button>
          <button className="soft-button" onClick={() => copy(allText(report))}>复制全部</button>
          <Link className="soft-button" href="/history">历史记录</Link>
          <Link className="soft-button" href="/">新建核验</Link>
        </nav>
      </header>
      <section className={`result-hero ${hasAnomaly ? "anomaly" : ""}`}>
        <span>{hasAnomaly ? "⚠️" : "✓"}</span>
        <div className="verdict">
          {hasAnomaly ? `发现 ${report.summary.anomalyCount} 项差异` : "核验通过"}
        </div>
        <p>{hasAnomaly ? "简历声明与社保缴纳记录存在不一致" : "所有工作经历与社保记录完全一致"}</p>
        <p>核验结果以社保记录为基准 · {report.summary.conclusion}
          <button className="copy-button" onClick={() => copy(report.summary.conclusion)}>复制</button>
        </p>
      </section>
      <section className="stat-grid">
        {stats.map(([label, value]) => <div className="stat" key={label}><span>{label}</span><b>{value}</b></div>)}
      </section>
      <section className="experience-list">
        {report.items.map((item, index) => (
          <article className="experience-card" key={`${item.status}-${index}`}>
            <div className="experience-title">
              <div>
                <small>{item.status === "SOCIAL_SECURITY_ONLY" ? "⚠️ 简历未披露经历" : `工作经历 ${String(index + 1).padStart(2, "0")}`}</small>
                <h3>{item.resumeDeclaredCompany || item.verifiedSocialSecurityCompany}</h3>
              </div>
              <span className={`badge ${item.status !== "MATCHED" ? "warn" : ""}`}>{statusNames[item.status]}</span>
            </div>
            <div className="detail-grid">
              {field("简历公司", item.resumeDeclaredCompany, copy)}
              {field("社保公司", item.verifiedSocialSecurityCompany, copy)}
              {field("简历入职时间", item.resumeDeclaredStartMonth, copy)}
              {field("简历离职时间", item.resumeDeclaredEndMonth, copy)}
              {field("社保首缴时间", item.verifiedSocialSecurityStartMonth, copy)}
              {field("社保末缴时间", item.verifiedSocialSecurityEndMonth, copy)}
              {field("社保月数", item.verifiedSocialSecurityMonths, copy)}
              {field("异常类型", statusNames[item.status], copy)}
            </div>
            {item.description && <p className="difference">⚠ {item.description}
              <button className="copy-button" onClick={() => copy(item.description)}>复制</button>
            </p>}
            {item.paidMonths && item.paidMonths.length > 0 && (
              <div className="gap-months">
                {item.paidMonths.map((month) => <span className="month-dot" key={month}>{month} ●</span>)}
                {item.gapMonths.map((month) => <span className="month-dot gap" key={month}>{month} ○ 未缴纳</span>)}
              </div>
            )}
            <button className="soft-button" onClick={() => copy(itemText(report.candidateName, item))}>复制本条</button>
          </article>
        ))}
      </section>
      <section className="table-card">
        <h2>完整核验表</h2>
        <table>
          <thead><tr><th>序号</th><th>简历公司</th><th>简历时间</th><th>社保公司</th><th>社保时间</th><th>养老</th><th>工伤</th><th>失业</th><th>社保月数</th><th>核验结果</th></tr></thead>
          <tbody>{report.items.map((item, index) => (
            <tr key={index}><td>{index + 1}</td><td>{item.resumeDeclaredCompany || "—"}</td><td>{item.resumeDeclaredStartMonth ? `${item.resumeDeclaredStartMonth}～${item.resumeDeclaredEndMonth}` : "—"}</td><td>{item.verifiedSocialSecurityCompany || "—"}</td><td>{item.verifiedSocialSecurityStartMonth ? `${item.verifiedSocialSecurityStartMonth}～${item.verifiedSocialSecurityEndMonth}` : "—"}</td><td>{item.pensionMonths ?? "—"}</td><td>{item.injuryMonths ?? "—"}</td><td>{item.unemploymentMonths ?? "—"}</td><td>{item.verifiedSocialSecurityMonths ?? "—"}</td><td>{statusNames[item.status]}</td></tr>
          ))}</tbody>
        </table>
      </section>
      <section className="summary-card">
        <h2>核验摘要</h2>
        <p>候选人：{report.candidateName}</p>
        <p>核验时间：{new Date(report.verifiedAt).toLocaleString("zh-CN")}</p>
        <div className="summary-list">{stats.map(([label, value]) => <div key={label}><span>{label}</span><b>{value}</b></div>)}</div>
        <p><strong>结论：{report.summary.conclusion}</strong></p>
        {report.summary.concerns.length > 0 && <div className="concerns"><strong>主要关注：</strong>{report.summary.concerns.map((concern, index) => <div key={index}>{index + 1}. {concern}</div>)}</div>}
      </section>
      {message && <div className="toast">{message}</div>}
    </main>
  );
}
