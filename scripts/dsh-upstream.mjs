import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";

export function readDshUpstreamRegistry(repositoryRoot) {
  const registryPath = path.join(repositoryRoot, "DEEPSEEK-HARNESS-UPSTREAM.md");
  const text = fs.readFileSync(registryPath, "utf8");
  const match = /^---\n([\s\S]*?)\n---\n/u.exec(text);
  if (match === null) throw new Error("DSH upstream registry 缺少 Markdown YAML front matter");
  const metadata = YAML.parse(match[1]);
  if (metadata === null || typeof metadata !== "object" || Array.isArray(metadata)) {
    throw new Error("DSH upstream registry front matter 必须是对象");
  }
  return metadata;
}

/**
 * Read the one DSH cohort that is allowed to reach the runtime build.
 *
 * Version, tag and commit are deliberately read from the registry instead of
 * being copied into each patch/packaging script.  Keeping those values in one
 * object makes an upgrade fail at the first stale consumer rather than
 * producing a mixed runtime closure.
 */
export function readActiveDshCohort(repositoryRoot) {
  const metadata = readDshUpstreamRegistry(repositoryRoot);
  const required = [
    ["upstreamRepository", metadata.upstreamRepository],
    ["upstreamTag", metadata.upstreamTag],
    ["upstreamCommit", metadata.upstreamCommit],
    ["dshPackageVersion", metadata.dshPackageVersion],
    ["snapshotPath", metadata.snapshotPath],
    ["snapshotChecksum", metadata.snapshotChecksum],
  ];
  for (const [label, value] of required) {
    if (typeof value !== "string" || value.length === 0) {
      throw new Error(`DSH upstream registry 缺少 ${label}`);
    }
  }
  if (metadata.status !== "active") {
    throw new Error(`DSH upstream registry 当前不是 active：${String(metadata.status)}`);
  }
  return Object.freeze({
    repository: metadata.upstreamRepository,
    tag: metadata.upstreamTag,
    commit: metadata.upstreamCommit,
    packageVersion: metadata.dshPackageVersion,
    snapshotPath: metadata.snapshotPath,
    snapshotChecksum: metadata.snapshotChecksum,
  });
}
