export function qualificationExitCode(status) {
  if (status === "blocked") return 2;
  if (status === "review-required") return 3;
  throw new Error(`未实现可执行验证的资格认证状态：${String(status)}`);
}
