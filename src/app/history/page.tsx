import { Suspense } from "react";
import { HistoryView } from "@/components/history-view";

export default function HistoryPage() {
  return (
    <Suspense fallback={<main className="shell"><div className="empty">正在读取历史记录…</div></main>}>
      <HistoryView />
    </Suspense>
  );
}
