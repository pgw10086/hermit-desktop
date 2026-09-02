import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";
import { validateForegroundSessionNavigationPatch } from "./dsh-foreground-session-navigation-patch.mjs";
import { BUNDLED_GENERATION_ID, bundledGenerationRoot } from "./runtime-paths.mjs";

/** 返回受管 DSH runtime 的构建输入目录，避免打包脚本读取未声明路径。 */
export function runtimeSource(projectDir) {
  return path.resolve(projectDir, "..", "..", ".hermit", "runtime", "dsh");
}

/** 根据 electron-builder 输出目录计算 bundled generation 的安装位置。 */
export function runtimeTarget(packager, appOutDir) {
  return path.join(
    bundledGenerationRoot(packager.getResourcesDir(appOutDir)),
    "dsh",
  );
}

/** 拒绝跨平台打包；原生 runtime 和 native addon 必须在目标平台生成。 */
export function assertNativePackContext(targetPlatform, hostPlatform = process.platform) {
  if (targetPlatform !== hostPlatform) {
    throw new Error(
      `Hermit afterPack rejected a cross-platform runtime: host=${hostPlatform}, target=${targetPlatform}`,
    );
  }
}

/** 从 runtime closure 的 manifest 解析并校验 DSH CLI 入口。 */
export function resolveDshEntry(runtimeRoot) {
  const packageRoot = path.resolve(runtimeRoot, "node_modules", "@deepseek-ai", "dsh");
  const manifestPath = path.join(packageRoot, "package.json");
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Bundled DSH package manifest is missing: ${manifestPath}`);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const bin = typeof manifest.bin === "string" ? manifest.bin : manifest.bin?.dsh;
  if (typeof bin !== "string") throw new Error("Bundled DSH package has no dsh CLI entry");
  const entry = path.resolve(packageRoot, bin);
  if (!entry.startsWith(`${packageRoot}${path.sep}`) || !fs.existsSync(entry)) {
    throw new Error(`Bundled DSH CLI entry is missing: ${entry}`);
  }
  return entry;
}

/** 从 runtime closure 解析 pnpm 入口并确认 PATH shim 存在。 */
export function resolvePnpmEntry(runtimeRoot) {
  const packageRoot = path.resolve(runtimeRoot, "node_modules", "pnpm");
  const manifestPath = path.join(packageRoot, "package.json");
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Bundled pnpm package manifest is missing: ${manifestPath}`);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const bin = typeof manifest.bin === "string" ? manifest.bin : manifest.bin?.pnpm;
  if (typeof bin !== "string") throw new Error("Bundled pnpm package has no pnpm CLI entry");
  const entry = path.resolve(packageRoot, bin);
  if (!entry.startsWith(`${packageRoot}${path.sep}`) || !fs.existsSync(entry)) {
    throw new Error(`Bundled pnpm CLI entry is missing: ${entry}`);
  }
  const shim = path.join(
    runtimeRoot,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "pnpm.CMD" : "pnpm",
  );
  if (!fs.existsSync(shim)) {
    throw new Error(`Bundled pnpm PATH shim is missing: ${shim}`);
  }
  return entry;
}

function assertDirectory(directory, label) {
  if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) {
    throw new Error(`${label} is missing: ${directory}`);
  }
}

function assertPackagedLinks(root, baseRoot = root) {
  const canonicalBaseRoot = fs.realpathSync(baseRoot);
  const entries = fs.readdirSync(root, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isSymbolicLink()) {
      let resolved;
      try {
        resolved = fs.realpathSync(fullPath);
      } catch (error) {
        if (error?.code === "ENOENT") {
          throw new Error(`Packaged DSH closure contains a dangling link: ${fullPath}`);
        }
        throw error;
      }
      if (
        path.basename(path.dirname(fullPath)) !== ".bin" ||
        !resolved.startsWith(`${canonicalBaseRoot}${path.sep}`) ||
        !fs.statSync(resolved).isFile()
      ) {
        throw new Error(`Packaged DSH closure contains an unsafe link: ${fullPath} -> ${resolved}`);
      }
      continue;
    }
    if (entry.isDirectory()) assertPackagedLinks(fullPath, baseRoot);
  }
}

function assertLinksStayInside(root, baseRoot = root) {
  const canonicalBaseRoot = fs.realpathSync(baseRoot);
  const entries = fs.readdirSync(root, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isSymbolicLink()) {
      let resolved;
      try {
        resolved = fs.realpathSync(fullPath);
      } catch (error) {
        if (error?.code === "ENOENT") {
          throw new Error(`DSH closure contains a dangling link: ${fullPath}`);
        }
        throw error;
      }
      if (!resolved.startsWith(`${canonicalBaseRoot}${path.sep}`)) {
        throw new Error(`DSH closure link escapes its root: ${fullPath} -> ${resolved}`);
      }
      continue;
    }
    if (entry.isDirectory()) assertLinksStayInside(fullPath, baseRoot);
  }
}

