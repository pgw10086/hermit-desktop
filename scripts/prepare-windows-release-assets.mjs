import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertReleaseInput } from "./verify-release-input.mjs";
import { windowsReleaseSigningMode } from "../apps/desktop-vnext/scripts/windows-release-environment.mjs";
import { expectedWindowsInstallerName } from "../apps/desktop-vnext/scripts/verify-windows-artifact.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const defaultRepositoryRoot = path.resolve(path.dirname(scriptPath), "..");

/** 在 Windows 原生 runner 上校验正式源码、安装包和发布附件。 */
export function assertWindowsReleaseSource({
  repositoryRoot = defaultRepositoryRoot,
  platform = process.platform,
  architecture = process.arch,
  tag,
  mainRef = process.env.HERMIT_RELEASE_MAIN_REF ?? "origin/main",
} = {}) {
  if (platform !== "win32" || architecture !== "x64") {
    throw new Error("Windows release assets require a native Windows x64 host");
  }
  return assertReleaseInput({ repositoryRoot, tag, mainRef });
}

export function writeWindowsReleaseAssets({
  exePath,
  outputDirectory,
  version,
  tag,
  commit,
  signingMode,
  platformLock,
  source = { tag, commit },
  build = {},
}) {
  const expectedName = expectedWindowsInstallerName(version);
  if (path.basename(exePath) !== expectedName) {
    throw new Error("Expected " + expectedName + "; received " + path.basename(exePath));
  }
  const info = fs.statSync(exePath, { throwIfNoEntry: false });
  if (info === undefined || !info.isFile() || info.size === 0) {
    throw new Error("Release EXE is missing or empty: " + exePath);
  }
  const sha256 = sha256File(exePath);
  const manifest = {
    schemaVersion: 2,
    product: "Hermit",
    version,
    tag,
    commit,
    generatedAt: new Date().toISOString(),
    target: { platform: "win32", architecture: "x64" },
    source: {
      ...source,
      tag: source.tag ?? tag,
      commit: source.commit ?? commit,
      platformLockSha256: source.platformLockSha256 ?? platformLock.sha256,
    },
    build,
    platformLock,
    artifact: { name: expectedName, bytes: info.size, sha256 },
    steps: {
      sourceAndTag: "PASS",
      build: "PASS",
      installerVerification: "PASS",
      signing: signingMode === "required" ? "PASS" : "SKIPPED",
    },
  };
  fs.mkdirSync(outputDirectory, { recursive: true });
  const checksumPath = path.join(outputDirectory, "SHA256SUMS.txt");
  const manifestPath = path.join(outputDirectory, "release-manifest.json");
  fs.writeFileSync(checksumPath, sha256 + "  " + expectedName + "\n", "utf8");
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
  return { checksumPath, manifestPath, manifest };
}

function readSourceEvidence(repositoryRoot, { tag, commit }) {
  return {
    repository: sanitizeRepositoryUrl(execFileSync("git", ["config", "--get", "remote.origin.url"], { cwd: repositoryRoot, encoding: "utf8" }).trim()),
    tag,
    commit,
    productManifestSha256: sha256File(path.join(repositoryRoot, "apps", "desktop-vnext", "package.json")),
    pnpmLockSha256: sha256File(path.join(repositoryRoot, "pnpm-lock.yaml")),
  };
}

function readBuildEvidence() {
  return {
    workflowRunId: process.env.GITHUB_RUN_ID ?? null,
    workflowRunAttempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
    runner: process.env.RUNNER_NAME ?? null,
    node: process.version,
  };
}

function sanitizeRepositoryUrl(value) {
  if (value === "") return null;
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    return url.toString();
  } catch {
    return value;
  }
}

function sha256File(file) {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function main() {
  const mode = process.argv[2] ?? "write";
  if (mode !== "preflight" && mode !== "write") throw new Error("Usage: prepare-windows-release-assets.mjs [preflight]");
  const source = assertWindowsReleaseSource({ tag: process.env.GITHUB_REF_NAME });
  if (mode === "preflight") {
    console.log("Windows release source verified: " + source.tag + " -> " + source.commit);
    return;
  }
  const outputDirectory = path.join(defaultRepositoryRoot, "apps", "desktop-vnext", "dist", "win-release");
  const exePaths = fs.readdirSync(outputDirectory)
    .filter((name) => name.endsWith(".exe"))
    .map((name) => path.join(outputDirectory, name));
  if (exePaths.length !== 1) throw new Error("Expected exactly one Windows release EXE; found " + exePaths.join(", "));
  const verifier = path.join(defaultRepositoryRoot, "apps", "desktop-vnext", "scripts", "verify-windows-artifact.mjs");
  execFileSync(process.execPath, [verifier, "release"], { cwd: defaultRepositoryRoot, env: process.env, stdio: "inherit" });
  const output = writeWindowsReleaseAssets({
    exePath: exePaths[0],
    outputDirectory: path.join(defaultRepositoryRoot, ".hermit", "artifacts", "releases", source.tag),
    version: source.version,
    tag: source.tag,
    commit: source.commit,
    signingMode: windowsReleaseSigningMode(),
    platformLock: readPlatformLockEvidence(defaultRepositoryRoot),
    source: readSourceEvidence(defaultRepositoryRoot, source),
    build: readBuildEvidence(),
  });
  console.log("Windows release assets prepared: " + output.checksumPath + "; " + output.manifestPath);
}

function readPlatformLockEvidence(repositoryRoot) {
  const file = path.join(repositoryRoot, "platform-lock.json");
  const lock = JSON.parse(fs.readFileSync(file, "utf8"));
  return {
    sha256: sha256File(file),
    modules: lock.modules.map((module) => ({
      id: module.id,
      packageName: module.packageName,
      version: module.version,
      sourceCommit: module.sourceCommit,
      artifactSha256: module.artifact.sha256,
    })),
  };
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === scriptPath) {
  try {
    main();
  } catch (cause) {
    console.error("[windows-release-assets] " + (cause instanceof Error ? cause.message : String(cause)));
    process.exitCode = 1;
  }
}
