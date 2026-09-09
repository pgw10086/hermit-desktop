#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = path.resolve(path.dirname(scriptPath), "..");
const workspaceRoot = path.dirname(repositoryRoot);
const args = process.argv.slice(2);
const command = args[0] ?? "verify";
const mode = optionValue("--mode") ?? "release";
const requestedModule = optionValue("--module");
const buildOnMiss = args.includes("--build-on-miss");
const lockPath = path.resolve(repositoryRoot, optionValue("--lock") ?? "platform-lock.json");

class ArtifactMissingError extends Error {
  constructor(moduleId, artifact) {
    super(`Artifact missing for ${moduleId}: ${artifact}`);
    this.name = "ArtifactMissingError";
  }
}

if (!new Set(["install", "prepare", "resolve", "sync", "verify"]).has(command)) {
  usage("command must be install, prepare, resolve, sync or verify");
}
if (!new Set(["dev", "release"]).has(mode)) usage("--mode must be dev or release");
if (buildOnMiss && !new Set(["install", "prepare", "resolve"]).has(command)) {
  usage("--build-on-miss is only available for install, prepare or resolve");
}
if (buildOnMiss && mode !== "dev") {
  usage("--build-on-miss is only available in dev mode");
}
if (command === "sync" && requestedModule !== undefined) {
  usage("sync always updates the complete Product Desktop dependency projection");
}

const lock = readJson(lockPath, "Platform lock");
validateLock(lock);
const modules = selectModules(lock.modules);

if (command === "sync") {
  syncDesktopDependencies(lock, true);
  syncWorkspaceOverrides(lock, true);
  verifyRuntimeProjection(lock);
  console.log("Platform lock projections synchronized.");
} else {
  const resolved = resolveModules(modules);
  if (command === "prepare" || command === "install") {
    syncDesktopDependencies(lock, false);
    syncWorkspaceOverrides(lock, false);
    verifyPnpmLockProjection(lock);
    verifyRuntimeProjection(lock);
    stageAppDependencies(lock);
    console.log(`Platform inputs prepared for ${mode}: ${resolved.length} module(s).`);
  } else if (command === "verify") {
    console.log(`Platform lock verified: ${resolved.length} module(s).`);
  } else {
    printResolution(resolved);
  }
  if (command === "install") {
    run("corepack", ["pnpm", "install", "--frozen-lockfile", "--ignore-scripts"], repositoryRoot);
  }
}

