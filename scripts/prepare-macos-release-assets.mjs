import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { macReleaseSigningMode } from "../apps/desktop-vnext/scripts/mac-release-environment.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const defaultRepositoryRoot = path.resolve(path.dirname(scriptPath), "..");

export function writeMacReleaseAssets({
  dmgPath,
  outputDirectory,
  version,
  tag,
  commit,
  signingMode,
  platformLock,
  generatedAt = new Date().toISOString(),
}) {
  const expectedName = `Hermit-${version}-arm64.dmg`;
  if (path.basename(dmgPath) !== expectedName) {
    throw new Error(`Expected ${expectedName}; received ${path.basename(dmgPath)}`);
  }
  const info = fs.statSync(dmgPath, { throwIfNoEntry: false });
  if (info === undefined || !info.isFile() || info.size === 0) {
    throw new Error(`Release DMG is missing or empty: ${dmgPath}`);
  }

  const sha256 = sha256File(dmgPath);
  const optionalStatus = signingMode === "required" ? "PASS" : "SKIPPED";
  const manifest = {
    schemaVersion: 1,
    product: "Hermit",
    version,
    tag,
    commit,
    generatedAt,
    target: { platform: "darwin", architecture: "arm64" },
    platformLock,
    artifact: { name: expectedName, bytes: info.size, sha256 },
    steps: {
      sourceAndTag: "PASS",
      build: "PASS",
      dmgVerification: "PASS",
      signing: optionalStatus,
      notarization: optionalStatus,
      stapling: optionalStatus,
    },
  };

  fs.mkdirSync(outputDirectory, { recursive: true });
  const checksumPath = path.join(outputDirectory, "SHA256SUMS.txt");
  const manifestPath = path.join(outputDirectory, "release-manifest.json");
  fs.writeFileSync(checksumPath, `${sha256}  ${expectedName}\n`, "utf8");
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return { checksumPath, manifestPath, manifest };
}

/** 在任何昂贵构建开始前，确认正式发布对应唯一的干净源码提交和版本 tag。 */
export function assertMacReleaseSource({
  repositoryRoot = defaultRepositoryRoot,
  platform = process.platform,
  architecture = process.arch,
} = {}) {
  if (platform !== "darwin" || architecture !== "arm64") {
    throw new Error("macOS release assets require a native Apple Silicon host");
  }
  const version = readJson(path.join(repositoryRoot, "apps", "desktop-vnext", "package.json")).version;
  const tag = `v${version}`;
  const commit = git(repositoryRoot, ["rev-parse", "HEAD"]);
  if (git(repositoryRoot, ["status", "--porcelain"]) !== "") {
    throw new Error("Release assets require a clean Git working tree");
  }
  if (git(repositoryRoot, ["rev-list", "-n", "1", tag]) !== commit) {
    throw new Error(`Tag ${tag} must point to the current commit ${commit}`);
  }
  return { version, tag, commit };
}

function main() {
  const repositoryRoot = defaultRepositoryRoot;
  const mode = process.argv[2] ?? "write";
  if (!new Set(["preflight", "write"]).has(mode)) {
    throw new Error("Usage: node scripts/prepare-macos-release-assets.mjs [preflight]");
  }
  const { version, tag, commit } = assertMacReleaseSource();
  if (mode === "preflight") {
    console.log(`macOS release source verified: ${tag} -> ${commit}`);
    return;
  }

  const distDirectory = path.join(repositoryRoot, "apps", "desktop-vnext", "dist", "mac-release");
  const dmgPaths = fs.readdirSync(distDirectory)
    .filter((name) => name.endsWith(".dmg"))
    .map((name) => path.join(distDirectory, name));
  if (dmgPaths.length !== 1) {
    throw new Error(`Expected exactly one release DMG in ${distDirectory}; found ${dmgPaths.length}`);
  }
  const signingMode = macReleaseSigningMode(process.env);
  const verifier = path.join(
    repositoryRoot,
    "apps",
    "desktop-vnext",
    "scripts",
    "verify-mac-artifact.mjs",
  );
  execFileSync(process.execPath, [verifier, "release", distDirectory], {
    cwd: repositoryRoot,
    env: process.env,
    stdio: "inherit",
  });

  const outputDirectory = path.join(repositoryRoot, ".hermit", "artifacts", "releases", tag);
  const result = writeMacReleaseAssets({
    dmgPath: dmgPaths[0],
    outputDirectory,
    version,
    tag,
    commit,
    signingMode,
    platformLock: readPlatformLockEvidence(repositoryRoot),
  });
  console.log(`macOS release assets prepared: ${result.checksumPath}; ${result.manifestPath}`);
}

function git(repositoryRoot, args) {
  return execFileSync("git", args, { cwd: repositoryRoot, encoding: "utf8" }).trim();
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function readPlatformLockEvidence(repositoryRoot) {
  const file = path.join(repositoryRoot, "platform-lock.json");
  const lock = readJson(file);
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

function sha256File(file) {
  const hash = createHash("sha256");
  const descriptor = fs.openSync(file, "r");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytesRead;
    do {
      bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead > 0);
  } finally {
    fs.closeSync(descriptor);
  }
  return hash.digest("hex");
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === scriptPath) main();