/** 校验 runtime closure 的目录、链接和可执行入口是否满足打包边界。 */
export function validateRuntimeClosure(runtimeRoot, { allowLinks = false } = {}) {
  runtimeRoot = path.resolve(runtimeRoot);
  assertDirectory(runtimeRoot, "DSH runtime closure");
  const nodeModules = path.join(runtimeRoot, "node_modules");
  assertDirectory(nodeModules, "DSH node_modules");
  assertDirectory(path.join(nodeModules, ".pnpm"), "DSH pnpm virtual store");
  assertDirectory(path.join(nodeModules, ".bin"), "DSH bin directory");
  if (fs.existsSync(path.join(runtimeRoot, "modules"))) {
    throw new Error("DSH runtime closure must use the standard node_modules directory");
  }
  const entry = resolveDshEntry(runtimeRoot);
  const pnpmEntry = resolvePnpmEntry(runtimeRoot);
  if (allowLinks) assertLinksStayInside(runtimeRoot);
  else assertPackagedLinks(runtimeRoot);
  return { entry, pnpmEntry };
}

/** 校验所有 DSH consumer 解析到同一份 Hermit layout patch 制品。 */
export function validateProductSurfacePatch(runtimeRoot) {
  const nodeModules = path.join(path.resolve(runtimeRoot), "node_modules");
  const layoutManifestPath = path.join(
    nodeModules,
    "@deepseek-ai",
    "dsh-client-ui-layout",
    "package.json",
  );
  if (!fs.existsSync(layoutManifestPath)) {
    throw new Error(`Hermit Product Surface layout package is missing: ${layoutManifestPath}`);
  }
  const resolutionPaths = new Set([fs.realpathSync(layoutManifestPath)]);
  for (const consumer of [
    "dsh-web-app",
    "dsh-client-ui-sidebar",
    "dsh-client-ui-conversation",
  ]) {
    const consumerManifest = path.join(nodeModules, "@deepseek-ai", consumer, "package.json");
    if (!fs.existsSync(consumerManifest)) continue;
    const consumerRequire = createRequire(consumerManifest);
    resolutionPaths.add(fs.realpathSync(
      consumerRequire.resolve("@deepseek-ai/dsh-client-ui-layout/package.json"),
    ));
  }
  const qualifications = [...resolutionPaths].map(readProductSurfacePatch);
  const expected = JSON.stringify(qualifications[0]);
  if (qualifications.some((qualification) => JSON.stringify(qualification) !== expected)) {
    throw new Error("DSH runtime resolves Product Surface layout packages with different bytes");
  }
  return qualifications[0];
}

