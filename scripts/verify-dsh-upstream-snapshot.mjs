import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { readDshUpstreamRegistry } from "./dsh-upstream.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDir, "..");
const snapshotRoot = path.join(
  repositoryRoot,
  "docs",
  "provenance",
  "deepseek-harness",
  "snapshots",
);
const failures = [];

function fail(message) {
  failures.push(message);
}

function resolveInside(root, relative, label) {
  if (typeof relative !== "string" || relative.length === 0) {
    throw new Error(`${label} 必须是非空相对路径`);
  }
  const resolved = path.resolve(repositoryRoot, relative);
  if (!resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error(`${label} 越出仓库范围：${relative}`);
  }
  return resolved;
}

function walkFiles(directory, output = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`快照不允许 symbolic link：${target}`);
    if (entry.isDirectory()) walkFiles(target, output);
    else if (entry.isFile()) output.push(target);
  }
  return output;
}

function sha256(file) {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function verifyChecksums(snapshot) {
  const checksumPath = path.join(snapshot, "CHECKSUMS.sha256");
  if (!fs.existsSync(checksumPath)) throw new Error("缺少 CHECKSUMS.sha256");
  const entries = new Map();
  for (const line of fs.readFileSync(checksumPath, "utf8").split(/\r?\n/u)) {
    if (line.length === 0) continue;
    const match = /^([a-f0-9]{64})  (.+)$/u.exec(line);
    if (match === null) throw new Error(`CHECKSUMS.sha256 行格式错误：${line}`);
    const relative = match[2].replace(/^\.\//u, "");
    const target = path.resolve(snapshot, relative);
    if (!target.startsWith(`${snapshot}${path.sep}`) || relative === "CHECKSUMS.sha256") {
      throw new Error(`CHECKSUMS.sha256 路径无效：${relative}`);
    }
    if (entries.has(relative)) throw new Error(`CHECKSUMS.sha256 重复文件：${relative}`);
    entries.set(relative, { target, expected: match[1] });
  }
  const files = walkFiles(snapshot)
    .filter((file) => file !== checksumPath)
    .map((file) => path.relative(snapshot, file).split(path.sep).join("/"));
  for (const relative of files) {
    const entry = entries.get(relative);
    if (entry === undefined) throw new Error(`快照文件未登记摘要：${relative}`);
    const actual = sha256(entry.target);
    if (actual !== entry.expected) throw new Error(`快照文件摘要不匹配：${relative}`);
  }
  for (const relative of entries.keys()) {
    if (!files.includes(relative)) throw new Error(`摘要指向不存在文件：${relative}`);
  }
  return sha256(checksumPath);
}

function readJson(file, label) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (cause) {
    throw new Error(`${label} 无法读取：${cause instanceof Error ? cause.message : String(cause)}`);
  }
}

function verifySnapshot(snapshot) {
  const checksum = verifyChecksums(snapshot);
  const packageManifest = readJson(path.join(snapshot, "package.json"), "DSH 官方 package.json");
  if (packageManifest.name !== "@deepseek-ai/dsh-root") {
    throw new Error(`DSH 官方 package.json name 不正确：${String(packageManifest.name)}`);
  }
  if (typeof packageManifest.version !== "string" || packageManifest.version.length === 0) {
    throw new Error("DSH 官方 package.json 缺少 version");
  }
  if (fs.existsSync(path.join(snapshot, "AGENTS.md"))) {
    throw new Error("快照不应携带上游 AGENTS.md；上游内部指令不属于插件开发契约");
  }
  return { checksum, packageVersion: packageManifest.version };
}

try {
  const metadata = readDshUpstreamRegistry(repositoryRoot);
  if (metadata.status !== "active") throw new Error(`当前 DSH 快照状态必须为 active：${String(metadata.status)}`);
  if (!/^https:\/\//u.test(metadata.upstreamRepository ?? "")) throw new Error("upstreamRepository 必须是 HTTPS 地址");
  if (!/^[a-f0-9]{40}$/u.test(metadata.upstreamCommit ?? "")) throw new Error("upstreamCommit 必须是完整 40 位 commit");
  if (typeof metadata.dshPackageVersion !== "string" || metadata.dshPackageVersion.length === 0) {
    throw new Error("dshPackageVersion 必须是非空字符串");
  }
  if (!/^[a-f0-9]{64}$/u.test(metadata.snapshotChecksum ?? "")) {
    throw new Error("snapshotChecksum 必须是 SHA-256");
  }
  const activeSnapshot = resolveInside(repositoryRoot, metadata.snapshotPath, "snapshotPath");
  if (!fs.existsSync(activeSnapshot) || !fs.statSync(activeSnapshot).isDirectory()) {
    throw new Error(`active snapshot 目录不存在：${metadata.snapshotPath}`);
  }
  const active = verifySnapshot(activeSnapshot);
  if (active.packageVersion !== metadata.dshPackageVersion) {
    throw new Error(`active 快照 package 版本与登记不一致：${active.packageVersion} != ${metadata.dshPackageVersion}`);
  }
  if (active.checksum !== metadata.snapshotChecksum) {
    throw new Error(`active 快照 checksum 与登记不一致：${active.checksum} != ${metadata.snapshotChecksum}`);
  }

  const rootPackage = readJson(path.join(repositoryRoot, "package.json"), "Hermit 根 package.json");
  const desktopPackage = readJson(
    path.join(repositoryRoot, "apps", "desktop-vnext", "package.json"),
    "Hermit desktop package.json",
  );
  for (const [label, manifest] of [["根 package", rootPackage], ["desktop package", desktopPackage]]) {
    const dshVersion = manifest.devDependencies?.["@deepseek-ai/dsh"] ?? manifest.dependencies?.["@deepseek-ai/dsh"];
    if (dshVersion !== metadata.dshPackageVersion) {
      throw new Error(`${label} 的 @deepseek-ai/dsh 与 active 快照不一致：${String(dshVersion)} != ${metadata.dshPackageVersion}`);
    }
  }

  for (const entry of fs.readdirSync(snapshotRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const snapshot = path.join(snapshotRoot, entry.name);
    const result = verifySnapshot(snapshot);
    console.log(`${entry.name}: ${result.packageVersion} / ${result.checksum}`);
  }
  console.log(`Active DSH upstream snapshot verified: ${metadata.snapshotPath}`);
} catch (cause) {
  fail(cause instanceof Error ? cause.message : String(cause));
}

if (failures.length > 0) {
  console.error("DSH upstream snapshot verification failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
