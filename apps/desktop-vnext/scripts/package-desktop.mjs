// macOS DMG control flow is adapted from anywhere-labs/dsh-desktop@1eb398d (MIT).
// Hermit在 bundled Node 24 下生成资格产物，外层系统 Node 只负责引导准备该运行时。
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertNativeTarget } from "./assert-native-target.mjs";
import {
  resolveMacReleaseSigning,
  withoutMacReleaseSecrets,
} from "./mac-release-environment.mjs";
import {
  resolveWindowsReleaseSigning,
  withoutWindowsReleaseSecrets,
} from "./windows-release-environment.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const appRoot = path.resolve(path.dirname(scriptPath), "..");
const repositoryRoot = path.resolve(appRoot, "..", "..");
const platformLockScript = path.join(repositoryRoot, "scripts", "platform-lock.mjs");
const bundledNode = path.join(
  repositoryRoot,
  ".hermit",
  "runtime",
  "node",
  process.platform === "win32" ? "node.exe" : path.join("bin", "node"),
);
const prepareNodeScript = path.join(appRoot, "scripts", "prepare-node-runtime.mjs");
const prepareDshScript = path.join(appRoot, "scripts", "prepare-dsh-runtime.mjs");
const copyDesktopAssetsScript = path.join(appRoot, "scripts", "copy-desktop-assets.mjs");
const nativeBridgeBuildScript = path.join(repositoryRoot, "native", "macos-clipboard-bridge", "scripts", "build.mjs");
const pnpmCli = path.join(appRoot, "node_modules", "pnpm", "bin", "pnpm.cjs");
const typescriptCli = path.join(appRoot, "node_modules", "typescript", "bin", "tsc");
const tsdownCli = path.join(appRoot, "node_modules", "tsdown", "dist", "run.mjs");
const builderCli = path.join(appRoot, "node_modules", "electron-builder", "out", "cli", "cli.js");
const electronInstallScript = path.join(appRoot, "node_modules", "electron", "install.js");
const verifier = path.join(appRoot, "scripts", "verify-mac-artifact.mjs");
const windowsVerifier = path.join(appRoot, "scripts", "verify-windows-artifact.mjs");
const expectedNodeVersion = fs.readFileSync(path.join(repositoryRoot, ".node-version"), "utf8").trim();

const mode = process.argv[2];
if (!new Set(["dir", "mac-smoke", "mac-release", "win-smoke", "win-release"]).has(mode)) {
  throw new Error("Usage: package-desktop.mjs <dir|mac-smoke|mac-release|win-smoke|win-release>");
}

if (!process.argv.includes("--qualified-runtime")) {
  // Product Desktop 打包必须先冻结并校验第一方制品，不能从 sibling 源码隐式补包。
  run(process.execPath, [platformLockScript, "prepare", "--mode", "release"], repositoryRoot, process.env);
  run(process.execPath, [prepareNodeScript], repositoryRoot, process.env);
  run(bundledNode, [scriptPath, mode, "--qualified-runtime"], repositoryRoot, process.env);
} else {
  packageDesktop(mode);
}

