#!/usr/bin/env node

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const defaultRepositoryRoot = path.resolve(path.dirname(scriptPath), "..");

/** 汇总两个原生 runner 的已验证安装包，生成唯一的 Product Desktop Release manifest。 */
export function aggregateReleaseAssets({
  macDirectory,
  windowsDirectory,
  outputDirectory,
} = {}) {
  const mac = readPlatformRelease(macDirectory, { platform: "darwin", architecture: "arm64" });
  const windows = readPlatformRelease(windowsDirectory, { platform: "win32", architecture: "x64" });
  for (const field of ["product", "version", "tag", "commit", "signed", "notarized"]) {
    if (JSON.stringify(mac.manifest[field]) !== JSON.stringify(windows.manifest[field])) {
      throw new Error("Release platform manifests disagree on " + field);
    }
  }
  fs.mkdirSync(outputDirectory, { recursive: true });
  const artifacts = [mac, windows].map(({ directory, manifest }) => {
    const source = path.join(directory, manifest.artifact.name);
    const destination = path.join(outputDirectory, manifest.artifact.name);
    if (fs.existsSync(destination)) {
      if (sha256File(destination) !== manifest.artifact.sha256) {
        throw new Error("Aggregate output already contains a different asset: " + destination);
      }
    } else {
      fs.copyFileSync(source, destination);
    }
    return manifest.artifact;
  });
  const manifest = {
    schemaVersion: 2,
    product: mac.manifest.product,
    version: mac.manifest.version,
    tag: mac.manifest.tag,
    commit: mac.manifest.commit,
    generatedAt: new Date().toISOString(),
    target: {
      platforms: [
        { platform: "darwin", architecture: "arm64" },
        { platform: "win32", architecture: "x64" },
      ],
    },
    source: mac.manifest.source,
    sources: {
      darwin: mac.manifest.source,
      win32: windows.manifest.source,
    },
    builds: {
      darwin: mac.manifest.build,
      win32: windows.manifest.build,
    },
    signed: mac.manifest.signed,
    notarized: mac.manifest.notarized,
    artifacts,
    steps: {
      sourceAndTag: "PASS",
      macos: "PASS",
      windows: "PASS",
      aggregate: "PASS",
    },
  };
  const manifestPath = path.join(outputDirectory, "release-manifest.json");
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
  const checksumLines = [
    ...artifacts.map((artifact) => artifact.sha256 + "  " + artifact.name),
    sha256File(manifestPath) + "  release-manifest.json",
  ].sort();
  const checksumPath = path.join(outputDirectory, "SHA256SUMS");
  fs.writeFileSync(checksumPath, checksumLines.join("\n") + "\n", "utf8");
  return { manifestPath, checksumPath, manifest };
}

function readPlatformRelease(directory, expectedTarget) {
  const manifestPath = path.join(directory, "release-manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (manifest.schemaVersion !== 2) throw new Error("Unsupported release manifest schema: " + manifestPath);
  if (manifest.target?.platform !== expectedTarget.platform || manifest.target?.architecture !== expectedTarget.architecture) {
    throw new Error("Release manifest target mismatch: " + manifestPath);
  }
  const artifact = manifest.artifact;
  if (typeof artifact?.name !== "string" || typeof artifact?.sha256 !== "string") {
    throw new Error("Release manifest has no artifact identity: " + manifestPath);
  }
  const artifactPath = path.join(directory, artifact.name);
  const info = fs.statSync(artifactPath, { throwIfNoEntry: false });
  if (info === undefined || !info.isFile() || info.size === 0) {
    throw new Error("Release artifact is missing or empty: " + artifactPath);
  }
  if (sha256File(artifactPath) !== artifact.sha256) {
    throw new Error("Release artifact SHA mismatch: " + artifactPath);
  }
  return { directory, manifest };
}

function sha256File(file) {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function optionValue(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === scriptPath) {
  try {
    const result = aggregateReleaseAssets({
      macDirectory: path.resolve(optionValue("--mac")),
      windowsDirectory: path.resolve(optionValue("--windows")),
      outputDirectory: path.resolve(optionValue("--output") ?? path.join(defaultRepositoryRoot, "release-assets")),
    });
    console.log("Release assets aggregated: " + result.manifestPath);
    console.log("Release checksums: " + result.checksumPath);
  } catch (cause) {
    console.error("[release-aggregate] " + (cause instanceof Error ? cause.message : String(cause)));
    process.exitCode = 1;
  }
}