function readJson(file, label) {
  if (!fs.existsSync(file)) throw new Error(`${label} is missing: ${file}`);
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${file}`, { cause: error });
  }
}

function validateLock(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Platform lock must be an object");
  }
  if (value.schemaVersion !== 1 || value.kind !== "platform-lock") {
    throw new Error("Unsupported platform lock schema");
  }
  for (const field of ["desktopManifest", "runtimeBundleManifest"]) {
    if (typeof value.product?.[field] !== "string" || value.product[field].length === 0) {
      throw new Error(`product.${field} must be a non-empty path`);
    }
    assertProductPath(`product.${field}`, value.product[field]);
  }
  if (!Array.isArray(value.modules) || value.modules.length === 0) {
    throw new Error("Platform lock must declare at least one module");
  }
  const ids = new Set();
  const packageNames = new Set();
  for (const module of value.modules) {
    for (const field of [
      "id",
      "role",
      "packageName",
      "version",
      "repository",
      "repoPath",
      "sourceCommit",
      "lockfile",
      "lockfileSha256",
      "artifact",
      "build",
    ]) {
      if (module?.[field] === undefined) throw new Error(`Module ${String(module?.id)} is missing ${field}`);
    }
    if (ids.has(module.id)) throw new Error(`Duplicate module id: ${module.id}`);
    if (packageNames.has(module.packageName)) throw new Error(`Duplicate package name: ${module.packageName}`);
    ids.add(module.id);
    packageNames.add(module.packageName);
    if (!/^[a-f0-9]{40}$/u.test(module.sourceCommit)) {
      throw new Error(`${module.id}.sourceCommit must be a full SHA`);
    }
    if (!/^[a-f0-9]{64}$/u.test(module.lockfileSha256)) {
      throw new Error(`${module.id}.lockfileSha256 must be SHA-256`);
    }
    if (module.artifact.type !== "npm-tgz") {
      throw new Error(`${module.id}.artifact.type must be npm-tgz`);
    }
    if (!/^[a-f0-9]{64}$/u.test(module.artifact.sha256)) {
      throw new Error(`${module.id}.artifact.sha256 must be SHA-256`);
    }
    if (path.basename(module.artifact.path) !== `${module.artifact.sha256}.tgz`) {
      throw new Error(`${module.id}.artifact.path must use its SHA-256 as the tarball filename`);
    }
    if (module.build.contract !== value.policy.buildContract) {
      throw new Error(`${module.id}.build.contract must be ${value.policy.buildContract}`);
    }
    assertProductPath(`${module.id}.artifact.path`, module.artifact.path);
    assertWorkspaceHint(`${module.id}.repoPath`, module.repoPath);
    assertWorkspaceHint(`${module.id}.lockfile`, module.lockfile);
  }
}

function selectModules(allModules) {
  if (requestedModule === undefined) return allModules;
  const selected = allModules.filter((module) => module.id === requestedModule);
  if (selected.length === 0) throw new Error(`Unknown platform module: ${requestedModule}`);
  return selected;
}

function resolveModules(selectedModules) {
  const resolved = [];
  for (const module of selectedModules) {
    try {
      verifyArtifact(module);
      resolved.push({ module, path: artifactPath(module), source: "declared-artifact" });
      if (command === "resolve") {
        console.log(`HIT ${module.id}: ${path.relative(repositoryRoot, artifactPath(module))}`);
      }
    } catch (error) {
      if (!(error instanceof ArtifactMissingError) || mode === "release" || !buildOnMiss) throw error;
      const artifact = materializeDevelopmentArtifact(module);
      resolved.push({ module, path: artifact, source: "dev-build" });
      console.log(`BUILT ${module.id}: ${path.relative(repositoryRoot, artifact)}`);
    }
  }
  return resolved;
}

function verifyArtifact(module) {
  const artifact = artifactPath(module);
  if (!fs.existsSync(artifact)) throw new ArtifactMissingError(module.id, artifact);
  const realArtifact = fs.realpathSync(artifact);
  assertInside(repositoryRoot, realArtifact, `${module.id}.artifact.path`);
  const actual = sha256File(realArtifact);
  if (actual !== module.artifact.sha256) {
    throw new Error(
      `Artifact SHA-256 mismatch for ${module.id}: expected ${module.artifact.sha256}, got ${actual}`,
    );
  }
  verifyPackedPackage(module, realArtifact);
}

function verifyPackedPackage(module, artifact) {
  let packageJson;
  try {
    packageJson = JSON.parse(execFileSync("tar", ["-xOf", artifact, "package/package.json"], { encoding: "utf8" }));
  } catch (error) {
    throw new Error(`Cannot read package/package.json from ${module.id} artifact`, { cause: error });
  }
  if (packageJson.name !== module.packageName || packageJson.version !== module.version) {
    throw new Error(
      `Packed package identity mismatch for ${module.id}: expected ${module.packageName}@${module.version}, ` +
      `got ${String(packageJson.name)}@${String(packageJson.version)}`,
    );
  }
  for (const lifecycle of ["preinstall", "install", "postinstall", "prepare"]) {
    if (typeof packageJson.scripts?.[lifecycle] === "string") {
      throw new Error(`Packed ${module.id} must be runtime-ready and cannot declare ${lifecycle}`);
    }
  }
  // devDependencies 不会被制品消费者安装；这里只禁止会改变消费者解析位置的依赖写法。
  for (const field of ["dependencies", "optionalDependencies", "peerDependencies"]) {
    const dependencies = packageJson[field];
    if (dependencies === null || typeof dependencies !== "object" || Array.isArray(dependencies)) continue;
    for (const [name, spec] of Object.entries(dependencies)) {
      if (typeof spec === "string" && /^(?:link:|file:|workspace:)/u.test(spec)) {
        throw new Error(`Packed ${module.id} contains non-portable ${field} dependency ${name}: ${spec}`);
      }
    }
  }
}

function syncDesktopDependencies(value, write) {
  const manifestPath = path.resolve(repositoryRoot, value.product.desktopManifest);
  const manifest = readJson(manifestPath, "Desktop manifest");
  if (manifest.version !== value.product.version) {
    throw new Error(
      `Product version mismatch: platform-lock=${value.product.version}, desktop=${String(manifest.version)}`,
    );
  }
  const dependencies = { ...(manifest.dependencies ?? {}) };
  const desired = new Map(value.modules.map((module) => [
    module.packageName,
    fileSpecifier(path.dirname(manifestPath), artifactPath(module)),
  ]));
  const stale = [];
  for (const [name, spec] of Object.entries(dependencies)) {
    if (typeof spec !== "string" || !spec.startsWith("file:")) continue;
    const resolved = path.resolve(path.dirname(manifestPath), spec.slice("file:".length));
    if (isInside(path.join(repositoryRoot, "vendor"), resolved) && !desired.has(name)) stale.push(name);
  }
  let changed = false;
  for (const name of stale) {
    delete dependencies[name];
    changed = true;
  }
  for (const [name, spec] of desired) {
    if (dependencies[name] !== spec) {
      dependencies[name] = spec;
      changed = true;
    }
  }
  if (!changed) return;
  if (!write) {
    throw new Error("Desktop dependency projection is stale; run: node scripts/platform-lock.mjs sync");
  }
  manifest.dependencies = dependencies;
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`UPDATED ${path.relative(repositoryRoot, manifestPath)}`);
}

function syncWorkspaceOverrides(value, write) {
  const workspacePath = path.join(repositoryRoot, "pnpm-workspace.yaml");
  const source = fs.readFileSync(workspacePath, "utf8");
  const startMarker = "# platform-lock-overrides:start";
  const endMarker = "# platform-lock-overrides:end";
  const desiredEntries = value.modules
    .map((module) => [module.packageName, `file:${module.artifact.path.split(path.sep).join("/")}`])
    .sort(([left], [right]) => left.localeCompare(right));
  const desiredBlock = [
    startMarker,
    "# 由 scripts/platform-lock.mjs sync 生成；第一方依赖只能解析到锁定 tarball。",
    "overrides:",
    ...desiredEntries.map(([name, spec]) => `  '${name}': ${spec}`),
    endMarker,
  ].join("\n");
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker);
  let next;
  if (start === -1 && end === -1) {
    if (/^overrides:\s*$/mu.test(source)) {
      throw new Error("pnpm-workspace.yaml already has unmanaged overrides; merge it into the platform-lock block first");
    }
    next = `${source.trimEnd()}\n${desiredBlock}\n`;
  } else {
    if (start === -1 || end === -1 || end < start) {
      throw new Error("pnpm-workspace.yaml has an incomplete platform-lock overrides block");
    }
    const blockEnd = end + endMarker.length;
    next = `${source.slice(0, start)}${desiredBlock}${source.slice(blockEnd)}`;
  }
  if (next === source) return;
  if (!write) {
    throw new Error("pnpm override projection is stale; run: node scripts/platform-lock.mjs sync");
  }
  fs.writeFileSync(workspacePath, next);
  console.log(`UPDATED ${path.relative(repositoryRoot, workspacePath)}`);
}

function verifyPnpmLockProjection(value) {
  const lockfilePath = path.join(repositoryRoot, "pnpm-lock.yaml");
  const source = fs.readFileSync(lockfilePath, "utf8");
  const desktopManifestPath = path.resolve(repositoryRoot, value.product.desktopManifest);
  for (const module of value.modules) {
    const rootArtifactSpecifier = `file:${module.artifact.path.split(path.sep).join("/")}`;
    const desktopSpecifier = fileSpecifier(path.dirname(desktopManifestPath), artifactPath(module));
    for (const expected of [
      `  '${module.packageName}': ${rootArtifactSpecifier}`,
      `specifier: ${desktopSpecifier}`,
      `tarball: ${rootArtifactSpecifier}`,
    ]) {
      if (!source.includes(expected)) {
        throw new Error(`pnpm-lock projection is stale for ${module.packageName}: missing ${expected}`);
      }
    }
  }
  const declaredArtifactPaths = new Set(value.modules.map((module) => module.artifact.path));
  for (const match of source.matchAll(/file:(vendor\/platform\/[^\s(),}]+\.tgz)/gu)) {
    if (!declaredArtifactPaths.has(match[1])) {
      throw new Error(`pnpm-lock references an artifact outside platform-lock: ${match[1]}`);
    }
  }
}

function verifyRuntimeProjection(value) {
  const manifestPath = path.resolve(repositoryRoot, value.product.runtimeBundleManifest);
  const manifest = readJson(manifestPath, "Runtime bundle manifest");
  if (manifest.schemaVersion !== 3 || !Array.isArray(manifest.bundledPackages)) {
    throw new Error("Runtime bundle manifest must use schemaVersion 3 with bundledPackages");
  }
  const modulesById = new Map(value.modules.map((module) => [module.id, module]));
  const runtimeIds = new Set();
  for (const [index, spec] of manifest.bundledPackages.entries()) {
    if (typeof spec.moduleId !== "string" || !modulesById.has(spec.moduleId)) {
      throw new Error(`bundledPackages[${index}].moduleId is not declared by platform-lock`);
    }
    if (runtimeIds.has(spec.moduleId)) throw new Error(`Duplicate runtime moduleId: ${spec.moduleId}`);
    runtimeIds.add(spec.moduleId);
    for (const duplicatedField of ["artifact", "artifactSha256", "packageName", "repository", "sourceCommit", "version"]) {
      if (spec[duplicatedField] !== undefined) {
        throw new Error(`bundledPackages[${index}].${duplicatedField} belongs in platform-lock`);
      }
    }
  }
  const expectedRuntimeIds = value.modules
    .filter((module) => module.role === "product-plugin")
    .map((module) => module.id)
    .sort();
  const actualRuntimeIds = [...runtimeIds].sort();
  if (JSON.stringify(actualRuntimeIds) !== JSON.stringify(expectedRuntimeIds)) {
    throw new Error(
      `Runtime bundle modules do not match product plugins: expected ${expectedRuntimeIds.join(", ")}; ` +
      `got ${actualRuntimeIds.join(", ")}`,
    );
  }
}

function stageAppDependencies(value) {
  const modules = value.modules.filter((module) => (
    module.role === "desktop-core" || module.role === "runtime-adapter"
  ));
  if (modules.length !== 2) {
    throw new Error("Product Desktop app dependencies must include one Core and one Runtime Adapter");
  }
  const runtimeRoot = path.join(repositoryRoot, ".hermit", "runtime");
  const stageRoot = path.join(runtimeRoot, "app-dependencies");
  fs.mkdirSync(runtimeRoot, { recursive: true });
  const temporaryRoot = fs.mkdtempSync(path.join(runtimeRoot, "app-dependencies-"));
  try {
    const nodeModules = path.join(temporaryRoot, "node_modules");
    for (const module of modules) {
      const extractionRoot = fs.mkdtempSync(path.join(temporaryRoot, "extract-"));
      execFileSync("tar", ["-xzf", artifactPath(module), "-C", extractionRoot]);
      const packedRoot = path.join(extractionRoot, "package");
      const target = path.join(nodeModules, ...module.packageName.split("/"));
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.cpSync(packedRoot, target, { recursive: true, dereference: true });
      verifyPackedPackage(module, artifactPath(module));
      fs.rmSync(extractionRoot, { recursive: true, force: true });
    }
    fs.writeFileSync(
      path.join(temporaryRoot, "platform-app-dependencies.json"),
      `${JSON.stringify({
        schemaVersion: 1,
        platformLockSha256: sha256File(lockPath),
        modules: modules.map((module) => ({
          id: module.id,
          packageName: module.packageName,
          version: module.version,
          artifactSha256: module.artifact.sha256,
        })),
      }, null, 2)}\n`,
    );
    fs.rmSync(stageRoot, { recursive: true, force: true });
    fs.renameSync(temporaryRoot, stageRoot);
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

function materializeDevelopmentArtifact(module) {
  const declaredArtifact = artifactPath(module);
  const cacheRoot = path.join(
    repositoryRoot,
    ".hermit",
    "artifacts",
    "platform-cache",
    module.id,
    module.sourceCommit,
  );
  const cachedArtifact = path.join(cacheRoot, path.basename(declaredArtifact));
  fs.mkdirSync(cacheRoot, { recursive: true });
  if (fs.existsSync(cachedArtifact)) {
    if (sha256File(cachedArtifact) !== module.artifact.sha256) {
      throw new Error(`Development cache digest mismatch for ${module.id}: ${cachedArtifact}`);
    }
    verifyPackedPackage(module, cachedArtifact);
    copyLockedArtifact(module, cachedArtifact, declaredArtifact);
    return declaredArtifact;
  }
  const builtArtifact = buildModule(module);
  try {
    const actual = sha256File(builtArtifact);
    const diagnosticArtifact = path.join(cacheRoot, `${actual}-${path.basename(builtArtifact)}`);
    fs.copyFileSync(builtArtifact, diagnosticArtifact);
    if (actual !== module.artifact.sha256) {
      throw new Error(
        `Development build for ${module.id} did not reproduce the locked artifact: ` +
        `expected ${module.artifact.sha256}, got ${actual}; kept ${diagnosticArtifact}`,
      );
    }
    verifyPackedPackage(module, diagnosticArtifact);
    fs.copyFileSync(diagnosticArtifact, cachedArtifact);
    copyLockedArtifact(module, cachedArtifact, declaredArtifact);
    return declaredArtifact;
  } finally {
    fs.rmSync(path.dirname(builtArtifact), { recursive: true, force: true });
  }
}

function buildModule(module) {
  const sourceRoot = path.resolve(repositoryRoot, module.repoPath);
  if (!isGitWorktree(sourceRoot)) throw new Error(`Development source repository is unavailable: ${sourceRoot}`);
  const declaredLockfile = path.resolve(repositoryRoot, module.lockfile);
  const relativeLockfile = path.relative(sourceRoot, declaredLockfile);
  if (relativeLockfile.startsWith("..") || path.isAbsolute(relativeLockfile)) {
    throw new Error(`${module.id}.lockfile must belong to its source repository`);
  }
  const worktree = fs.mkdtempSync(path.join(os.tmpdir(), `platform-${module.id}-`));
  const artifactDirectory = fs.mkdtempSync(path.join(os.tmpdir(), `platform-artifact-${module.id}-`));
  let worktreeAdded = false;
  let artifactReturned = false;
  try {
    run("git", ["-C", sourceRoot, "cat-file", "-e", `${module.sourceCommit}^{commit}`], repositoryRoot);
    run("git", ["-C", sourceRoot, "worktree", "add", "--detach", worktree, module.sourceCommit], repositoryRoot);
    worktreeAdded = true;
    const worktreeLockfile = path.join(worktree, relativeLockfile);
    if (!fs.existsSync(worktreeLockfile)) throw new Error(`Locked source is missing ${relativeLockfile}: ${module.id}`);
    const actualLockfileSha = sha256File(worktreeLockfile);
    if (actualLockfileSha !== module.lockfileSha256) {
      throw new Error(
        `Source lockfile SHA-256 mismatch for ${module.id}: expected ${module.lockfileSha256}, got ${actualLockfileSha}`,
      );
    }
    run("corepack", ["pnpm", "install", "--frozen-lockfile", "--ignore-scripts"], worktree, { CI: "true" });
    runBuildContract(module, worktree);
    const artifact = findPackedArtifact(module, worktree, artifactDirectory);
    artifactReturned = true;
    return artifact;
  } finally {
    if (worktreeAdded) {
      run("git", ["-C", sourceRoot, "worktree", "remove", "--force", worktree], repositoryRoot, undefined, true);
    }
    fs.rmSync(worktree, { recursive: true, force: true });
    if (!artifactReturned) fs.rmSync(artifactDirectory, { recursive: true, force: true });
  }
}

function runBuildContract(module, worktree) {
  if (module.build.workspaceFilter === undefined) {
    run("corepack", ["pnpm", "test"], path.join(worktree, module.build.packagePath));
    return;
  }
  run("corepack", ["pnpm", "--filter", module.build.workspaceFilter, "test"], worktree);
}

function findPackedArtifact(module, worktree, artifactDirectory) {
  const packageRoot = path.join(worktree, module.build.packagePath);
  const commandArgs = module.build.workspaceFilter === undefined
    ? ["pnpm", "pack", "--pack-destination", artifactDirectory]
    : ["pnpm", "--filter", module.build.workspaceFilter, "pack", "--pack-destination", artifactDirectory];
  run("corepack", commandArgs, module.build.workspaceFilter === undefined ? packageRoot : worktree);
  const expectedPrefix = `${module.packageName.replace(/^@/u, "").replaceAll("/", "-")}-${module.version}`;
  const candidates = fs.readdirSync(artifactDirectory)
    .filter((name) => name.endsWith(".tgz") && name.startsWith(expectedPrefix));
  if (candidates.length !== 1) {
    throw new Error(`Expected one packed artifact for ${module.id}, found ${candidates.join(", ")}`);
  }
  return path.join(artifactDirectory, candidates[0]);
}

function copyLockedArtifact(module, source, destination) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
  verifyArtifact(module);
}

function printResolution(resolved) {
  console.log(JSON.stringify({
    mode,
    modules: resolved.map(({ module, path: artifact, source }) => ({
      id: module.id,
      packageName: module.packageName,
      version: module.version,
      artifact,
      source,
    })),
  }, null, 2));
}

function artifactPath(module) {
  return path.resolve(repositoryRoot, module.artifact.path);
}

function sha256File(file) {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function isGitWorktree(repository) {
  try {
    return execFileSync("git", ["-C", repository, "rev-parse", "--is-inside-work-tree"], { encoding: "utf8" }).trim() === "true";
  } catch {
    return false;
  }
}

function assertProductPath(label, relativePath) {
  if (typeof relativePath !== "string" || relativePath.length === 0 || path.isAbsolute(relativePath)) {
    throw new Error(`${label} must be relative to the Product Desktop repository`);
  }
  assertInside(repositoryRoot, path.resolve(repositoryRoot, relativePath), label);
}

function assertWorkspaceHint(label, relativePath) {
  if (typeof relativePath !== "string" || relativePath.length === 0 || path.isAbsolute(relativePath)) {
    throw new Error(`${label} must be a relative development hint`);
  }
  assertInside(workspaceRoot, path.resolve(repositoryRoot, relativePath), label);
}

function assertInside(root, candidate, label) {
  if (!isInside(root, candidate)) throw new Error(`${label} resolves outside ${root}`);
}

function isInside(root, candidate) {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  return resolvedCandidate === resolvedRoot || resolvedCandidate.startsWith(`${resolvedRoot}${path.sep}`);
}

function fileSpecifier(fromDirectory, artifact) {
  const relative = path.relative(fromDirectory, artifact).split(path.sep).join("/");
  return `file:${relative.startsWith(".") ? relative : `./${relative}`}`;
}

function run(commandName, commandArgs, cwd, extraEnvironment = {}, allowFailure = false) {
  const result = spawnSync(commandName, commandArgs, {
    cwd,
    env: { ...process.env, ...extraEnvironment },
    stdio: "inherit",
  });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0 && !allowFailure) {
    throw new Error(`${commandName} ${commandArgs.join(" ")} exited with ${String(result.status)}`);
  }
}

function optionValue(name) {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

function usage(message) {
  throw new Error(
    `${message}\nUsage: node scripts/platform-lock.mjs <install|prepare|resolve|sync|verify> ` +
    `[--mode dev|release] [--module id] [--build-on-miss] [--lock path]`,
  );
}
