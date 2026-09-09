import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { updatePlatformLock } from "./update-platform-lock.mjs";

test("已发布 package manifest 更新锁、内容寻址制品和来源身份", () => {
  const root = createFixture();
  try {
    const result = updatePlatformLock({
      repositoryRoot: root,
      moduleId: "demo",
      manifestPath: path.join(root, "incoming", "package-manifest.json"),
      artifactPath: path.join(root, "incoming", "demo-1.2.3.tgz"),
      syncProjections: false,
    });
    const lock = JSON.parse(fs.readFileSync(path.join(root, "platform-lock.json"), "utf8"));
    const module = lock.modules[0];
    assert.equal(result.version, "1.2.3");
    assert.equal(module.version, "1.2.3");
    assert.equal(module.sourceCommit, "a".repeat(40));
    assert.equal(module.lockfileSha256, "b".repeat(64));
    assert.equal(module.artifact.sha256, result.artifactSha256);
    assert.equal(fs.existsSync(path.join(root, module.artifact.path)), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("平台锁更新拒绝错误的 tarball 摘要和 package 身份", () => {
  const root = createFixture();
  try {
    const manifestPath = path.join(root, "incoming", "package-manifest.json");
    const artifactPath = path.join(root, "incoming", "demo-1.2.3.tgz");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    manifest.artifact.sha256 = "c".repeat(64);
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));
    assert.throws(
      () => updatePlatformLock({ repositoryRoot: root, moduleId: "demo", manifestPath, artifactPath, syncProjections: false }),
      /Package artifact SHA mismatch/u,
    );

    manifest.artifact.sha256 = sha256File(artifactPath);
    manifest.package.name = "@other/demo";
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));
    assert.throws(
      () => updatePlatformLock({ repositoryRoot: root, moduleId: "demo", manifestPath, artifactPath, syncProjections: false }),
      /Package name mismatch/u,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hermit-platform-lock-update-"));
  fs.mkdirSync(path.join(root, "incoming"), { recursive: true });
  fs.mkdirSync(path.join(root, "package", "package"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "package", "package", "package.json"),
    JSON.stringify({ name: "@example/demo", version: "1.2.3" }),
  );
  const artifactPath = path.join(root, "incoming", "demo-1.2.3.tgz");
  execFileSync("tar", ["-czf", artifactPath, "package"], { cwd: path.join(root, "package") });
  const lock = {
    schemaVersion: 1,
    kind: "platform-lock",
    product: {},
    modules: [{
      id: "demo",
      role: "product-plugin",
      packageName: "@example/demo",
      version: "1.0.0",
      repository: "https://github.com/example/demo.git",
      sourceCommit: "d".repeat(40),
      lockfileSha256: "e".repeat(64),
      artifact: { type: "npm-tgz", path: "vendor/platform/demo/" + "e".repeat(64) + ".tgz", sha256: "e".repeat(64) },
      build: { contract: "node-package-v1" },
    }],
  };
  fs.writeFileSync(path.join(root, "platform-lock.json"), JSON.stringify(lock, null, 2));
  const manifest = {
    schemaVersion: 1,
    package: { name: "@example/demo", version: "1.2.3" },
    source: {
      repository: "https://github.com/example/demo.git",
      tag: "v1.2.3",
      commit: "a".repeat(40),
      sourceLockfileSha256: "b".repeat(64),
    },
    artifact: {
      name: "demo-1.2.3.tgz",
      sha256: sha256File(artifactPath),
    },
  };
  fs.writeFileSync(path.join(root, "incoming", "package-manifest.json"), JSON.stringify(manifest, null, 2));
  return root;
}

function sha256File(file) {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}
