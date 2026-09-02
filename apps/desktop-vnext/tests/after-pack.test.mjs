import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  assertNativePackContext,
  copyRuntimeClosure,
  installProductSurfacePatch,
  validateMacosClipboardBridge,
  validateMacosDynamicDependencies,
  validateProductSurfacePatch,
  validateRuntimeClosure,
} from "../scripts/after-pack.mjs";
import {
  foregroundSessionNavigationPatch,
  installForegroundSessionNavigationPatch,
  validateForegroundSessionNavigationPatch,
} from "../scripts/dsh-foreground-session-navigation-patch.mjs";

test("macOS Clipboard bridge dependency gate ignores the inspected file header and only accepts system libraries", () => {
  assert.doesNotThrow(() => validateMacosDynamicDependencies(`/Users/developer/project/bridge.node:
\t/System/Library/Frameworks/AppKit.framework/Versions/C/AppKit (compatibility version 45.0.0, current version 1.0.0)
\t/usr/lib/libc++.1.dylib (compatibility version 1.0.0, current version 1.0.0)
`));
  assert.throws(() => validateMacosDynamicDependencies(`/tmp/bridge.node:
\t/Users/developer/project/node_modules/libfixture.dylib (compatibility version 1.0.0, current version 1.0.0)
`), /unapproved dynamic dependency/u);
});

