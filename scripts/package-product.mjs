#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const defaultRepositoryRoot = path.resolve(path.dirname(scriptPath), "..");

/**
 * 将用户选择转换为稳定的产品打包生命周期。调用者只选择用途和签名策略，不需要了解内部脚本。
 */
export function createProductPackagePlan({
  profile,
  signingMode,
  platform = process.platform,
  architecture = process.arch,
}) {
  if (!new Set(["dev", "candidate", "release"]).has(profile)) {
    throw new Error("profile must be dev, candidate or release");
  }
  if (profile === "release" && !new Set(["skip", "required"]).has(signingMode)) {
    throw new Error("release --signing must be skip or required");
  }
  if (profile !== "release" && signingMode !== undefined) {
    throw new Error("--signing is only available for release");
  }
  if (profile !== "dev" && (platform !== "darwin" || architecture !== "arm64")) {
    throw new Error(`${profile} packaging currently requires native macOS arm64`);
  }
  if (
    profile === "dev" &&
    !((platform === "darwin" && architecture === "arm64") || (platform === "win32" && architecture === "x64"))
  ) {
    throw new Error("dev packaging currently supports macOS arm64 or Windows x64");
  }

  const nodeStep = (id, label, script, args = [], environment = {}) => ({
    id,
    label,
    command: process.execPath,
    args: [script, ...args],
    environment,
  });
  const pnpmStep = (id, label, args, environment = {}) => ({
    id,
    label,
    command: "corepack",
    args: ["pnpm", ...args],
    environment,
  });
  const platformInputs = profile === "dev"
    ? nodeStep(
      "platform-inputs",
      "恢复并安装开发制品",
      "scripts/platform-lock.mjs",
      ["install", "--mode", "dev", "--build-on-miss"],
    )
    : nodeStep(
      "platform-inputs",
      "校验并安装正式制品",
      "scripts/platform-lock.mjs",
      ["install", "--mode", "release"],
    );

  if (profile === "dev") {
    return {
      profile,
      signingMode: undefined,
      target: { platform, architecture },
      steps: [
        platformInputs,
        pnpmStep("desktop-tests", "运行 Desktop 测试", ["run", "test:desktop"]),
        pnpmStep("desktop-package", "生成本机目录包", ["run", "package:desktop:dir"]),
        pnpmStep("packaged-runtime", "验证目录包 runtime", ["run", "verify:desktop:packaged-runtime"]),
      ],
    };
  }

  const qualificationSteps = [
    platformInputs,
    pnpmStep("project-tests", "运行完整项目检查", ["test"]),
    pnpmStep("runtime", "准备 Product runtime", ["run", "prepare:desktop-runtime"]),
    pnpmStep("native-tests", "验证 Smart Clipboard native bridge", ["run", "test:smart-clipboard:native"]),
    pnpmStep("organizer-surface", "验证 Organizer Product Surface", ["run", "test:organizer:product-surface"]),
    pnpmStep("file-workspace-surface", "验证 File Workspace Product Surface", ["run", "test:file-workspace:product-surface"]),
    pnpmStep("smart-clipboard-surface", "验证 Smart Clipboard Product Surface", ["run", "test:smart-clipboard:product-surface"]),
    pnpmStep("desktop-package", "生成本机目录包", ["run", "package:desktop:dir"]),
    pnpmStep("smart-clipboard-packaged-ui", "验证 Smart Clipboard packaged UI", ["run", "test:smart-clipboard:packaged-ui"]),
  ];

  if (profile === "candidate") {
    return {
      profile,
      signingMode: "skip",
      target: { platform, architecture },
      steps: [
        ...qualificationSteps,
        pnpmStep("mac-candidate", "生成未签名 macOS 候选 DMG", ["run", "dist:desktop:mac:smoke"]),
      ],
    };
  }

  const signingEnvironment = { HERMIT_MAC_RELEASE_SIGNING: signingMode };
  return {
    profile,
    signingMode,
    target: { platform, architecture },
    steps: [
      nodeStep("release-source", "检查正式发布源码和 tag", "scripts/prepare-macos-release-assets.mjs", ["preflight"]),
      ...qualificationSteps,
      pnpmStep("mac-release", "生成 macOS 正式候选 DMG", ["run", "dist:desktop:mac"], signingEnvironment),
      pnpmStep("release-assets", "生成校验和与发布清单", ["run", "release:desktop:mac:assets"], signingEnvironment),
    ],
  };
}

