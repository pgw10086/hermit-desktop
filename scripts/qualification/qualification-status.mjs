/** 将资格状态映射为 CI 可识别的退出码；未知状态视为实现错误。 */
export function qualificationExitCode(status) {
  if (status === "blocked") return 2;
  if (status === "review-required") return 3;
  throw new Error(`未实现可执行验证的资格认证状态：${String(status)}`);
}