function packageDesktop(selectedMode) {
  if (process.version !== `v${expectedNodeVersion}`) {
    throw new Error(
      `Qualified packaging requires bundled Node ${expectedNodeVersion}; received ${process.version}`,
    );
  }
  for (const required of [pnpmCli, typescriptCli, tsdownCli, builderCli, electronInstallScript]) {
    if (!fs.existsSync(required)) {
      throw new Error(`Desktop dependencies are not installed: ${required}`);
    }
  }

  const buildEnvironment = qualifiedEnvironment(
    withoutWindowsReleaseSecrets(withoutMacReleaseSecrets(process.env)),
  );
  const isMac = selectedMode === "mac-smoke" || selectedMode === "mac-release";
  const isWindows = selectedMode === "win-smoke" || selectedMode === "win-release";
  assertNativeTarget();
  if (selectedMode !== "dir" && isMac && (process.platform !== "darwin" || process.arch !== "arm64")) {
    throw new Error("macOS delivery requires a native Apple Silicon host");
  }
  if (selectedMode !== "dir" && isWindows && (process.platform !== "win32" || process.arch !== "x64")) {
    throw new Error("Windows delivery requires a native Windows x64 host");
  }

  const macReleaseConfiguration = selectedMode === "mac-release"
    ? resolveMacReleaseSigning({ environment: process.env })
    : undefined;
  const windowsReleaseConfiguration = selectedMode === "win-release"
    ? resolveWindowsReleaseSigning({ environment: process.env })
    : undefined;
  if (macReleaseConfiguration !== undefined) {
    if (macReleaseConfiguration.mode === "required") {
      console.log(
        `macOS release preflight passed: ${macReleaseConfiguration.identity}; signing=required; notarization=${macReleaseConfiguration.notarizationCredentials}`,
      );
    } else {
      console.log("macOS release preflight passed: signing=SKIPPED; notarization=SKIPPED; stapling=SKIPPED");
    }
    runDesktopTests(buildEnvironment);
  }
  if (windowsReleaseConfiguration !== undefined) {
    console.log(
      `Windows release preflight passed: signing=${windowsReleaseConfiguration.mode === "required" ? "required" : "SKIPPED"}`,
    );
    runDesktopTests(buildEnvironment);
  }
  if (selectedMode === "win-smoke") runDesktopTests(buildEnvironment);

  // 安装阶段允许跳过依赖脚本；打包入口必须显式准备锁定版本的 Electron。
  run(bundledNode, [electronInstallScript], appRoot, buildEnvironment);
  run(bundledNode, [prepareDshScript], repositoryRoot, buildEnvironment);
  run(bundledNode, [nativeBridgeBuildScript], repositoryRoot, buildEnvironment);
  run(bundledNode, [typescriptCli, "-p", "tsconfig.json"], appRoot, buildEnvironment);
  run(bundledNode, [tsdownCli, "-c", "tsdown.quick-retrieval.config.ts"], appRoot, buildEnvironment);
  run(bundledNode, [copyDesktopAssetsScript], appRoot, buildEnvironment);

  if (selectedMode === "dir") {
    // 目录包用于本机测试，必须和已安装的 Hermit 隔离单实例锁与 userData。
    run(
      bundledNode,
      [
        builderCli,
        "--dir",
        "--publish",
        "never",
        "--config.extraMetadata.hermitBuildVariant=test",
      ],
      appRoot,
      buildEnvironment,
    );
    return;
  }

  const release = macReleaseConfiguration !== undefined || windowsReleaseConfiguration !== undefined;
  const signedRelease = macReleaseConfiguration?.mode === "required" || windowsReleaseConfiguration?.mode === "required";
  const outputDirectory = path.join(
    appRoot,
    "dist",
    isMac ? (release ? "mac-release" : "mac-smoke") : (release ? "win-release" : "win-smoke"),
  );
  resetGeneratedOutput(outputDirectory);
  const builderEnvironment = signedRelease
    ? qualifiedEnvironment(process.env)
    : { ...buildEnvironment, CSC_IDENTITY_AUTO_DISCOVERY: "false" };
  const builderArgs = isMac
    ? [
      builderCli,
      "--mac",
      "dmg",
      "--arm64",
      "--publish",
      "never",
      "--config.npmRebuild=false",
      `--config.directories.output=${outputDirectory}`,
      signedRelease ? "--config.forceCodeSigning=true" : "--config.mac.identity=null",
      signedRelease ? "--config.mac.notarize=true" : "--config.mac.notarize=false",
      signedRelease ? "--config.mac.hardenedRuntime=true" : "--config.mac.hardenedRuntime=false",
    ]
    : [
      builderCli,
      "--win",
      "nsis",
      "--x64",
      "--publish",
      "never",
      "--config.npmRebuild=false",
      `--config.directories.output=${outputDirectory}`,
      signedRelease ? "--config.forceCodeSigning=true" : "--config.forceCodeSigning=false",
    ];
  run(bundledNode, builderArgs, appRoot, builderEnvironment);
  run(
    bundledNode,
    isMac
      ? [verifier, release ? "release" : "smoke", outputDirectory]
      : [windowsVerifier, release ? "release" : "smoke"],
    appRoot,
    buildEnvironment,
  );
}

function resetGeneratedOutput(outputDirectory) {
  const allowedRoot = path.join(appRoot, "dist") + path.sep;
  if (!outputDirectory.startsWith(allowedRoot)) {
    throw new Error(`Refusing to remove an unmanaged output directory: ${outputDirectory}`);
  }
  fs.rmSync(outputDirectory, { recursive: true, force: true });
}

function runDesktopTests(environment) {
  run(bundledNode, [typescriptCli, "-p", "tsconfig.json"], appRoot, environment);
  run(bundledNode, [typescriptCli, "-p", "tsconfig.quick-retrieval.json", "--noEmit"], appRoot, environment);
  run(bundledNode, [tsdownCli, "-c", "tsdown.quick-retrieval.config.ts"], appRoot, environment);
  run(bundledNode, [copyDesktopAssetsScript], appRoot, environment);
  const tests = fs.readdirSync(path.join(appRoot, "tests"))
    .filter((name) => name.endsWith(".test.mjs"))
    .sort()
    .map((name) => path.join("tests", name));
  run(bundledNode, ["--test", ...tests], appRoot, environment);
}

function qualifiedEnvironment(environment) {
  const qualified = {
    ...environment,
    PATH: [path.dirname(bundledNode), environment.PATH ?? environment.Path ?? ""]
      .filter(Boolean)
      .join(path.delimiter),
  };
  if (
    qualified.ELECTRON_GET_USE_PROXY === undefined &&
    (qualified.HTTPS_PROXY !== undefined || qualified.HTTP_PROXY !== undefined)
  ) {
    qualified.ELECTRON_GET_USE_PROXY = "true";
  }
  delete qualified.Path;
  return qualified;
}

function run(command, args, cwd, environment) {
  const result = spawnSync(command, args, { cwd, env: environment, stdio: "inherit" });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} exited with ${String(result.status)}`);
  }
}
