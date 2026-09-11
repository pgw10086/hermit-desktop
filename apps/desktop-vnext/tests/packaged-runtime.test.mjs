import assert from "node:assert/strict";
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
  assert.equal(manifest.schemaVersion, 4);
  assert.equal(
    new Set(manifest.bundledPackages.map(({ packageName }) => packageName)).size,
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
    const source = path.resolve(repositoryRoot, spec.source);
    const packageJson = JSON.parse(fs.readFileSync(path.join(source, "package.json"), "utf8"));
    assert.equal(packageJson.name, spec.packageName);
    assert.equal(spec.hashPaths.includes("package.json"), true);
    assert.equal(spec.hashPaths.includes("lib"), true);
  }
});

test("Electron 主进程 host 包从已准备的 DSH runtime 闭包取同一份制品", () => {
  const builder = fs.readFileSync(path.join(appRoot, "electron-builder.yml"), "utf8");
  assert.match(builder, /from: \.\.\/\.\.\/\.hermit\/runtime\/app-dependencies\/node_modules\/@tianbuyv\/agent-desktop-core/u);
  assert.match(builder, /from: \.\.\/\.\.\/\.hermit\/runtime\/app-dependencies\/node_modules\/@tianbuyv\/dsh-runtime-adapter/u);
  assert.match(builder, /from: \.\.\/\.\.\/\.hermit\/runtime\/dsh\/node_modules\/@tianbuyv\/smart-clipboard/u);
  assert.match(builder, /from: \.\.\/\.\.\/\.hermit\/runtime\/dsh\/node_modules\/@tianbuyv\/organizer/u);
  assert.doesNotMatch(builder, /from: \.\.\/\.\.\/plugins\/(?:smart-clipboard|organizer)/u);
});

test("桌面打包使用已确认的 Hermit App Icon 资产", () => {
  const builder = fs.readFileSync(path.join(appRoot, "electron-builder.yml"), "utf8");
  assert.match(builder, /icon: build\/icon\.icns/u);
  assert.match(builder, /icon: \.\.\/\.\.\/\.hermit\/artifacts\/windows-app-icon\.ico/u);
  assert.equal(
    fs.existsSync(path.join(appRoot, "build", "icon.icns")),
    true,
  );
  assert.equal(
    fs.existsSync(path.join(appRoot, "assets", "brand", "hermit", "previews", "hermit-app-icon-256.png")),
    true,
  );
  assert.equal(fs.existsSync(path.join(appRoot, "scripts", "prepare-windows-icon.mjs")), true);
});