/** 校验 macOS Clipboard addon manifest、摘要、架构和动态依赖。 */
export function validateMacosClipboardBridge(manifestPath, addonPath, { inspectBinary = false } = {}) {
  if (!fs.existsSync(manifestPath) || !fs.existsSync(addonPath)) {
    throw new Error(`macOS Clipboard bridge package is incomplete: ${manifestPath}, ${addonPath}`);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (
    manifest.schemaVersion !== 1 ||
    typeof manifest.electronVersion !== "string" ||
    !manifest.electronVersion.startsWith("43.") ||
    manifest.napiVersion !== 8 ||
    manifest.architecture !== "arm64" ||
    !/^[a-f0-9]{64}$/u.test(manifest.sha256)
  ) {
    throw new Error("macOS Clipboard bridge manifest is invalid");
  }
  const digest = createHash("sha256").update(fs.readFileSync(addonPath)).digest("hex");
  if (digest !== manifest.sha256) throw new Error("macOS Clipboard bridge pre-sign digest does not match its manifest");
  if (inspectBinary) {
    const architectures = nativeOutput("/usr/bin/lipo", ["-archs", addonPath]).trim().split(/\s+/u);
    if (architectures.length !== 1 || architectures[0] !== "arm64") {
      throw new Error(`macOS Clipboard bridge must contain only arm64: ${architectures.join(", ")}`);
    }
    const dependencies = nativeOutput("/usr/bin/otool", ["-L", addonPath]);
    validateMacosDynamicDependencies(dependencies);
  }
  return {
    electronVersion: manifest.electronVersion,
    napiVersion: manifest.napiVersion,
    architecture: manifest.architecture,
    preSignSha256: manifest.sha256,
  };
}

/** 只允许系统框架和 /usr/lib 动态依赖进入 macOS native addon。 */
export function validateMacosDynamicDependencies(output) {
  const dependencies = output
    .split(/\r?\n/u)
    .slice(1)
    .map((line) => line.trim().split(/\s+\(compatibility version/u)[0])
    .filter(Boolean);
  const unapproved = dependencies.filter(
    (dependency) => !dependency.startsWith("/System/Library/") && !dependency.startsWith("/usr/lib/"),
  );
  if (unapproved.length > 0) {
    throw new Error(`macOS Clipboard bridge contains an unapproved dynamic dependency:\n${unapproved.join("\n")}`);
  }
}

function nativeOutput(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${String(result.status)}): ${result.stderr}`);
  return result.stdout;
}

/** 将已审计的 source patch 安装到 runtime closure，并保留可复核制品。 */
export function installProductSurfacePatch(runtimeRoot, sourcePackageRoot) {
  const nodeModules = path.join(path.resolve(runtimeRoot), "node_modules");
  const source = sourcePackageRoot === undefined
    ? path.join(nodeModules, "@deepseek-ai", "dsh-client-ui-layout")
    : path.resolve(sourcePackageRoot);
  readProductSurfacePatch(path.join(source, "package.json"));
  const targets = new Set([
    path.join(nodeModules, "@deepseek-ai", "dsh-client-ui-layout"),
  ]);
  for (const consumer of [
    "dsh-web-app",
    "dsh-client-ui-sidebar",
    "dsh-client-ui-conversation",
  ]) {
    const consumerManifest = path.join(nodeModules, "@deepseek-ai", consumer, "package.json");
    if (!fs.existsSync(consumerManifest)) continue;
    const consumerRequire = createRequire(consumerManifest);
    targets.add(path.dirname(
      consumerRequire.resolve("@deepseek-ai/dsh-client-ui-layout/package.json"),
    ));
  }
  const sourceRealPath = fs.realpathSync(source);
  for (const target of targets) {
    if (fs.realpathSync(target) === sourceRealPath) continue;
    fs.rmSync(target, { recursive: true, force: true });
    fs.mkdirSync(target, { recursive: true });
    for (const entry of ["LICENSE", "package.json", "lib"]) {
      fs.cpSync(
        path.join(sourceRealPath, entry),
        path.join(target, entry),
        { recursive: true, dereference: true },
      );
    }
  }
}

function readProductSurfacePatch(layoutManifestPath) {
  const manifest = JSON.parse(fs.readFileSync(layoutManifestPath, "utf8"));
  const patch = manifest.hermitPatch;
  if (
    manifest.version !== "0.1.1-rc.2" ||
    patch?.contractVersion !== 6 ||
    patch?.name !== "product-navigation-shortcut-center-desktop-surface-and-primary-workspace" ||
    patch?.upstreamTag !== "dsh-v0.1.1-rc.2" ||
    patch?.upstreamCommit !== "b150a551b8d465e31e418e1b2eaf5e79bbb7d28e"
  ) {
    throw new Error("Bundled DSH layout does not carry the approved Hermit layout and Desktop Surface patch");
  }
  const clientPath = path.join(path.dirname(layoutManifestPath), "lib", "client.js");
  const client = fs.readFileSync(clientPath);
  const clientText = client.toString("utf8");
  if (
    !clientText.includes("product.surface") ||
    !clientText.includes("openProductSurface") ||
    !clientText.includes("registerProductEntry") ||
    !clientText.includes("shortcut-center") ||
    !clientText.includes("getDesktopSurfaceClient") ||
    !clientText.includes("getDesktopDeadlineClient") ||
    !clientText.includes("getDesktopNotificationClient")
  ) {
    throw new Error("Hermit layout and Desktop Surface client bundle is stale or incomplete");
  }
  return {
    packageVersion: manifest.version,
    contractVersion: patch.contractVersion,
    upstreamCommit: patch.upstreamCommit,
    clientSha256: createHash("sha256").update(client).digest("hex"),
  };
}

function copyTree(source, target, root, activeDirectories = new Set()) {
  const stat = fs.lstatSync(source);
  if (stat.isSymbolicLink()) {
    let resolved;
    try {
      resolved = fs.realpathSync(source);
    } catch (error) {
      if (error?.code === "ENOENT") {
        throw new Error(`DSH closure contains a dangling link: ${source}`);
      }
      throw error;
    }
    if (!resolved.startsWith(`${root}${path.sep}`)) {
      throw new Error(`DSH closure link escapes its root: ${source} -> ${resolved}`);
    }
    if (path.basename(path.dirname(source)) === ".bin" && fs.statSync(resolved).isFile()) {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.symlinkSync(path.relative(path.dirname(source), resolved), target, "file");
      return;
    }
    copyTree(resolved, target, root, activeDirectories);
    return;
  }
  if (stat.isDirectory()) {
    const realDirectory = fs.realpathSync(source);
    if (activeDirectories.has(realDirectory)) {
      throw new Error(`DSH closure contains a directory link cycle: ${source}`);
    }
    activeDirectories.add(realDirectory);
    fs.mkdirSync(target, { recursive: true });
    for (const entry of fs.readdirSync(source)) {
      copyTree(path.join(source, entry), path.join(target, entry), root, activeDirectories);
    }
    activeDirectories.delete(realDirectory);
    return;
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

export function copyRuntimeClosure(source, target) {
  validateRuntimeClosure(source, { allowLinks: true });
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(target), { recursive: true });
  // pnpm deploy 在 Windows 上可能包含指向源目录的绝对 junction；复制时物化链接，
  // 避免安装包携带构建机路径，同时保留标准 node_modules/.pnpm 解析拓扑。
  const sourceRoot = fs.realpathSync(path.resolve(source));
  copyTree(sourceRoot, path.resolve(target), sourceRoot);
  return validateRuntimeClosure(target);
}

export default async function afterPack(context) {
  assertNativePackContext(context.electronPlatformName);
  const source = runtimeSource(context.packager.projectDir);
  const target = runtimeTarget(context.packager, context.appOutDir);
  copyRuntimeClosure(source, target);
  const productSurfacePatch = validateProductSurfacePatch(target);
  const generationRoot = bundledGenerationRoot(
    context.packager.getResourcesDir(context.appOutDir),
  );
  const resourcesRoot = context.packager.getResourcesDir(context.appOutDir);
  const macosClipboardBridge = context.electronPlatformName === "darwin"
    ? validateMacosClipboardBridge(
        path.join(resourcesRoot, "runtime", "native", "manifest.json"),
        path.join(resourcesRoot, "runtime", "native", "hermit_macos_clipboard_bridge.node"),
        { inspectBinary: true },
      )
    : undefined;
  const carrierEntry = path.join(
    context.packager.getResourcesDir(context.appOutDir),
    "runtime",
    "carrier",
    "dsh-carrier.js",
  );
  if (!fs.existsSync(carrierEntry)) {
    throw new Error(`Hermit DSH carrier is missing: ${carrierEntry}`);
  }
  const bundledNodeRoot = path.join(generationRoot, "node");
  const bundledNode = path.join(
    bundledNodeRoot,
    process.platform === "win32" ? "node.exe" : path.join("bin", "node"),
  );
  if (!fs.existsSync(bundledNode)) {
    throw new Error(`Bundled Node runtime is missing: ${bundledNode}`);
  }
  const nodeManifest = JSON.parse(
    fs.readFileSync(path.join(bundledNodeRoot, "hermit-runtime.json"), "utf8"),
  );
  if (nodeManifest.platform !== process.platform || nodeManifest.architecture !== process.arch) {
    throw new Error("Bundled Node runtime manifest does not match the native package target");
  }
  const dshManifest = JSON.parse(
    fs.readFileSync(
      path.join(target, "node_modules", "@deepseek-ai", "dsh", "package.json"),
      "utf8",
    ),
  );
  const desktopManifest = JSON.parse(
    fs.readFileSync(path.join(context.packager.projectDir, "package.json"), "utf8"),
  );
  const dshRuntimeManifest = JSON.parse(
    fs.readFileSync(path.join(target, "hermit-runtime.json"), "utf8"),
  );
  const foregroundSessionNavigationPatch = validateForegroundSessionNavigationPatch(target);
  if (JSON.stringify(dshRuntimeManifest.productSurfacePatch) !== JSON.stringify(productSurfacePatch)) {
    throw new Error("Packaged Product Surface patch does not match the prepared runtime manifest");
  }
  if (
    JSON.stringify(dshRuntimeManifest.foregroundSessionNavigationPatch) !==
    JSON.stringify(foregroundSessionNavigationPatch)
  ) {
    throw new Error("Packaged foreground session navigation patch does not match the prepared runtime manifest");
  }
  if (
    dshRuntimeManifest.dshUpstream === undefined ||
    dshRuntimeManifest.dshUpstream.packageVersion !== dshManifest.version ||
    dshRuntimeManifest.artifactMode !== "packed-tarball-v1"
  ) {
    throw new Error("Packaged DSH upstream cohort does not match the DSH package");
  }
  fs.writeFileSync(
    path.join(generationRoot, "generation.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      generationId: BUNDLED_GENERATION_ID,
      runtimeVersion: desktopManifest.version,
      nodeVersion: nodeManifest.version,
      dshVersion: dshManifest.version,
      dshUpstream: dshRuntimeManifest.dshUpstream,
      productSurfacePatch,
      foregroundSessionNavigationPatch,
      ...(macosClipboardBridge === undefined ? {} : { macosClipboardBridge }),
      dataEpoch: 1,
    }, null, 2)}\n`,
  );
  console.log(`Validated DSH runtime closure at ${target}`);
}
