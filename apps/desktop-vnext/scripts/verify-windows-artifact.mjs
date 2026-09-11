#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const appRoot = path.resolve(path.dirname(scriptPath), "..");

/** 验证 Windows x64 安装包和 unpacked 目录的真实内容。 */
export function verifyWindowsArtifact({
  appRoot: root = appRoot,
  mode = "smoke",
  platform = process.platform,
  architecture = process.arch,
  run = runCommand,
} = {}) {
  if (mode !== "smoke" && mode !== "release") throw new Error("mode must be smoke or release");
  if (platform !== "win32" || architecture !== "x64") {
    throw new Error("Windows artifact verification requires a native Windows x64 host");
  }
  const desktopManifest = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const outputDirectory = path.join(root, "dist", mode === "release" ? "win-release" : "win-smoke");
  const installerName = expectedWindowsInstallerName(desktopManifest.version);
  const installerPath = path.join(outputDirectory, installerName);
  const unpackedRoot = path.join(outputDirectory, "win-unpacked");
  const executablePath = path.join(unpackedRoot, "Hermit.exe");
  const appAsar = path.join(unpackedRoot, "resources", "app.asar");
  for (const required of [installerPath, executablePath, appAsar]) assertRegularNonEmptyFile(required);
  assertPeArchitecture(executablePath, 0x8664);
  const asarCli = findAsarCli(root);
  const entries = run(process.execPath, [asarCli, "list", appAsar])
    .split(/\r?\n/u)
    .map((entry) => entry.replaceAll("\\", "/").replace(/^\//u, ""));
  for (const required of ["lib/main.js", "package.json"]) {
    if (!entries.includes(required)) throw new Error("Windows app.asar is missing " + required);
  }
  console.log("Windows " + mode + " unsigned artifact passed: " + installerPath);
  return { installerPath, installerName, mode };
}

export function expectedWindowsInstallerName(version) {
  if (typeof version !== "string" || version.length === 0) throw new Error("Desktop version is required");
  return "Hermit-" + version + "-x64.exe";
}

export function assertPeArchitecture(file, expectedMachine) {
  const bytes = fs.readFileSync(file);
  if (bytes.length < 0x40) throw new Error("PE file is truncated: " + file);
  const peOffset = bytes.readUInt32LE(0x3c);
  if (peOffset + 6 > bytes.length || bytes.toString("ascii", peOffset, peOffset + 4) !== "PE\0\0") {
    throw new Error("Windows executable has no valid PE signature: " + file);
  }
  const machine = bytes.readUInt16LE(peOffset + 4);
  if (machine !== expectedMachine) {
    throw new Error(
      "Windows executable architecture mismatch: expected 0x" + expectedMachine.toString(16) +
      ", received 0x" + machine.toString(16),
    );
  }
}

export function findAsarCli(root) {
  // pnpm 的虚拟仓库属于产品根目录；app 子项目只保留依赖链接，不复制 .pnpm 目录。
  const pnpmRoots = [
    path.join(root, "node_modules", ".pnpm"),
    path.join(root, "..", "..", "node_modules", ".pnpm"),
  ];
  for (const pnpmRoot of pnpmRoots) {
    if (!fs.existsSync(pnpmRoot)) continue;
    const candidate = fs.readdirSync(pnpmRoot)
      .filter((entry) => entry.startsWith("@electron+asar@"))
      .map((entry) => path.join(pnpmRoot, entry, "node_modules", "@electron", "asar", "bin", "asar.js"))
      .find((entry) => fs.existsSync(entry));
    if (candidate !== undefined) return candidate;
  }
  throw new Error("Unable to locate the @electron/asar CLI");
}

function assertRegularNonEmptyFile(file) {
  const info = fs.statSync(file, { throwIfNoEntry: false });
  if (info === undefined || !info.isFile() || info.size === 0) {
    throw new Error("Windows artifact is missing or empty: " + file);
  }
}

function runCommand(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8", windowsHide: true });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) throw new Error(command + " exited with " + String(result.status) + ": " + result.stderr);
  return result.stdout;
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === scriptPath) {
  try {
    verifyWindowsArtifact({ mode: process.argv[2] ?? "smoke" });
  } catch (cause) {
    console.error("[windows-artifact] " + (cause instanceof Error ? cause.message : String(cause)));
    process.exitCode = 1;
  }
}
