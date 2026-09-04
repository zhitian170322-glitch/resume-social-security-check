export type TaskLifecycle =
  | "processing"
  | "cancel_requested"
  | "cancelled"
  | "completed"
  | "failed";

export type CancelState = "none" | "cancel_requested" | "cancelled";

export class TaskCancelledError extends Error {
  readonly code = "CANCELLED";
  constructor() {
    super("TASK_CANCELLED");
    this.name = "TaskCancelledError";
  }
}

export function readCancelState(value: string | null | undefined): CancelState {
  if (value === "cancel_requested" || value === "cancelled") return value;
  return "none";
}

export function taskLifecycle(input: {
  status: string;
  cancelState?: string | null;
  errorCode?: string | null;
}): TaskLifecycle {
  const cancel = readCancelState(input.cancelState);
  if (cancel === "cancelled" || input.errorCode === "CANCELLED") return "cancelled";
  if (cancel === "cancel_requested") return "cancel_requested";
  if (input.status === "COMPLETED") return "completed";
  if (input.status === "FAILED") return "failed";
  return "processing";
}

export function lifecycleLabel(lifecycle: TaskLifecycle): string {
  if (lifecycle === "completed") return "已完成";
  if (lifecycle === "failed") return "处理失败";
  if (lifecycle === "cancelled") return "已终止";
  if (lifecycle === "cancel_requested") return "正在终止";
  return "处理中";
}

export function canCancelTask(input: {
  status: string;
  cancelState?: string | null;
  errorCode?: string | null;
}): boolean {
  const lifecycle = taskLifecycle(input);
  return lifecycle === "processing" || lifecycle === "cancel_requested";
}
