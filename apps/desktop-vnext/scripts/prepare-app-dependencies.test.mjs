import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { prepareAppDependencies } from "./prepare-app-dependencies.mjs";
import { verifyPackagedAppDependencies } from "./verify-packaged-app-dependencies.mjs";

test("物化当前 frozen install 的 Core/Adapter 并清掉旧 scope", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hermit-app-dependencies-"));
  try {
    const desktopRoot = path.join(root, "desktop");
    const packageRoots = new Map();
    fs.mkdirSync(desktopRoot, { recursive: true });
    fs.writeFileSync(path.join(desktopRoot, "package.json"), JSON.stringify({ dependencies: {
      "@tianbuyv/agent-desktop-core": "0.1.1",
      "@tianbuyv/dsh-runtime-adapter": "0.1.1",
    }}));
    for (const name of ["@tianbuyv/agent-desktop-core", "@tianbuyv/dsh-runtime-adapter"]) {
      const packageRoot = path.join(root, "sources", ...name.split("/"));
      fs.mkdirSync(path.join(packageRoot, "lib"), { recursive: true });
      fs.writeFileSync(path.join(packageRoot, "package.json"), JSON.stringify({ name, version: "0.1.1" }));
      fs.writeFileSync(path.join(packageRoot, "LICENSE"), "license");
      fs.writeFileSync(path.join(packageRoot, "README.md"), "readme");
      fs.writeFileSync(path.join(packageRoot, "lib", "index.js"), "export {};");
      packageRoots.set(name, packageRoot);
    }
    const outputRoot = path.join(root, ".hermit", "runtime", "app-dependencies");
    fs.mkdirSync(path.join(outputRoot, "node_modules", "@platform"), { recursive: true });
    fs.writeFileSync(path.join(outputRoot, "node_modules", "@platform", "stale.js"), "stale");
    const result = prepareAppDependencies({
      desktopRoot,
      outputRoot,
      resolvePackageRoot: (name) => packageRoots.get(name),
    });
    assert.equal(result.packages.length, 2);
    assert.equal(fs.existsSync(path.join(outputRoot, "node_modules", "@platform")), false);
    for (const name of packageRoots.keys()) {
      assert.equal(fs.existsSync(path.join(outputRoot, "node_modules", ...name.split("/"), "lib", "index.js")), true);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("版本与 Desktop 声明不一致时拒绝 staging", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hermit-app-dependencies-"));
  try {
    const desktopRoot = path.join(root, "desktop");
    const sourceRoot = path.join(root, "source");
    fs.mkdirSync(path.join(desktopRoot), { recursive: true });
    fs.mkdirSync(path.join(sourceRoot, "lib"), { recursive: true });
    fs.writeFileSync(path.join(desktopRoot, "package.json"), JSON.stringify({ dependencies: {
      "@tianbuyv/agent-desktop-core": "0.1.1",
      "@tianbuyv/dsh-runtime-adapter": "0.1.1",
    }}));
    fs.writeFileSync(path.join(sourceRoot, "package.json"), JSON.stringify({ name: "@tianbuyv/agent-desktop-core", version: "0.1.2" }));
    assert.throws(
      () => prepareAppDependencies({
        desktopRoot,
        outputRoot: path.join(root, "out"),
        packageNames: ["@tianbuyv/agent-desktop-core"],
        resolvePackageRoot: () => sourceRoot,
      }),
      /version mismatch/u,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("asar 缺少主进程依赖时明确失败", () => {
  const fakeAsar = path.join(os.tmpdir(), `hermit-asar-${process.pid}.asar`);
  fs.writeFileSync(fakeAsar, "placeholder");
  const listing = path.join(os.tmpdir(), `hermit-asar-list-${process.pid}.txt`);
  fs.writeFileSync(listing, "node_modules/@tianbuyv/agent-desktop-core/package.json\n");
  try {
    assert.throws(
      () => verifyPackagedAppDependencies({
        appAsar: fakeAsar,
        asarCli: "/tmp/fake-asar.js",
        run: () => fs.readFileSync(listing, "utf8"),
      }),
      /app\.asar is missing first-party dependency/u,
    );
  } finally {
    fs.rmSync(fakeAsar, { force: true });
    fs.rmSync(listing, { force: true });
  }
});