test("macOS Clipboard bridge gate validates the staged pre-sign digest", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hermit-macos-clipboard-"));
  try {
    const addon = path.join(root, "bridge.node");
    const manifest = path.join(root, "manifest.json");
    fs.writeFileSync(addon, "fixture native bytes");
    const digest = createHash("sha256").update(fs.readFileSync(addon)).digest("hex");
    fs.writeFileSync(manifest, JSON.stringify({ schemaVersion: 1, electronVersion: "43.4.0", napiVersion: 8, architecture: "arm64", sha256: digest }));
    assert.deepEqual(validateMacosClipboardBridge(manifest, addon), {
      electronVersion: "43.4.0", napiVersion: 8, architecture: "arm64", preSignSha256: digest,
    });
    fs.appendFileSync(addon, "changed");
    assert.throws(() => validateMacosClipboardBridge(manifest, addon), /digest/u);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("afterPack 保留标准 node_modules 拓扑并拒绝 modules 别名", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hermit-after-pack-"));
  const source = path.join(root, "source");
  const target = path.join(root, "target");
  const dsh = path.join(source, "node_modules", "@deepseek-ai", "dsh");
  const pnpm = path.join(source, "node_modules", "pnpm");
  fs.mkdirSync(path.join(source, "node_modules", ".pnpm"), { recursive: true });
  fs.mkdirSync(path.join(source, "node_modules", ".bin"), { recursive: true });
  fs.mkdirSync(dsh, { recursive: true });
  fs.mkdirSync(path.join(pnpm, "bin"), { recursive: true });
  fs.writeFileSync(path.join(source, "package.json"), "{}\n");
  fs.writeFileSync(
    path.join(dsh, "package.json"),
    JSON.stringify({ bin: { dsh: "lib/bin.js" } }),
  );
  fs.mkdirSync(path.join(dsh, "lib"));
  fs.writeFileSync(path.join(dsh, "lib", "bin.js"), "console.log('ok');\n");
  fs.writeFileSync(
    path.join(pnpm, "package.json"),
    JSON.stringify({ bin: { pnpm: "bin/pnpm.cjs" } }),
  );
  fs.writeFileSync(path.join(pnpm, "bin", "pnpm.cjs"), "console.log('11.7.0');\n");
  const pnpmShim = path.join(
    source,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "pnpm.CMD" : "pnpm",
  );
  if (process.platform === "win32") fs.writeFileSync(pnpmShim, "pnpm shim\n");
  else fs.symlinkSync(path.join("..", "pnpm", "bin", "pnpm.cjs"), pnpmShim);

  copyRuntimeClosure(source, target);
  assert.equal(
    fs.existsSync(path.join(target, "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js")),
    true,
  );
  assert.equal(fs.existsSync(path.join(target, "modules")), false);
  if (process.platform !== "win32") {
    assert.equal(fs.lstatSync(path.join(target, "node_modules", ".bin", "pnpm")).isSymbolicLink(), true);
  }
  assert.deepEqual(validateRuntimeClosure(target), {
    entry: path.join(target, "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js"),
    pnpmEntry: path.join(target, "node_modules", "pnpm", "bin", "pnpm.cjs"),
  });
  fs.rmSync(root, { recursive: true, force: true });
});

test("afterPack 拒绝把主机 runtime 塞进其他平台产物", () => {
  assert.doesNotThrow(() => assertNativePackContext("darwin", "darwin"));
  assert.throws(
    () => assertNativePackContext("win32", "darwin"),
    /cross-platform runtime/u,
  );
});

test("Hermit layout and Desktop Surface gate validates the pinned patch and client digest", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hermit-product-surface-"));
  try {
    const layout = path.join(root, "node_modules", "@deepseek-ai", "dsh-client-ui-layout");
    const webApp = path.join(root, "node_modules", "@deepseek-ai", "dsh-web-app");
    const stockLayout = path.join(webApp, "node_modules", "@deepseek-ai", "dsh-client-ui-layout");
    fs.mkdirSync(path.join(layout, "lib"), { recursive: true });
    fs.mkdirSync(path.join(stockLayout, "lib"), { recursive: true });
    fs.writeFileSync(path.join(root, "package.json"), "{}\n");
    fs.writeFileSync(path.join(layout, "LICENSE"), "MIT\n");
    fs.writeFileSync(path.join(webApp, "package.json"), JSON.stringify({ name: "@deepseek-ai/dsh-web-app" }));
    fs.writeFileSync(path.join(layout, "package.json"), JSON.stringify({
      name: "@deepseek-ai/dsh-client-ui-layout",
      version: "0.1.1-rc.2",
      hermitPatch: {
        contractVersion: 6,
        name: "product-navigation-shortcut-center-desktop-surface-and-primary-workspace",
        upstreamTag: "dsh-v0.1.1-rc.2",
        upstreamCommit: "b150a551b8d465e31e418e1b2eaf5e79bbb7d28e",
      },
    }));
    fs.writeFileSync(path.join(layout, "lib", "client.js"), "product.surface openProductSurface registerProductEntry shortcut-center getDesktopSurfaceClient getDesktopDeadlineClient getDesktopNotificationClient\n");
    fs.writeFileSync(path.join(stockLayout, "package.json"), JSON.stringify({
      name: "@deepseek-ai/dsh-client-ui-layout",
      version: "0.1.1-rc.2",
    }));
    fs.writeFileSync(path.join(stockLayout, "lib", "client.js"), "stock layout\n");

    installProductSurfacePatch(root);
    const result = validateProductSurfacePatch(root);
    assert.equal(result.packageVersion, "0.1.1-rc.2");
    assert.equal(result.contractVersion, 6);
    assert.equal(result.clientSha256.length, 64);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("DSH foreground navigation patches are precise and idempotent", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hermit-foreground-navigation-"));
  try {
    const workspace = path.join(
      root,
      "node_modules",
      "@deepseek-ai",
      "dsh-client-ui-workspace",
    );
    fs.mkdirSync(path.join(workspace, "lib"), { recursive: true });
    fs.writeFileSync(path.join(workspace, "package.json"), JSON.stringify({
      name: "@deepseek-ai/dsh-client-ui-workspace",
      version: "0.1.1-rc.2",
    }));
    fs.writeFileSync(path.join(workspace, "lib", "client.js"), [
      "const browserInjected = () => ({",
      "  startSession: (workspaceId) => {",
      "    ctx.workspaces.startSession(workspaceId);",
      "  },",
      "  open: (sessionId) => {",
      "    ctx.sessions.open(sessionId);",
      "  },",
      "  forkSession: (sessionId) => {",
      "    ctx.sessions.fork({ sessionId }).then((childId) => {",
      "      ctx.sessions.open(childId);",
      "    });",
      "  },",
      "});",
      "",
    ].join("\n"));
    const sidebar = path.join(
      root,
      "node_modules",
      "@deepseek-ai",
      "dsh-client-ui-sidebar",
    );
    fs.mkdirSync(path.join(sidebar, "lib"), { recursive: true });
    fs.writeFileSync(path.join(sidebar, "package.json"), JSON.stringify({
      name: "@deepseek-ai/dsh-client-ui-sidebar",
      version: "0.1.1-rc.2",
    }));
    fs.writeFileSync(path.join(sidebar, "lib", "client.js"), [
      "const sidebarInjected = {",
      "  startSession: (workspaceId) => {",
      "    ctx.workspaces.startSession(workspaceId);",
      "  },",
      "};",
      "",
    ].join("\n"));

    const first = installForegroundSessionNavigationPatch(root);
    const second = installForegroundSessionNavigationPatch(root);
    const workspaceClient = fs.readFileSync(path.join(workspace, "lib", "client.js"), "utf8");
    const sidebarClient = fs.readFileSync(path.join(sidebar, "lib", "client.js"), "utf8");
    assert.deepEqual(first, second);
    assert.deepEqual(
      {
        ...first,
        packages: first.packages.map(({ clientSha256: _clientSha256, ...entry }) => entry),
      },
      foregroundSessionNavigationPatch,
    );
    assert.equal(workspaceClient.split('ctx.get("layout")?.closeProductSurface();').length - 1, 3);
    assert.equal(sidebarClient.split('ctx.get("layout")?.closeProductSurface();').length - 1, 1);
    assert.equal(validateForegroundSessionNavigationPatch(root).packages.every((entry) => entry.clientSha256.length === 64), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("DSH Workspace foreground navigation patch rejects a stale source anchor", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hermit-foreground-navigation-stale-"));
  try {
    const workspace = path.join(
      root,
      "node_modules",
      "@deepseek-ai",
      "dsh-client-ui-workspace",
    );
    fs.mkdirSync(path.join(workspace, "lib"), { recursive: true });
    fs.writeFileSync(path.join(workspace, "package.json"), JSON.stringify({
      name: "@deepseek-ai/dsh-client-ui-workspace",
      version: "0.1.1-rc.2",
    }));
    fs.writeFileSync(path.join(workspace, "lib", "client.js"), "const stale = true;\n");
    assert.throws(
      () => installForegroundSessionNavigationPatch(root),
      /patch anchor must match once/u,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("afterPack 拒绝静默丢弃 runtime 中的 dangling link", {
  skip: process.platform === "win32" ? "Windows symlink permission is environment-dependent" : false,
}, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hermit-after-pack-dangling-"));
  try {
    const dsh = path.join(root, "node_modules", "@deepseek-ai", "dsh");
    fs.mkdirSync(path.join(root, "node_modules", ".pnpm"), { recursive: true });
    fs.mkdirSync(path.join(root, "node_modules", ".bin"), { recursive: true });
    fs.mkdirSync(path.join(dsh, "lib"), { recursive: true });
    const pnpm = path.join(root, "node_modules", "pnpm");
    fs.mkdirSync(path.join(pnpm, "bin"), { recursive: true });
    fs.writeFileSync(
      path.join(dsh, "package.json"),
      JSON.stringify({ bin: { dsh: "lib/bin.js" } }),
    );
    fs.writeFileSync(path.join(dsh, "lib", "bin.js"), "");
    fs.writeFileSync(
      path.join(pnpm, "package.json"),
      JSON.stringify({ bin: { pnpm: "bin/pnpm.cjs" } }),
    );
    fs.writeFileSync(path.join(pnpm, "bin", "pnpm.cjs"), "");
    fs.writeFileSync(
      path.join(root, "node_modules", ".bin", process.platform === "win32" ? "pnpm.CMD" : "pnpm"),
      "pnpm shim\n",
    );
    fs.symlinkSync(path.join(root, "missing-target"), path.join(root, "node_modules", ".bin", "missing"));
    assert.throws(
      () => validateRuntimeClosure(root, { allowLinks: true }),
      /dangling link/u,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