/** 将一次产品打包的输入、步骤和输出保存为可机器回读的证据。 */
export function writeProductBuildManifest({
  repositoryRoot,
  profile,
  signingMode,
  target,
  source,
  startedAt,
  finishedAt,
  steps,
  outputPath,
  error,
  toolchain = readToolchain(repositoryRoot),
}) {
  const platformLockPath = path.join(repositoryRoot, "platform-lock.json");
  const platformLockBytes = fs.readFileSync(platformLockPath);
  const platformLock = JSON.parse(platformLockBytes.toString("utf8"));
  const result = error === undefined && steps.every(({ status }) => status === "PASS") ? "PASS" : "FAIL";
  const manifest = {
    schemaVersion: 1,
    result,
    product: {
      id: platformLock.product.id,
      version: platformLock.product.version,
    },
    profile,
    ...(signingMode === undefined ? {} : { signingMode }),
    target,
    source,
    toolchain,
    startedAt,
    finishedAt,
    durationMs: Date.parse(finishedAt) - Date.parse(startedAt),
    platformLock: {
      sha256: sha256(platformLockBytes),
      modules: platformLock.modules.map((module) => ({
        id: module.id,
        packageName: module.packageName,
        version: module.version,
        sourceCommit: module.sourceCommit,
        artifactSha256: module.artifact.sha256,
      })),
    },
    steps,
    output: describeOutput(repositoryRoot, outputPath),
    ...(error === undefined ? {} : { error }),
  };
  const buildId = finishedAt.replaceAll(":", "-");
  const outputDirectory = path.join(
    repositoryRoot,
    ".hermit",
    "artifacts",
    "builds",
    platformLock.product.version,
    profile,
    buildId,
  );
  fs.mkdirSync(outputDirectory, { recursive: true });
  const manifestPath = path.join(outputDirectory, "build-manifest.json");
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return { manifestPath, manifest };
}

export function runProductPackage({
  profile,
  signingMode,
  repositoryRoot = defaultRepositoryRoot,
  platform = process.platform,
  architecture = process.arch,
}) {
  const plan = createProductPackagePlan({ profile, signingMode, platform, architecture });
  const startedAt = new Date().toISOString();
  const source = {
    commit: git(repositoryRoot, ["rev-parse", "HEAD"]),
    dirty: git(repositoryRoot, ["status", "--porcelain"]) !== "",
  };
  const completedSteps = [];
  let failure;
  let outputPath;
  try {
    for (const step of plan.steps) {
      const started = Date.now();
      console.log(`\n[${completedSteps.length + 1}/${plan.steps.length}] ${step.label}`);
      try {
        runStep(step, repositoryRoot);
        completedSteps.push({ id: step.id, status: "PASS", durationMs: Date.now() - started });
      } catch (cause) {
        completedSteps.push({ id: step.id, status: "FAIL", durationMs: Date.now() - started });
        throw cause;
      }
    }
    outputPath = locateProductOutput(repositoryRoot, plan);
  } catch (cause) {
    failure = cause instanceof Error ? cause.message : String(cause);
    for (const step of plan.steps.slice(completedSteps.length)) {
      completedSteps.push({ id: step.id, status: "SKIPPED", durationMs: 0 });
    }
  }
  const finishedAt = new Date().toISOString();
  const result = writeProductBuildManifest({
    repositoryRoot,
    profile: plan.profile,
    signingMode: plan.signingMode,
    target: plan.target,
    source,
    startedAt,
    finishedAt,
    steps: completedSteps,
    outputPath,
    error: failure,
  });
  printSummary(result, repositoryRoot);
  if (failure !== undefined) throw new Error(failure);
  return result;
}

