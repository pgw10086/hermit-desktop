import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  assertMacReleaseSource,
  writeMacReleaseAssets,
} from "./prepare-macos-release-assets.mjs";

test("发布源码预检要求原生平台、干净提交和版本 tag", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hermit-release-source-"));
  try {
    fs.mkdirSync(path.join(root, "apps", "desktop-vnext"), { recursive: true });
    fs.writeFileSync(path.join(root, "apps", "desktop-vnext", "package.json"), '{"version":"0.2.2"}\n');
    git(root, ["init"]);
    git(root, ["config", "user.name", "Hermit Test"]);
    git(root, ["config", "user.email", "hermit@example.invalid"]);
    git(root, ["add", "."]);
    git(root, ["commit", "-m", "test release source"]);
    const commit = git(root, ["rev-parse", "HEAD"]);
    git(root, ["tag", "v0.2.2"]);
    git(root, ["update-ref", "refs/remotes/origin/main", commit]);
    const source = assertMacReleaseSource({ repositoryRoot: root, platform: "darwin", architecture: "arm64" });
    assert.equal(source.version, "0.2.2");
    assert.equal(source.tag, "v0.2.2");
    fs.writeFileSync(path.join(root, "dirty.txt"), "dirty");
    assert.throws(
      () => assertMacReleaseSource({ repositoryRoot: root, platform: "darwin", architecture: "arm64" }),
      /clean Git working tree/u,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("发布附件记录正常版本、摘要和显式跳过的可选步骤", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hermit-release-assets-"));
  try {
    const dmgPath = path.join(root, "Hermit-0.1.0-arm64.dmg");
    fs.writeFileSync(dmgPath, "release-dmg", "utf8");
    const result = writeMacReleaseAssets({
      dmgPath,
      outputDirectory: path.join(root, "out"),
      version: "0.1.0",
      tag: "v0.1.0",
      commit: "abc123",
      signingMode: "skip",
      platformLock: {
        sha256: "a".repeat(64),
        modules: [{ id: "organizer", version: "0.2.2", artifactSha256: "b".repeat(64) }],
      },
      source: {
        repository: "https://github.com/pgw10086/hermit-desktop.git",
        tag: "v0.1.0",
        commit: "abc123",
        productManifestSha256: "c".repeat(64),
        pnpmLockSha256: "d".repeat(64),
        platformLockSha256: "a".repeat(64),
      },
      build: {
        workflowRunId: "42",
        workflowRunAttempt: "1",
        runner: "macos-14",
        node: "v24.19.0",
      },
      generatedAt: "2026-09-01T00:00:00.000Z",
    });
    assert.equal(result.manifest.schemaVersion, 2);
    assert.equal(result.manifest.artifact.name, "Hermit-0.1.0-arm64.dmg");
    assert.equal(result.manifest.steps.build, "PASS");
    assert.equal(result.manifest.steps.signing, "SKIPPED");
    assert.equal(result.manifest.steps.notarization, "SKIPPED");
    assert.equal(result.manifest.platformLock.sha256, "a".repeat(64));
    assert.equal(result.manifest.platformLock.modules[0].id, "organizer");
    assert.equal(result.manifest.source.repository, "https://github.com/pgw10086/hermit-desktop.git");
    assert.equal(result.manifest.source.productManifestSha256, "c".repeat(64));
    assert.equal(result.manifest.build.workflowRunId, "42");
    assert.match(fs.readFileSync(result.checksumPath, "utf8"), /  Hermit-0\.1\.0-arm64\.dmg\n$/u);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("发布附件拒绝和版本不一致的 DMG 文件名", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hermit-release-assets-"));
  try {
    const dmgPath = path.join(root, "Hermit-wrong-arm64.dmg");
    fs.writeFileSync(dmgPath, "release-dmg", "utf8");
    assert.throws(
      () => writeMacReleaseAssets({
        dmgPath,
        outputDirectory: path.join(root, "out"),
        version: "0.1.0",
        tag: "v0.1.0",
        commit: "abc123",
        signingMode: "required",
        platformLock: { sha256: "a".repeat(64), modules: [] },
      }),
      /Expected Hermit-0\.1\.0-arm64\.dmg/u,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function git(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}
