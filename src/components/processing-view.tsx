"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

const stages = [
  ["RESUME_READ", "已读取简历"],
  ["SOCIAL_SECURITY_READ", "已读取社保材料"],
  ["OCR_PROCESSING", "正在识别社保证明"],
  ["EXTRACTING", "正在提取工作经历"],
  ["VERIFYING", "正在执行严格核验"],
  ["COMPLETED", "已生成核验结果"],
] as const;

type Status = {
  status: string;
  stage: string;
  estimatedOCRCalls: number;
  errorCode: string | null;
  errorMessage: string | null;
};

export function ProcessingView({ taskId }: { taskId: string }) {
  const router = useRouter();
  const [task, setTask] = useState<Status>({
    status: "PENDING",
    stage: "FILES_SAVED",
    estimatedOCRCalls: 0,
    errorCode: null,
    errorMessage: null,
  });

  useEffect(() => {
    let active = true;
    const poll = async () => {
      const response = await fetch(`/api/verification/${taskId}`, { cache: "no-store" });
      if (!active) return;
      const data = await response.json();
      setTask(data);
      if (data.status === "COMPLETED") {
        router.replace(`/result/${taskId}`);
      } else if (
        data.status !== "FAILED" &&
        data.stage !== "AWAITING_OCR_CONFIRMATION"
      ) {
        window.setTimeout(poll, 1200);
      }
    };
    poll();
    return () => {
      active = false;
    };
  }, [router, taskId]);

  async function continuePaid() {
    await fetch(`/api/verification/${taskId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paidOverride: true }),
    });
    window.location.reload();
  }

  const current = stages.findIndex(([key]) => key === task.stage);
  return (
    <main className="shell narrow">
      <section className="process-card">
        <p className="eyebrow">核验任务</p>
        <h1>正在处理材料</h1>
        <p className="subtitle">系统仅显示真实处理阶段，完成后将自动进入结果页。</p>
        <div className="stage-list">
          {stages.map(([key, label], index) => {
            const done = current > index || task.status === "COMPLETED";
            const active = current === index;
            return (
              <div className={done ? "done" : active ? "active" : ""} key={key}>
                <i>{done ? "✓" : active ? "●" : "○"}</i>
                <span>{done && label.startsWith("正在") ? label.replace("正在", "已") : label}</span>
              </div>
            );
          })}
        </div>
        {task.status === "FAILED" && (
          <div className="error-panel">
            <strong>任务处理失败</strong>
            <p>{task.errorMessage || task.errorCode}</p>
            <button onClick={() => router.push("/")}>返回工作台</button>
          </div>
        )}
      </section>
      {task.stage === "AWAITING_OCR_CONFIRMATION" && (
        <div className="modal-backdrop">
          <div className="modal">
            <h2>免费 OCR 安全额度已达到上限</h2>
            <p>本次任务预计需要 {task.estimatedOCRCalls} 次 OCR 调用。</p>
            <p>继续核验可能产生阿里云 OCR 费用。本次确认仅对当前任务有效。</p>
            <div className="modal-actions">
              <button onClick={() => router.push("/")}>取消</button>
              <button className="danger-button" onClick={continuePaid}>
                继续并使用付费 OCR
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
