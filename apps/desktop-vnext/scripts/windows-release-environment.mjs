/** Windows 正式签名相关变量；普通构建和 candidate 必须全部隔离。 */
const WINDOWS_RELEASE_VARIABLES = [
  "WIN_CSC_LINK",
  "WIN_CSC_KEY_PASSWORD",
  "CSC_LINK",
  "CSC_KEY_PASSWORD",
];

/** 删除 Windows 证书和密码，供测试、普通打包和发布前资格复用。 */
export function withoutWindowsReleaseSecrets(environment) {
  const sanitized = { ...environment };
  for (const name of WINDOWS_RELEASE_VARIABLES) delete sanitized[name];
  return sanitized;
}

/** 正式 Windows 发布必须显式选择签名策略，不能由 runner 上是否存在证书决定。 */
export function windowsReleaseSigningMode(environment = process.env) {
  const mode = value(environment, "HERMIT_WINDOWS_RELEASE_SIGNING");
  if (mode !== "skip" && mode !== "required") {
    throw new Error("Set HERMIT_WINDOWS_RELEASE_SIGNING=skip or HERMIT_WINDOWS_RELEASE_SIGNING=required");
  }
  return mode;
}

/** 解析本次 Windows 发布；required 时才检查 PFX 和密码。 */
export function resolveWindowsReleaseSigning({
  environment = process.env,
  platform = process.platform,
} = {}) {
  const mode = windowsReleaseSigningMode(environment);
  if (mode === "skip") return { mode, signing: "SKIPPED" };
  if (platform !== "win32") throw new Error("Signed Windows releases must be built on Windows");
  const certificate = value(environment, "WIN_CSC_LINK");
  const password = value(environment, "WIN_CSC_KEY_PASSWORD");
  if (certificate === undefined || password === undefined) {
    throw new Error("Windows signing requires WIN_CSC_LINK and WIN_CSC_KEY_PASSWORD");
  }
  return {
    mode,
    signing: "PASS",
    certificateSource: "WIN_CSC_LINK",
    signerSubject: value(environment, "WINDOWS_SIGNER_SUBJECT") ?? null,
  };
}

function value(environment, name) {
  const candidate = environment[name]?.trim();
  return candidate === "" ? undefined : candidate;
}
