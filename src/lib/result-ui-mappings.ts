export const PROCESSING_STAGES = [
  ["DOCUMENT_INGESTED", "读取文件"],
  ["EXTRACTION_COMPLETE", "提取文本"],
  ["OCR_COMPLETE", "识别社保"],
  ["STRUCTURED", "解析材料"],
  ["EVIDENCE_VALIDATED", "整理字段"],
  ["VERIFICATION_COMPLETE", "配对比较"],
  ["COMPLETED", "生成结果"],
] as const;

const errorMessages: Record<string, string> = {
  OCR_FAILED: "OCR 识别失败，请检查材料清晰度后重试。",
  OCR_GENERAL_FAILED: "普通文字识别失败，请稍后重试。",
  OCR_TABLE_FAILED: "社保表格识别失败，建议人工复核材料。",
  OCR_INVALID_IMAGE: "材料图像无法识别，请重新上传清晰文件。",
  OCR_TIMEOUT: "OCR 服务响应超时，可以从当前阶段重试。",
  OCR_SCHEMA_CHANGED: "OCR 返回结构已适配，缺少文字时对应字段待人工确认。",
  PDF_PARSE_FAILED: "PDF 材料无法解析，请检查文件是否完整。",
  TEMPLATE_UNKNOWN: "社保模板无法可靠识别，需要人工复核。",
  PARSER_FAILED: "材料结构无法可靠解析，需要人工复核。",
  EVIDENCE_STAGE_MISSING: "证据校验阶段缺失，无法自动确认。",
  EVIDENCE_VALIDATION_FAILED: "证据校验失败，任务已安全停止。",
  EVIDENCE_VERSION_MISMATCH: "证据处理版本不一致，请从缓存阶段重试。",
  VERIFICATION_INPUT_INVALID: "材料证据不足，无法执行自动核验。",
  VERIFICATION_FAILED: "确定性核验异常，已保留原始 Evidence。",
  AI_PARSE_FAILED: "简历结构化失败，未生成自动核验结论。",
};

export function userFacingError(
  errorCode: string | null,
  fallback: string | null,
) {
  if (errorCode && errorMessages[errorCode]) return errorMessages[errorCode];
  return fallback || "材料处理未完成，请查看错误代码或重新提交材料。";
}
