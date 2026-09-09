import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { writeWindowsReleaseAssets } from "./prepare-windows-release-assets.mjs";

test("Windows 发布附件记录 manifest、SHA 和 signing 状态", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hermit-windows-release-assets-"));
  try {
    const exe = path.join(root, "Hermit-0.2.2-x64.exe");
    fs.writeFileSync(exe, "release-exe");
    const result = writeWindowsReleaseAssets({
      exePath: exe,
      outputDirectory: path.join(root, "out"),
      version: "0.2.2",
      tag: "v0.2.2",
      commit: "a".repeat(40),
      signingMode: "required",
      platformLock: { sha256: "b".repeat(64), modules: [] },
      source: { repository: "https://github.com/pgw10086/hermit-desktop.git" },
      build: { runner: "windows-2022" },
    });
    assert.equal(result.manifest.schemaVersion, 2);
    assert.equal(result.manifest.target.platform, "win32");
    assert.equal(result.manifest.artifact.name, "Hermit-0.2.2-x64.exe");
    assert.equal(result.manifest.steps.signing, "PASS");
    assert.match(fs.readFileSync(result.checksumPath, "utf8"), /Hermit-0\.2\.2-x64\.exe\n$/u);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
