import fs from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { readActiveDshCohort, readDshUpstreamRegistry } from "./dsh-upstream.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliArgs = process.argv.slice(2).filter((argument) => argument !== "--");
const candidateVersion = cliArgs[0];

if (cliArgs.length !== 1 || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(candidateVersion ?? "")) {
  console.error("用法：node scripts/inspect-dsh-upgrade-candidate.mjs <DSH package version>");
  process.exit(64);
}

const active = readActiveDshCohort(repositoryRoot);
const registry = readDshUpstreamRegistry(repositoryRoot);
const candidate = readCandidateSnapshot(registry, candidateVersion);
const workspacePackages = await readWorkspacePackages();
const declaredDshPackages = new Set();
for (const { manifest } of workspacePackages) {
  for (const section of [manifest.dependencies, manifest.devDependencies, manifest.peerDependencies]) {
    for (const name of Object.keys(section ?? {})) {
      if (name.startsWith("@deepseek-ai/dsh")) declaredDshPackages.add(name);
    }
  }
}
const customLayout = workspacePackages.find(({ manifest }) => manifest.name === "@deepseek-ai/dsh-client-ui-layout")?.manifest;
const customLayoutMismatch = customLayout !== undefined && (
  customLayout.version !== candidateVersion
  || customLayout.hermitPatch?.upstreamTag !== candidate.sourceTag
  || customLayout.hermitPatch?.upstreamCommit !== candidate.sourceContextCommit
);

const candidateDsh = await registryPackage("@deepseek-ai/dsh", candidateVersion);
const candidateDependencyNames = Object.keys(candidateDsh?.dependencies ?? {})
  .filter((name) => name.startsWith("@deepseek-ai/dsh"))
  .sort();
const directMissing = [];
for (const name of [...declaredDshPackages].sort()) {
  if (name === "@deepseek-ai/dsh-client-ui-layout") continue;
  const packageInfo = await registryPackage(name, candidateVersion);
  if (packageInfo === undefined) directMissing.push(name);
}
const dependencyMissing = [];
for (const name of candidateDependencyNames) {
  if (await registryPackage(name, candidateVersion) === undefined) dependencyMissing.push(name);
}

const hasBlockers = directMissing.length > 0 || dependencyMissing.length > 0 || customLayoutMismatch;
const isActiveCandidate = candidateVersion === active.packageVersion;
const report = {
  schemaVersion: 1,
  status: hasBlockers ? "blocked" : isActiveCandidate ? "active" : "review-required",
  active: {
    packageVersion: active.packageVersion,
    tag: active.tag,
    commit: active.commit,
  },
  candidate: {
    packageVersion: candidateVersion,
    tag: candidate.sourceTag,
    commit: candidate.sourceContextCommit,
    snapshotPath: candidate.target,
    snapshotChecksum: candidate.sourceSha256,
  },
  blockers: [
    ...(directMissing.length === 0 ? [] : [`workspace packages missing at ${candidateVersion}: ${directMissing.join(", ")}`]),
    ...(dependencyMissing.length === 0 ? [] : [`DSH dependencies missing at ${candidateVersion}: ${dependencyMissing.join(", ")}`]),
    ...(customLayoutMismatch ? ["Hermit custom layout is still pinned to the active DSH cohort; port and requalify its patch before activation"] : []),
  ],
  facts: {
    declaredWorkspaceDshPackages: [...declaredDshPackages].sort(),
    candidateDshDependencyCount: candidateDependencyNames.length,
    candidateDshDependenciesMissing: dependencyMissing,
    workspacePackagesMissing: directMissing,
    customLayout: customLayout === undefined ? undefined : {
      version: customLayout.version,
      upstreamTag: customLayout.hermitPatch?.upstreamTag,
      upstreamCommit: customLayout.hermitPatch?.upstreamCommit,
      matchesCandidate: !customLayoutMismatch,
    },
  },
};

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (report.status === "blocked") process.exitCode = 2;

function readCandidateSnapshot(metadata, version) {
  const importsPath = path.join(repositoryRoot, "docs", "provenance", "imports.yaml");
  const imports = parseYaml(readText(importsPath));
  const entry = (imports.imports ?? []).find((item) =>
    item.sourcePackageVersion === version
    && item.sourceRepository === metadata.upstreamRepository
    && (item.sourceState === "upstream-immutable-candidate-snapshot"
      || item.sourceState === "upstream-immutable-active-snapshot"),
  );
  if (entry === undefined) {
    throw new Error(`没有找到 DSH ${version} 的 immutable candidate 或 active snapshot`);
  }
  return entry;
}

function readText(file) {
  return readFileSync(file, "utf8");
}

async function readWorkspacePackages() {
  const files = [
    path.join(repositoryRoot, "package.json"),
    ...(await packageFiles(path.join(repositoryRoot, "apps"))),
    ...(await packageFiles(path.join(repositoryRoot, "packages"))),
  ];
  return Promise.all(files.map(async (file) => ({
    path: file,
    manifest: JSON.parse(await fs.readFile(file, "utf8")),
  })));
}

async function packageFiles(parent) {
  let entries;
  try {
    entries = await fs.readdir(parent, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(parent, entry.name, "package.json"))
    .filter((file) => existsSync(file));
}

async function registryPackage(name, version) {
  const response = await fetch(
    `https://registry.npmjs.org/${name.replaceAll("/", "%2f")}/${encodeURIComponent(version)}`,
  );
  if (response.status === 404) return undefined;
  if (!response.ok) throw new Error(`读取 npm registry 失败：${name}@${version} (${response.status})`);
  return response.json();
}