function runStep(step, repositoryRoot) {
  const environment = {
    ...process.env,
    PATH: [path.dirname(process.execPath), process.env.PATH ?? process.env.Path ?? ""]
      .filter(Boolean)
      .join(path.delimiter),
    ...step.environment,
  };
  delete environment.Path;
  const result = spawnSync(step.command, step.args, {
    cwd: repositoryRoot,
    env: environment,
    stdio: "inherit",
  });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${step.command} ${step.args.join(" ")} exited with ${String(result.status)}`);
  }
}

function locateProductOutput(repositoryRoot, plan) {
  const appRoot = path.join(repositoryRoot, "apps", "desktop-vnext");
  if (plan.profile === "dev") {
    const output = plan.target.platform === "darwin"
      ? path.join(appRoot, "dist", plan.target.architecture === "arm64" ? "mac-arm64" : "mac", "Hermit.app")
      : path.join(appRoot, "dist", "win-unpacked");
    if (!fs.existsSync(output)) throw new Error(`Product directory output is missing: ${output}`);
    return output;
  }
  const directory = path.join(appRoot, "dist", plan.profile === "candidate" ? "mac-smoke" : "mac-release");
  const outputs = fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".dmg"))
    .map((entry) => path.join(directory, entry.name));
  if (outputs.length !== 1) throw new Error(`Expected one Product DMG in ${directory}; found ${outputs.length}`);
  return outputs[0];
}

function describeOutput(repositoryRoot, outputPath) {
  if (outputPath === undefined) return null;
  const info = fs.statSync(outputPath);
  const description = {
    kind: info.isDirectory() ? "directory" : "file",
    path: path.relative(repositoryRoot, outputPath),
  };
  if (info.isFile()) {
    return { ...description, bytes: info.size, sha256: sha256File(outputPath) };
  }
  return description;
}

function printSummary({ manifest, manifestPath }, repositoryRoot) {
  console.log("\nHermit Product Build Summary\n");
  for (const module of manifest.platformLock.modules) {
    console.log(`${module.id.padEnd(32)} LOCKED   ${module.version}`);
  }
  console.log("");
  for (const step of manifest.steps) {
    console.log(`${step.id.padEnd(32)} ${step.status.padEnd(8)} ${String(step.durationMs).padStart(7)} ms`);
  }
  if (manifest.output !== null) console.log(`\nOutput: ${manifest.output.path}`);
  console.log(`Build manifest: ${path.relative(repositoryRoot, manifestPath)}`);
  console.log(`Result: ${manifest.result}`);
}

function readToolchain(repositoryRoot) {
  const environment = {
    ...process.env,
    PATH: [path.dirname(process.execPath), process.env.PATH ?? process.env.Path ?? ""]
      .filter(Boolean)
      .join(path.delimiter),
  };
  delete environment.Path;
  return {
    node: process.version,
    pnpm: execFileSync("corepack", ["pnpm", "--version"], { encoding: "utf8", env: environment }).trim(),
    electron: readInstalledVersion(path.join(repositoryRoot, "apps", "desktop-vnext", "node_modules", "electron", "package.json")),
  };
}

function readInstalledVersion(file) {
  if (!fs.existsSync(file)) return null;
  const version = JSON.parse(fs.readFileSync(file, "utf8")).version;
  return typeof version === "string" ? version : null;
}

function git(repositoryRoot, args) {
  return execFileSync("git", args, { cwd: repositoryRoot, encoding: "utf8" }).trim();
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
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

function optionValue(args, name) {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.length === 0) {
    console.log("Usage: node scripts/package-product.mjs <dev|candidate|release> [--signing skip|required]");
    return;
  }
  const profile = args[0];
  const signingMode = optionValue(args, "--signing");
  const expectedNodeVersion = fs.readFileSync(path.join(defaultRepositoryRoot, ".node-version"), "utf8").trim();
  const qualifiedNode = path.join(
    defaultRepositoryRoot,
    ".hermit",
    "runtime",
    "node",
    process.platform === "win32" ? "node.exe" : path.join("bin", "node"),
  );
  if (!args.includes("--qualified-node") && process.version !== `v${expectedNodeVersion}`) {
    runStep({
      command: process.execPath,
      args: ["apps/desktop-vnext/scripts/prepare-node-runtime.mjs"],
      environment: {},
    }, defaultRepositoryRoot);
    runStep({
      command: qualifiedNode,
      args: [scriptPath, ...args, "--qualified-node"],
      environment: {},
    }, defaultRepositoryRoot);
    return;
  }
  runProductPackage({ profile, signingMode });
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === scriptPath) {
  try {
    main();
  } catch (cause) {
    console.error(`[product-package] ${cause instanceof Error ? cause.message : String(cause)}`);
    process.exitCode = 1;
  }
}
