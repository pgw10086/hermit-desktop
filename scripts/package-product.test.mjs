import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createProductPackagePlan,
  writeProductBuildManifest,
} from "./package-product.mjs";

test("dev 先恢复锁定依赖，再测试、生成目录包并验证 runtime", () => {
  const plan = createProductPackagePlan({ profile: "dev", platform: "darwin", architecture: "arm64" });
  assert.deepEqual(plan.steps.map(({ id }) => id), [
    "platform-inputs",
    "desktop-tests",
    "desktop-package",
    "packaged-runtime",
  ]);
  assert.deepEqual(plan.steps[0].args.slice(-2), ["dev", "--build-on-miss"]);
});

test("candidate 使用正式制品完成产品资格后生成未签名 DMG", () => {
  const plan = createProductPackagePlan({ profile: "candidate", platform: "darwin", architecture: "arm64" });
  assert.deepEqual(plan.steps.map(({ id }) => id), [
    "platform-inputs",
    "project-tests",
    "runtime",
    "native-tests",
    "organizer-surface",
    "file-workspace-surface",
    "smart-clipboard-surface",
    "desktop-package",
    "smart-clipboard-packaged-ui",
    "mac-candidate",
  ]);
  assert.equal(plan.steps.some(({ id }) => id === "release-assets"), false);
});

test("Windows x64 candidate 使用 Windows 打包入口且不执行 macOS native bridge 测试", () => {
  const plan = createProductPackagePlan({ profile: "candidate", platform: "win32", architecture: "x64" });
  assert.deepEqual(plan.steps.map(({ id }) => id), [
    "platform-inputs",
    "project-tests",
    "runtime",
    "organizer-surface",
    "file-workspace-surface",
    "smart-clipboard-surface",
    "desktop-package",
    "smart-clipboard-packaged-ui",
    "win-candidate",
  ]);
  assert.equal(plan.steps.at(-1).args.at(-1), "dist:desktop:win:smoke");
});

test("release 必须显式选择签名策略，并在所有构建前检查源码和 tag", () => {
  assert.throws(
    () => createProductPackagePlan({ profile: "release", platform: "darwin", architecture: "arm64" }),
    /--signing must be skip or required/u,
  );
  const plan = createProductPackagePlan({
    profile: "release",
    signingMode: "skip",
    platform: "darwin",
    architecture: "arm64",
  });
  assert.equal(plan.steps[0].id, "release-source");
  assert.equal(plan.steps.at(-2).id, "mac-release");
  assert.equal(plan.steps.at(-1).id, "release-assets");
  assert.equal(plan.steps.at(-2).environment.HERMIT_MAC_RELEASE_SIGNING, "skip");
  assert.equal(plan.steps.at(-1).environment.HERMIT_MAC_RELEASE_SIGNING, "skip");
});

test("Windows x64 release 使用 Windows 签名环境和 EXE 发布附件入口", () => {
  const plan = createProductPackagePlan({
    profile: "release",
    signingMode: "required",
    platform: "win32",
    architecture: "x64",
  });
  assert.equal(plan.steps[0].args[0], "scripts/prepare-windows-release-assets.mjs");
  assert.equal(plan.steps.at(-2).id, "win-release");
  assert.equal(plan.steps.at(-2).args.at(-1), "dist:desktop:win");
  assert.equal(plan.steps.at(-2).environment.HERMIT_WINDOWS_RELEASE_SIGNING, "required");
  assert.equal(plan.steps.at(-1).id, "release-assets");
  assert.equal(plan.steps.at(-1).environment.HERMIT_WINDOWS_RELEASE_SIGNING, "required");
});

test("构建清单记录平台锁、模块来源、步骤和最终文件摘要", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hermit-product-package-"));
  try {
    fs.writeFileSync(path.join(root, "platform-lock.json"), `${JSON.stringify({
      schemaVersion: 1,
      kind: "platform-lock",
      product: { id: "hermit", version: "0.2.2" },
      modules: [{
        id: "organizer",
        packageName: "@hermit/organizer",
        version: "0.2.2",
        sourceCommit: "1e4b0c69ec4b6b7afae37f0c614bb19309b053f2",
        artifact: { sha256: "17bf9d1bcbeaed23fca6a7450856f95681942f01400d5770c07c7f17e8dd033c" },
      }],
    }, null, 2)}\n`);
    const outputPath = path.join(root, "Hermit-0.2.2-arm64.dmg");
    fs.writeFileSync(outputPath, "abc");
    const result = writeProductBuildManifest({
      repositoryRoot: root,
      profile: "candidate",
      signingMode: "skip",
      target: { platform: "darwin", architecture: "arm64" },
      source: { commit: "abc123", dirty: true },
      startedAt: "2026-09-08T00:00:00.000Z",
      finishedAt: "2026-09-08T00:00:02.000Z",
      steps: [{ id: "mac-candidate", status: "PASS", durationMs: 2_000 }],
      outputPath,
    });
    assert.equal(result.manifest.result, "PASS");
    assert.equal(result.manifest.platformLock.modules[0].id, "organizer");
    assert.equal(result.manifest.output.sha256, "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    assert.equal(result.manifest.steps[0].status, "PASS");
    assert.equal(fs.existsSync(result.manifestPath), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
