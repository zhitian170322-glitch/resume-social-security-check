import { fileTypeFromBuffer } from "file-type";
import { extname } from "node:path";
import { config } from "./config";

export class UploadError extends Error {
  constructor(public code: "FILE_TOO_LARGE" | "INVALID_FILE_TYPE", message: string) {
    super(message);
  }
}

const resumeTypes = new Map([[".pdf", "application/pdf"]]);
const socialTypes = new Map([
  [".pdf", "application/pdf"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".png", "image/png"],
]);

export async function validateUpload(
  file: File,
  kind: "RESUME" | "SOCIAL_SECURITY",
): Promise<{ buffer: Buffer; mime: string; extension: string }> {
  if (file.size > config.MAX_FILE_SIZE) {
    throw new UploadError("FILE_TOO_LARGE", `单文件不能超过 ${config.MAX_FILE_SIZE_MB}MB`);
  }
  const extension = extname(file.name).toLowerCase();
  const allowed = kind === "RESUME" ? resumeTypes : socialTypes;
  if (!allowed.has(extension)) {
    throw new UploadError("INVALID_FILE_TYPE", "不支持此文件扩展名");
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  const detected = await fileTypeFromBuffer(buffer);
  if (!detected || detected.mime !== allowed.get(extension)) {
    throw new UploadError("INVALID_FILE_TYPE", "文件内容与扩展名不一致");
  }
  return { buffer, mime: detected.mime, extension };
}

export function validateTaskSize(files: File[]) {
  const total = files.reduce((sum, file) => sum + file.size, 0);
  if (total > config.MAX_TASK_UPLOAD) {
    throw new UploadError("FILE_TOO_LARGE", `单次任务材料总量不能超过 ${config.MAX_TASK_UPLOAD_MB}MB`);
  }
}
