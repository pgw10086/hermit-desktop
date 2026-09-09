import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { aggregateReleaseAssets } from "./aggregate-release-assets.mjs";

test("聚合 macOS/Windows 平台清单并生成最终 SHA256SUMS", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hermit-release-aggregate-"));
  try {
    const mac = createPlatform(root, "mac", "darwin", "arm64", "Hermit-0.2.2-arm64.dmg", "mac artifact");
    const windows = createPlatform(root, "windows", "win32", "x64", "Hermit-0.2.2-x64.exe", "windows artifact");
    const output = path.join(root, "output");
    const result = aggregateReleaseAssets({ macDirectory: mac, windowsDirectory: windows, outputDirectory: output });
    assert.equal(result.manifest.artifacts.length, 2);
    assert.equal(result.manifest.sources.win32.sourceLockfileSha256, "d".repeat(64));
    assert.equal(fs.existsSync(path.join(output, "Hermit-0.2.2-arm64.dmg")), true);
    assert.match(fs.readFileSync(result.checksumPath, "utf8"), /release-manifest\.json/u);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("平台版本或 platform-lock 不一致时拒绝聚合", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hermit-release-aggregate-"));
  try {
    const mac = createPlatform(root, "mac", "darwin", "arm64", "Hermit-0.2.2-arm64.dmg", "mac artifact");
    const windows = createPlatform(root, "windows", "win32", "x64", "Hermit-0.2.3-x64.exe", "windows artifact");
    const manifestPath = path.join(windows, "release-manifest.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    manifest.version = "0.2.3";
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));
    assert.throws(
      () => aggregateReleaseAssets({ macDirectory: mac, windowsDirectory: windows, outputDirectory: path.join(root, "output") }),
      /disagree on version/u,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function createPlatform(root, name, platform, architecture, artifactName, contents) {
  const directory = path.join(root, name);
  fs.mkdirSync(directory, { recursive: true });
  const artifactPath = path.join(directory, artifactName);
  fs.writeFileSync(artifactPath, contents);
  const manifest = {
    schemaVersion: 2,
    product: "Hermit",
    version: "0.2.2",
    tag: "v0.2.2",
    commit: "a".repeat(40),
    target: { platform, architecture },
    source: { sourceLockfileSha256: "d".repeat(64) },
    build: { runner: name },
    platformLock: { sha256: "b".repeat(64), modules: [] },
    artifact: { name: artifactName, bytes: Buffer.byteLength(contents), sha256: sha256File(artifactPath) },
  };
  fs.writeFileSync(path.join(directory, "release-manifest.json"), JSON.stringify(manifest, null, 2));
  return directory;
}

function sha256File(file) {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}
