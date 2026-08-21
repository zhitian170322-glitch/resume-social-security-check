export const ERROR_CODES = [
  "FILE_TOO_LARGE",
  "INVALID_FILE_TYPE",
  "PDF_PARSE_FAILED",
  "OCR_FAILED",
  "AI_PARSE_FAILED",
  "VERIFICATION_FAILED",
  "EXPORT_FAILED",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export function safeErrorMessage(code: string) {
  const messages: Record<string, string> = {
    FILE_TOO_LARGE: "上传文件超过大小限制",
    INVALID_FILE_TYPE: "上传文件类型不受支持",
    PDF_PARSE_FAILED: "PDF 文件无法解析",
    OCR_FAILED: "文字识别服务暂时不可用",
    AI_PARSE_FAILED: "材料结构化失败，任务已停止",
    VERIFICATION_FAILED: "严格核验处理失败",
    EXPORT_FAILED: "结果导出失败",
  };
  return messages[code] || "任务处理失败";
}
