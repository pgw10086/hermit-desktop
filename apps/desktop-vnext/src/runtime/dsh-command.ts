import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { DshCommand } from "@platform/dsh-runtime-adapter";

export type { DshCommand } from "@platform/dsh-runtime-adapter";

export interface DshCommandOptions {
  /** 是否从 bundled runtime 解析路径。 */
  readonly isPackaged: boolean;
  /** Electron resources 根目录。 */
  readonly resourcesPath: string;
  /** DSH profile 的持久化目录。 */
  readonly profileHome: string;
  /** DSH 进程工作区路径。 */
  readonly workspacePath: string;
  /** 可选的 runtime 根目录覆盖。 */
  readonly runtimeRoot?: string;
  /** 可选的 carrier 入口覆盖，主要用于资格 fixture。 */
  readonly carrierEntry?: string;
  /** 传入命令前的环境快照。 */
  readonly environment?: NodeJS.ProcessEnv;
}

/** 校验路径存在并返回原值，避免运行时启动到缺失制品。 */
function requireExisting(file: string, label: string): string {
  if (!fs.existsSync(file)) throw new Error(`${label} is missing: ${file}`);
  return file;
}

/** 从开发依赖解析 DSH CLI 入口。 */
function resolveDevelopmentDshEntry(): string {
  const require = createRequire(import.meta.url);
  const manifest = require.resolve("@deepseek-ai/dsh/package.json");
  return path.join(path.dirname(manifest), "lib", "bin.js");
}

/** 从打包 runtime manifest 解析并限制 DSH CLI 入口在包目录内。 */
function resolvePackagedDshEntry(runtimeDshRoot: string): string {
  const packageRoot = path.join(runtimeDshRoot, "node_modules", "@deepseek-ai", "dsh");
  const manifestPath = requireExisting(
    path.join(packageRoot, "package.json"),
    "Bundled DSH package manifest",
  );
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
    readonly bin?: string | { readonly dsh?: string };
  };
  const bin = typeof manifest.bin === "string" ? manifest.bin : manifest.bin?.dsh;
  if (bin === undefined) throw new Error("Bundled DSH package has no dsh CLI entry");
  const entry = path.resolve(packageRoot, bin);
  if (!entry.startsWith(`${packageRoot}${path.sep}`)) {
    throw new Error("Bundled DSH CLI entry escapes its package root");
  }
  return requireExisting(entry, "Bundled DSH CLI");
}

/** 根据打包状态构造 Hermit DSH carrier 命令及其受限环境。 */
export function createDshCommand(options: DshCommandOptions): DshCommand {
  const environment = options.environment ?? process.env;
  const runtimeRoot = options.runtimeRoot ?? path.join(options.resourcesPath, "runtime");
  const runtimeNodeRoot = path.join(runtimeRoot, "node");
  const runtimeDshRoot = path.join(runtimeRoot, "dsh");
  const executable = options.isPackaged
    ? requireExisting(
        process.platform === "win32"
          ? path.join(runtimeNodeRoot, "node.exe")
          : path.join(runtimeNodeRoot, "bin", "node"),
        "Bundled Node runtime",
      )
    : (environment.HERMIT_NODE_BINARY ?? environment.npm_node_execpath ?? "node");

  const dshEntry = options.isPackaged
    ? resolvePackagedDshEntry(runtimeDshRoot)
    : resolveDevelopmentDshEntry();
  const carrierEntry = requireExisting(
    options.carrierEntry ?? (options.isPackaged
      ? path.join(options.resourcesPath, "runtime", "carrier", "dsh-carrier.js")
      : path.join(path.dirname(fileURLToPath(import.meta.url)), "dsh-carrier.js")),
    "Hermit DSH carrier",
  );

  const packagedBins = options.isPackaged
    ? [
        process.platform === "win32" ? runtimeNodeRoot : path.join(runtimeNodeRoot, "bin"),
        path.join(runtimeDshRoot, "node_modules", ".bin"),
      ]
    : [path.join(path.dirname(resolveDevelopmentDshEntry()), "..", "..", "..", ".bin")];
  const inheritedPath = environment.PATH ?? environment.Path ?? "";
  const env: NodeJS.ProcessEnv = {
    ...environment,
    DSH_HOME: options.profileHome,
    PATH: [...packagedBins, inheritedPath].filter(Boolean).join(path.delimiter),
  };
  delete env.Path;
  for (const key of Object.keys(env)) {
    const normalized = key.toLowerCase();
    if (
      normalized === "node_options" ||
      normalized === "node_path" ||
      normalized === "pnpm_home" ||
      normalized === "corepack_home" ||
      normalized === "npm_execpath" ||
      normalized === "npm_node_execpath" ||
      normalized.startsWith("npm_config_") ||
      normalized.startsWith("pnpm_config_")
    ) {
      delete env[key];
    }
  }

  return {
    executable,
    args: [carrierEntry, dshEntry, "web", "--host", "127.0.0.1", "--port", "0", "--no-open"],
    cwd: options.workspacePath,
    env,
    stopViaStdin: true,
  };
}
