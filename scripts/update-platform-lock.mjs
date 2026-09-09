#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const defaultRepositoryRoot = path.resolve(path.dirname(scriptPath), "..");

/**
 * 用已发布 package 清单更新 Product Desktop 的平台锁。
 * 这是 package Release -> Product Desktop PR 的唯一接线；它只接收已验证 tarball，绝不从
 * sibling 源码补包，也不删除旧制品。
 */
export function updatePlatformLock({
  repositoryRoot = defaultRepositoryRoot,
  moduleId,
  manifestPath,
  artifactPath,
  lockPath = path.join(repositoryRoot, "platform-lock.json"),
  syncProjections = true,
  run = runCommand,
} = {}) {
  if (typeof moduleId !== "string" || moduleId.length === 0) throw new Error("moduleId is required");
  if (typeof manifestPath !== "string" || manifestPath.length === 0) throw new Error("manifestPath is required");
  if (typeof artifactPath !== "string" || artifactPath.length === 0) throw new Error("artifactPath is required");

  const lock = readJson(lockPath, "Platform lock");
  const manifest = readJson(manifestPath, "Package manifest");
  const module = lock.modules?.find((candidate) => candidate.id === moduleId);
  if (module === undefined) throw new Error("Unknown platform module: " + moduleId);
  if (manifest.schemaVersion !== 1) throw new Error("Unsupported package manifest schema");
  if (manifest.package?.name !== module.packageName) {
    throw new Error(
      "Package name mismatch for " + moduleId + ": expected " + module.packageName +
      ", received " + String(manifest.package?.name),
    );
  }
  if (manifest.source?.repository !== module.repository) {
    throw new Error(
      "Package repository mismatch for " + moduleId + ": expected " + module.repository +
      ", received " + String(manifest.source?.repository),
    );
  }
  assertSha(manifest.source?.commit, 40, moduleId + ".source.commit");
  assertSha(manifest.source?.sourceLockfileSha256, 64, moduleId + ".source.sourceLockfileSha256");
  assertSha(manifest.artifact?.sha256, 64, moduleId + ".artifact.sha256");

  const resolvedArtifact = path.resolve(artifactPath);
  const info = fs.statSync(resolvedArtifact, { throwIfNoEntry: false });
  if (info === undefined || !info.isFile() || info.size === 0) {
    throw new Error("Package artifact is missing or empty: " + resolvedArtifact);
  }
  const actualSha = sha256File(resolvedArtifact);
  if (actualSha !== manifest.artifact.sha256) {
    throw new Error(
      "Package artifact SHA mismatch: expected " + manifest.artifact.sha256 + ", got " + actualSha,
    );
  }
  if (path.basename(resolvedArtifact) !== manifest.artifact.name) {
    throw new Error(
      "Package artifact name mismatch: expected " + manifest.artifact.name +
      ", got " + path.basename(resolvedArtifact),
    );
  }
  verifyPackedIdentity(resolvedArtifact, module.packageName, manifest.package.version);

  const destination = path.join(
    repositoryRoot,
    "vendor",
    "platform",
    module.id,
    actualSha + ".tgz",
  );
  if (fs.existsSync(destination) && sha256File(destination) !== actualSha) {
    throw new Error("Existing platform artifact has a different SHA: " + destination);
  }

  const nextLock = JSON.parse(JSON.stringify(lock));
  const nextModule = nextLock.modules.find((candidate) => candidate.id === moduleId);
  nextModule.version = manifest.package.version;
  nextModule.sourceCommit = manifest.source.commit;
  nextModule.lockfileSha256 = manifest.source.sourceLockfileSha256;
  nextModule.artifact = {
    ...nextModule.artifact,
    path: path.relative(repositoryRoot, destination).split(path.sep).join("/"),
    sha256: actualSha,
  };

  fs.mkdirSync(path.dirname(destination), { recursive: true });
  if (!fs.existsSync(destination)) fs.copyFileSync(resolvedArtifact, destination);
  fs.writeFileSync(lockPath, JSON.stringify(nextLock, null, 2) + "\n");
  if (syncProjections) {
    run(process.execPath, [path.join(repositoryRoot, "scripts", "platform-lock.mjs"), "sync"], repositoryRoot);
  }
  return {
    moduleId,
    packageName: nextModule.packageName,
    version: nextModule.version,
    sourceCommit: nextModule.sourceCommit,
    artifactPath: destination,
    artifactSha256: actualSha,
  };
}

function verifyPackedIdentity(artifactPath, packageName, version) {
  let packageJson;
  try {
    packageJson = JSON.parse(execFileSync("tar", ["-xOf", artifactPath, "package/package.json"], { encoding: "utf8" }));
  } catch (error) {
    throw new Error("Cannot read package/package.json from " + artifactPath, { cause: error });
  }
  if (packageJson.name !== packageName || packageJson.version !== version) {
    throw new Error(
      "Packed package identity mismatch: expected " + packageName + "@" + version +
      ", got " + String(packageJson.name) + "@" + String(packageJson.version),
    );
  }
  for (const lifecycle of ["preinstall", "install", "postinstall", "prepare"]) {
    if (typeof packageJson.scripts?.[lifecycle] === "string") {
      throw new Error("Packed package cannot declare " + lifecycle + ": " + packageName);
    }
  }
}

function assertSha(value, length, label) {
  if (typeof value !== "string" || !new RegExp("^[a-f0-9]{" + length + "}$", "u").test(value)) {
    throw new Error(label + " must be a lowercase SHA-" + (length === 40 ? "1" : "256"));
  }
}

function readJson(file, label) {
  if (!fs.existsSync(file)) throw new Error(label + " is missing: " + file);
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function sha256File(file) {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function runCommand(command, args, cwd) {
  execFileSync(command, args, { cwd, stdio: "inherit" });
}

function optionValue(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === scriptPath) {
  try {
    const result = updatePlatformLock({
      moduleId: optionValue("--module"),
      manifestPath: optionValue("--manifest"),
      artifactPath: optionValue("--artifact"),
      syncProjections: !process.argv.includes("--no-sync"),
    });
    console.log(
      "Platform lock updated: " + result.moduleId + " -> " + result.version +
      " (" + result.artifactSha256 + ")",
    );
  } catch (cause) {
    console.error("[platform-lock-update] " + (cause instanceof Error ? cause.message : String(cause)));
    process.exitCode = 1;
  }
}
