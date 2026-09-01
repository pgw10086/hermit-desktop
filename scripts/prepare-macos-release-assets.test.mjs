import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { writeMacReleaseAssets } from "./prepare-macos-release-assets.mjs";

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
      generatedAt: "2026-09-01T00:00:00.000Z",
    });
    assert.equal(result.manifest.artifact.name, "Hermit-0.1.0-arm64.dmg");
    assert.equal(result.manifest.steps.build, "PASS");
    assert.equal(result.manifest.steps.signing, "SKIPPED");
    assert.equal(result.manifest.steps.notarization, "SKIPPED");
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
      }),
      /Expected Hermit-0\.1\.0-arm64\.dmg/u,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
