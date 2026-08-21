import { ResultView } from "@/components/result-view";

export default async function ResultPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return <ResultView taskId={(await params).id} />;
}
