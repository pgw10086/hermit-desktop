// Adapted from anywhere-labs/dsh-desktop@1eb398d (MIT).
// 与上游不同，Hermit显式验证外置 carrier、bundled Node 和 stock DSH generation。
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readDshUpstreamRegistry } from "../../../scripts/dsh-upstream.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const appRoot = path.resolve(path.dirname(scriptPath), "..");
const repositoryRoot = path.resolve(appRoot, "..", "..");

const mode = process.argv[2];
if (!new Set(["smoke", "release"]).has(mode)) {
  throw new Error("Usage: verify-mac-artifact.mjs <smoke|release> [dist-directory]");
}
if (process.platform !== "darwin" || process.arch !== "arm64") {
  throw new Error("macOS artifact verification requires a native Apple Silicon host");
}

const distDirectory = path.resolve(
  process.argv[3] ?? path.join(appRoot, "dist", mode === "release" ? "mac-release" : "mac-smoke"),
);
const dmgPaths = fs.readdirSync(distDirectory)
  .filter((name) => name.endsWith(".dmg"))
  .map((name) => path.join(distDirectory, name))
  .filter((candidate) => fs.statSync(candidate).isFile());
if (dmgPaths.length !== 1) {
  throw new Error(
    `macOS ${mode} verification requires exactly one DMG in ${distDirectory}; found ${String(dmgPaths.length)}`,
  );
}

const dmgPath = dmgPaths[0];
const mountPoint = fs.mkdtempSync(path.join(os.tmpdir(), "hermit-dmg-"));
const appPath = path.join(mountPoint, "Hermit.app");
let mounted = false;
let failure;

try {
  run("hdiutil", ["attach", dmgPath, "-mountpoint", mountPoint, "-nobrowse", "-readonly"]);
  mounted = true;
  verifyApplication(appPath);
} catch (cause) {
  failure = cause;
}

const cleanupFailures = [];
if (mounted) {
  try {
    detachDiskImage(mountPoint);
  } catch (cause) {
    cleanupFailures.push(cause);
  }
}
try {
  fs.rmdirSync(mountPoint);
} catch (cause) {
  cleanupFailures.push(cause);
}

if (failure !== undefined || cleanupFailures.length > 0) {
  const errors = failure === undefined ? cleanupFailures : [failure, ...cleanupFailures];
  throw new AggregateError(errors, `Failed to verify macOS ${mode} DMG ${path.basename(dmgPath)}`);
}

console.log(`macOS ${mode} unsigned DMG passed: ${dmgPath}`);

function verifyApplication(applicationPath) {
  const contents = path.join(applicationPath, "Contents");
  const resources = path.join(contents, "Resources");
  const executable = path.join(contents, "MacOS", "Hermit");
  const generationRoot = path.join(resources, "runtime", "generations", "bundled");
  const nodeBinary = path.join(generationRoot, "node", "bin", "node");
  const carrier = path.join(resources, "runtime", "carrier", "dsh-carrier.js");
  const generationManifestPath = path.join(generationRoot, "generation.json");
  const dshManifestPath = path.join(
    generationRoot,
    "dsh",
    "node_modules",
    "@deepseek-ai",
    "dsh",
    "package.json",
  );

  for (const required of [
    path.join(contents, "Info.plist"),
    executable,
    path.join(resources, "app.asar"),
    nodeBinary,
    carrier,
    generationManifestPath,
    dshManifestPath,
    path.join(resources, "THIRD_PARTY_NOTICES.md"),
  ]) {
    assertRegularNonEmptyFile(required);
  }
  assertExecutable(executable);
  assertExecutable(nodeBinary);
  run("plutil", ["-lint", path.join(contents, "Info.plist")]);
  run("lipo", [executable, "-verify_arch", "arm64"]);
  run("lipo", [nodeBinary, "-verify_arch", "arm64"]);

  const expectedNodeVersion = fs.readFileSync(path.join(repositoryRoot, ".node-version"), "utf8").trim();
  const desktopManifest = readJson(path.join(appRoot, "package.json"));
  const generation = readJson(generationManifestPath);
  const dshManifest = readJson(dshManifestPath);
  const dshUpstream = readDshUpstreamRegistry(repositoryRoot);
  if (generation.nodeVersion !== expectedNodeVersion) {
    throw new Error(`Unexpected bundled Node version: ${String(generation.nodeVersion)}`);
  }
  if (generation.dshVersion !== desktopManifest.dependencies["@deepseek-ai/dsh"]) {
    throw new Error(`Unexpected generation DSH version: ${String(generation.dshVersion)}`);
  }
  if (dshManifest.version !== generation.dshVersion) {
    throw new Error("DSH package version does not match generation.json");
  }
  if (
    generation.dshUpstream?.commit !== dshUpstream.upstreamCommit ||
    generation.dshUpstream?.packageVersion !== dshUpstream.dshPackageVersion ||
    generation.dshUpstream?.snapshotChecksum !== dshUpstream.snapshotChecksum
  ) {
    throw new Error("Packaged generation does not match the active DSH upstream snapshot");
  }
  const nodeVersion = capture(nodeBinary, ["--version"]);
  if (nodeVersion !== `v${expectedNodeVersion}`) {
    throw new Error(`Bundled Node executable reported ${nodeVersion}`);
  }

  run(process.execPath, [path.join(appRoot, "scripts", "verify-packaged-runtime.mjs"), resources]);
  run(
    process.execPath,
    [path.join(appRoot, "tests", "m1-desktop-packaged.e2e.mjs")],
    {
      ...process.env,
      HERMIT_PACKAGED_EXECUTABLE: executable,
      HERMIT_PACKAGED_QUALIFICATION: "1",
    },
  );

}

function assertRegularNonEmptyFile(file) {
  const info = fs.statSync(file, { throwIfNoEntry: false });
  if (info === undefined || !info.isFile() || info.size === 0) {
    throw new Error(`Packaged application has a missing or empty file: ${file}`);
  }
}

function assertExecutable(file) {
  if ((fs.statSync(file).mode & 0o111) === 0) {
    throw new Error(`Packaged executable is not executable: ${file}`);
  }
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function capture(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} exited with ${String(result.status)}`);
  }
  return result.stdout.trim();
}

function run(command, args, environment = process.env) {
  const result = spawnSync(command, args, { env: environment, stdio: "inherit" });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} exited with ${String(result.status)}`);
  }
}

/** 正常卸载优先；macOS runner 偶尔残留应用句柄时显式记录后强制卸载，仍保留最终失败。 */
function detachDiskImage(mountPoint) {
  try {
    run("hdiutil", ["detach", mountPoint]);
  } catch (cause) {
    console.error(`Normal DMG detach failed; retrying with -force: ${cause instanceof Error ? cause.message : String(cause)}`);
    run("hdiutil", ["detach", "-force", mountPoint]);
  }
}
