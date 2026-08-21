import { ProcessingView } from "@/components/processing-view";

export default async function ProcessingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return <ProcessingView taskId={(await params).id} />;
}
