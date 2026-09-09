import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { bundledGenerationRoot, defaultResourcesPath } from "../scripts/runtime-paths.mjs";

const appRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const repositoryRoot = path.resolve(appRoot, "..", "..");

test("打包 runtime 验证按平台和架构推导默认资源目录", () => {
  const root = path.resolve("/tmp/hermit-desktop");
  assert.equal(
    defaultResourcesPath(root, "win32", "x64"),
    path.join(root, "dist", "win-unpacked", "resources"),
  );
  assert.equal(
    defaultResourcesPath(root, "darwin", "arm64"),
    path.join(root, "dist", "mac-arm64", "Hermit.app", "Contents", "Resources"),
  );
  assert.equal(
    defaultResourcesPath(root, "darwin", "x64"),
    path.join(root, "dist", "mac", "Hermit.app", "Contents", "Resources"),
  );
  assert.equal(
    defaultResourcesPath(root, "linux", "x64"),
    path.join(root, "dist", "linux-unpacked", "resources"),
  );
});

test("打包 runtime 位于可切换 generation 根下", () => {
  assert.equal(
    bundledGenerationRoot(path.resolve("/tmp/resources")),
    path.resolve("/tmp/resources/runtime/generations/bundled"),
  );
});

test("DSH runtime bundle manifest 明确列出每个随包 package 和构建哈希范围", () => {
  const manifest = JSON.parse(fs.readFileSync(
    path.join(appRoot, "runtime-bundle-manifest.json"),
    "utf8",
  ));
  const platformLock = JSON.parse(fs.readFileSync(
    path.join(repositoryRoot, "platform-lock.json"),
    "utf8",
  ));
  const modulesById = new Map(platformLock.modules.map((module) => [module.id, module]));
  assert.equal(manifest.schemaVersion, 3);
  assert.equal(
    new Set(manifest.bundledPackages.map(({ moduleId }) => moduleId)).size,
    manifest.bundledPackages.length,
  );
  for (const spec of [manifest.productSurfacePackage]) {
    const source = path.resolve(repositoryRoot, spec.source);
    assert.equal(source.startsWith(`${repositoryRoot}${path.sep}`), true);
    const packageJson = JSON.parse(fs.readFileSync(path.join(source, "package.json"), "utf8"));
    assert.equal(packageJson.name, spec.packageName);
    assert.equal(spec.hashPaths.includes("package.json"), true);
    assert.equal(spec.hashPaths.includes("lib"), true);
    for (const relativePath of spec.hashPaths) {
      assert.equal(fs.existsSync(path.join(source, relativePath)), true);
    }
  }
  for (const spec of manifest.bundledPackages) {
    const lockedModule = modulesById.get(spec.moduleId);
    assert.notEqual(lockedModule, undefined);
    assert.equal(lockedModule.role, "product-plugin");
    assert.match(lockedModule.repository, /^https:\/\/github\.com\/pgw10086\/[^/]+\.git$/u);
    assert.match(lockedModule.sourceCommit, /^[a-f0-9]{40}$/u);
    const source = path.resolve(repositoryRoot, spec.source);
    const packageJson = JSON.parse(fs.readFileSync(path.join(source, "package.json"), "utf8"));
    assert.equal(packageJson.name, lockedModule.packageName);
    assert.equal(spec.hashPaths.includes("package.json"), true);
    assert.equal(spec.hashPaths.includes("lib"), true);
    const artifact = path.resolve(repositoryRoot, lockedModule.artifact.path);
    assert.equal(artifact.startsWith(`${repositoryRoot}${path.sep}`), true);
    assert.equal(fs.existsSync(artifact), true);
    assert.equal(
      createHash("sha256").update(fs.readFileSync(artifact)).digest("hex"),
      lockedModule.artifact.sha256,
    );
    for (const field of ["packageName", "repository", "sourceCommit", "artifact", "artifactSha256"]) {
      assert.equal(spec[field], undefined);
    }
  }
});

test("Electron 主进程 host 包从已准备的 DSH runtime 闭包取同一份制品", () => {
  const builder = fs.readFileSync(path.join(appRoot, "electron-builder.yml"), "utf8");
  assert.match(builder, /from: \.\.\/\.\.\/\.hermit\/runtime\/app-dependencies\/node_modules\/@platform\/agent-desktop-core/u);
  assert.match(builder, /from: \.\.\/\.\.\/\.hermit\/runtime\/app-dependencies\/node_modules\/@platform\/dsh-runtime-adapter/u);
  assert.match(builder, /from: \.\.\/\.\.\/\.hermit\/runtime\/dsh\/node_modules\/@hermit\/smart-clipboard/u);
  assert.match(builder, /from: \.\.\/\.\.\/\.hermit\/runtime\/dsh\/node_modules\/@hermit\/organizer/u);
  assert.doesNotMatch(builder, /from: \.\.\/\.\.\/plugins\/(?:smart-clipboard|organizer)/u);
});

test("桌面打包使用已确认的 Hermit App Icon 资产", () => {
  const builder = fs.readFileSync(path.join(appRoot, "electron-builder.yml"), "utf8");
  assert.match(builder, /icon: build\/icon\.icns/u);
  assert.match(builder, /icon: assets\/brand\/hermit\/previews\/hermit-app-icon-256\.png/u);
  assert.equal(
    fs.existsSync(path.join(appRoot, "build", "icon.icns")),
    true,
  );
  assert.equal(
    fs.existsSync(path.join(appRoot, "assets", "brand", "hermit", "previews", "hermit-app-icon-256.png")),
    true,
  );
});
