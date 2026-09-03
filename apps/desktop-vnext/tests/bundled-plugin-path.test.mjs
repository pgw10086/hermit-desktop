import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { resolveBundledPluginPath } from "../lib/runtime/bundled-plugin-path.js";

const appPath = path.resolve(".");
const resourcesPath = path.join("/tmp", "hermit-resources");

test("开发环境的插件路径来自 runtime bundle manifest", () => {
  assert.equal(
    resolveBundledPluginPath({
      packageName: "@hermit/smart-clipboard",
      isPackaged: false,
      appPath,
      resourcesPath,
    }),
    path.resolve(appPath, "node_modules", "@hermit", "smart-clipboard"),
  );
});

test("打包环境的插件路径来自当前 generation 的 DSH 闭包", () => {
  assert.equal(
    resolveBundledPluginPath({
      packageName: "@hermit/organizer",
      isPackaged: true,
      appPath,
      resourcesPath,
      runtimeRoot: path.join(resourcesPath, "runtime", "generations", "bundled"),
    }),
    path.join(
      resourcesPath,
      "runtime",
      "generations",
      "bundled",
      "dsh",
      "node_modules",
      "@hermit",
      "organizer",
    ),
  );
});

test("插件 package name 不能通过路径片段逃逸", () => {
  assert.throws(
    () => resolveBundledPluginPath({
      packageName: "@hermit/../escape",
      isPackaged: true,
      appPath,
      resourcesPath,
    }),
    /package name 无效/u,
  );
});
