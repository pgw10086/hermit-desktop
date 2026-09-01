import { spawnSync } from "node:child_process";

/** 接受带 v 前缀及 prerelease/build 后缀的 semver 三段式版本。 */
const VERSION_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/u;

/** 仓库工具链的已验证、候选和实验兼容范围。 */
export const toolchainPolicy = Object.freeze({
  node: Object.freeze({
    projectVerified: ">=24.0.0 <25",
    candidate: ">=22.13.0 <23",
    experimental: ">=26.0.0 <27",
  }),
  pnpm: Object.freeze({
    projectVerified: ">=11.0.0 <12",
    diagnosticsOnly: ">=10.0.0 <11",
    experimental: ">=12.0.0 <13",
  }),
});

/** 将版本字符串解析为可比较的数字字段。 */
export function parseVersion(value) {
  const match = VERSION_PATTERN.exec(value.trim());
  if (match === null) return undefined;
  return {
    raw: value.trim(),
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

function atLeast(version, major, minor, patch) {
  if (version.major !== major) return version.major > major;
  if (version.minor !== minor) return version.minor > minor;
  return version.patch >= patch;
}

/** 按项目政策分类 Node 版本，不把观察到的可运行当作发布资格。 */
export function classifyNodeVersion(value) {
  const version = parseVersion(value);
  if (version === undefined) return { status: "unknown", projectEligible: false };
  if (version.major === 24) return { status: "project-verified", projectEligible: true };
  if (version.major === 22 && atLeast(version, 22, 13, 0)) {
    return { status: "candidate", projectEligible: false };
  }
  if (version.major === 26) return { status: "experimental", projectEligible: false };
  if (version.major === 25) return { status: "observed-only-eol", projectEligible: false };
  return { status: "unsupported", projectEligible: false };
}

/** 按项目政策分类 pnpm 版本。 */
export function classifyPnpmVersion(value) {
  const version = parseVersion(value);
  if (version === undefined) return { status: "unknown", projectEligible: false };
  if (version.major === 11) return { status: "project-verified", projectEligible: true };
  if (version.major === 10) return { status: "diagnostics-only", projectEligible: false };
  if (version.major === 12) return { status: "experimental", projectEligible: false };
  return { status: "unsupported", projectEligible: false };
}

/** 优先从 npm user agent 读取 pnpm 版本，缺失时调用 pnpm --version。 */
export function detectPnpmVersion(environment = process.env) {
  const userAgentVersion = /(?:^|\s)pnpm\/([^\s]+)/u.exec(
    environment.npm_config_user_agent ?? "",
  )?.[1];
  if (userAgentVersion !== undefined) return userAgentVersion;

  const result = spawnSync("pnpm", ["--version"], {
    encoding: "utf8",
    env: environment,
    windowsHide: true,
  });
  if (result.status !== 0) return undefined;
  return result.stdout.trim() || undefined;
}

/** 汇总工具链和 native target，给出是否具备项目资格的单一结果。 */
export function evaluateEnvironment({
  nodeVersion = process.version,
  pnpmVersion = detectPnpmVersion(),
  hostPlatform = process.platform,
  hostArchitecture = process.arch,
  targetPlatform = hostPlatform,
  targetArchitecture = hostArchitecture,
} = {}) {
  const node = { version: nodeVersion, ...classifyNodeVersion(nodeVersion) };
  const pnpm = {
    version: pnpmVersion,
    ...(pnpmVersion === undefined
      ? { status: "missing", projectEligible: false }
      : classifyPnpmVersion(pnpmVersion)),
  };
  const nativeTarget = hostPlatform === targetPlatform && hostArchitecture === targetArchitecture;
  return {
    node,
    pnpm,
    host: { platform: hostPlatform, architecture: hostArchitecture },
    target: { platform: targetPlatform, architecture: targetArchitecture, native: nativeTarget },
    qualificationEligible: node.projectEligible && pnpm.projectEligible && nativeTarget,
  };
}
