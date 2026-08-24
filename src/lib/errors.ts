export const ERROR_CODES = [
  "FILE_TOO_LARGE",
  "INVALID_FILE_TYPE",
  "PDF_PARSE_FAILED",
  "OCR_FAILED",
  "OCR_GENERAL_FAILED",
  "OCR_TABLE_FAILED",
  "OCR_INVALID_IMAGE",
  "OCR_TIMEOUT",
  "OCR_SCHEMA_CHANGED",
  "TEMPLATE_UNKNOWN",
  "PARSER_FAILED",
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
    OCR_GENERAL_FAILED: "普通文字识别失败",
    OCR_TABLE_FAILED: "表格文字识别失败",
    OCR_INVALID_IMAGE: "OCR 页面图像无效",
    OCR_TIMEOUT: "OCR 服务响应超时",
    OCR_SCHEMA_CHANGED: "OCR 服务返回结构发生变化",
    TEMPLATE_UNKNOWN: "社保材料模板无法可靠识别",
    PARSER_FAILED: "社保材料结构解析失败",
    AI_PARSE_FAILED: "材料结构化失败，任务已停止",
    VERIFICATION_FAILED: "严格核验处理失败",
    EXPORT_FAILED: "结果导出失败",
  };
  return messages[code] || "任务处理失败";
}
