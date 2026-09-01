// Adapted from anywhere-labs/dsh-desktop@1eb398d (MIT).
// Hermit只保留 macOS 发布凭据隔离与 fail-loud 预检，不继承其运行时架构。
import { spawnSync } from "node:child_process";

/** 发布签名和公证相关变量；普通构建必须全部隔离。 */
const RELEASE_VARIABLES = [
  "APPLE_API_ISSUER",
  "APPLE_API_KEY",
  "APPLE_API_KEY_ID",
  "APPLE_APP_SPECIFIC_PASSWORD",
  "APPLE_ID",
  "APPLE_KEYCHAIN",
  "APPLE_KEYCHAIN_PROFILE",
  "APPLE_TEAM_ID",
  "CSC_IDENTITY_AUTO_DISCOVERY",
  "CSC_KEY_PASSWORD",
  "CSC_LINK",
  "CSC_NAME",
];

/** 删除发布凭据后返回环境副本，供资格检查和普通构建复用。 */
export function withoutMacReleaseSecrets(environment) {
  const sanitized = { ...environment };
  for (const name of RELEASE_VARIABLES) delete sanitized[name];
  return sanitized;
}

/** 发布必须明确选择是否签名，不能根据当前机器的证书状态自动改变制品。 */
export function macReleaseSigningMode(environment = process.env) {
  const mode = value(environment, "HERMIT_MAC_RELEASE_SIGNING");
  if (mode !== "skip" && mode !== "required") {
    throw new Error(
      "Set HERMIT_MAC_RELEASE_SIGNING=skip or HERMIT_MAC_RELEASE_SIGNING=required",
    );
  }
  return mode;
}

/** 解析本次发布选择；只有 required 才读取和校验发布凭据。 */
export function resolveMacReleaseSigning(options = {}) {
  const environment = options.environment ?? process.env;
  const mode = macReleaseSigningMode(environment);
  if (mode === "skip") {
    return {
      mode,
      signing: "SKIPPED",
      notarization: "SKIPPED",
      stapling: "SKIPPED",
    };
  }
  const ready = assertMacReleaseReady({ ...options, environment });
  return {
    mode,
    identity: ready.identity,
    credentials: ready.signing,
    notarizationCredentials: ready.notarization,
    signing: "PASS",
    notarization: "PASS",
    stapling: "PASS",
  };
}

/** 在 macOS 上检查签名证书和公证凭据是否完整，缺失时 fail loud。 */
export function assertMacReleaseReady({
  environment = process.env,
  platform = process.platform,
  listCodeSigningIdentities = defaultCodeSigningIdentities,
} = {}) {
  if (platform !== "darwin") {
    throw new Error("Signed macOS releases must be built on macOS");
  }
  if (value(environment, "CSC_IDENTITY_AUTO_DISCOVERY") === "false") {
    throw new Error("CSC_IDENTITY_AUTO_DISCOVERY=false disables release signing");
  }

  const configuredIdentity = value(environment, "CSC_NAME");
  const certificate = value(environment, "CSC_LINK");
  let identity;
  let signing;
  if (certificate !== undefined) {
    requireValues(environment, ["CSC_KEY_PASSWORD", "CSC_NAME"], "signing");
    identity = configuredIdentity;
    signing = "p12";
  } else {
    const identities = developerIdApplications(listCodeSigningIdentities(
      withoutMacReleaseSecrets(environment),
    ));
    if (identities.length === 0) {
      throw new Error(
        "A Developer ID Application certificate with its private key is required in Keychain",
      );
    }
    identity = configuredIdentity === undefined
      ? identities[0]
      : identities.find((candidate) => candidate.includes(configuredIdentity));
    if (identity === undefined) {
      throw new Error(`CSC_NAME does not match a Developer ID Application identity: ${configuredIdentity}`);
    }
    signing = "keychain";
  }

  const notarization = notarizationSource(environment);
  return { identity, signing, notarization };
}

function notarizationSource(environment) {
  const sources = [
    ["api-key", ["APPLE_API_KEY", "APPLE_API_KEY_ID", "APPLE_API_ISSUER"]],
    ["apple-id", ["APPLE_ID", "APPLE_APP_SPECIFIC_PASSWORD", "APPLE_TEAM_ID"]],
    ["keychain-profile", ["APPLE_KEYCHAIN_PROFILE"]],
  ];
  for (const [source, names] of sources) {
    const present = names.filter((name) => value(environment, name) !== undefined);
    if (present.length === 0) continue;
    if (present.length !== names.length) {
      throw new Error(
        `Incomplete macOS notarization credentials: missing ${names.filter((name) => !present.includes(name)).join(", ")}`,
      );
    }
    return source;
  }
  throw new Error(
    "macOS notarization credentials are required: configure an API key, Apple ID trio, or Keychain profile",
  );
}

function requireValues(environment, names, purpose) {
  const missing = names.filter((name) => value(environment, name) === undefined);
  if (missing.length > 0) {
    throw new Error(`Incomplete macOS ${purpose} credentials: missing ${missing.join(", ")}`);
  }
}

function value(environment, name) {
  const candidate = environment[name]?.trim();
  return candidate === "" ? undefined : candidate;
}

function developerIdApplications(output) {
  return [...output.matchAll(/"(Developer ID Application:[^"]+)"/gu)].map((match) => match[1]);
}

function defaultCodeSigningIdentities(environment) {
  const result = spawnSync("security", ["find-identity", "-v", "-p", "codesigning"], {
    encoding: "utf8",
    env: environment,
  });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    throw new Error(`security find-identity exited with ${String(result.status)}`);
  }
  return result.stdout;
}
