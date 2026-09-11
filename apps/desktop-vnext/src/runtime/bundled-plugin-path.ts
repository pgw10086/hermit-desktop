import fs from "node:fs";
import path from "node:path";

interface RuntimeBundleManifest {
  /** 随包插件声明列表；版本由 Desktop package.json 和 pnpm lockfile 决定。 */
  readonly bundledPackages?: readonly {
    /** npm package name。 */
    readonly packageName?: unknown;
    /** 开发环境 workspace source 路径。 */
    readonly source?: unknown;
  }[];
}

export interface BundledPluginPathOptions {
  /** 要解析的插件 package name。 */
  readonly packageName: string;
  /** 是否使用打包 runtime 路径。 */
  readonly isPackaged: boolean;
  /** 开发环境应用路径。 */
  readonly appPath: string;
  /** 打包资源根目录。 */
  readonly resourcesPath: string;
  /** 可选 runtime 根目录覆盖。 */
  readonly runtimeRoot?: string;
}

/**
 * 桌面主进程和 DSH Profile 必须指向同一份已准备的插件闭包；开发环境才回到 manifest
 * 声明的 workspace source。插件自身不需要知道 Electron 的目录布局。
 */
export function resolveBundledPluginPath(options: BundledPluginPathOptions): string {
  if (options.isPackaged) {
    const runtimeRoot = options.runtimeRoot ?? path.join(options.resourcesPath, "runtime");
    const packagePath = packageNamePath(options.packageName);
    return path.join(runtimeRoot, "dsh", "node_modules", ...packagePath);
  }

  const repositoryRoot = path.resolve(options.appPath, "..", "..");
  const manifestPath = path.join(repositoryRoot, "apps", "desktop-vnext", "runtime-bundle-manifest.json");
  const manifest = readManifest(manifestPath);
  const spec = manifest.bundledPackages?.find((entry) => entry.packageName === options.packageName);
  if (spec === undefined || typeof spec.source !== "string" || spec.source.length === 0) {
    throw new Error(`DSH runtime 清单没有声明插件：${options.packageName}`);
  }
  const source = path.resolve(repositoryRoot, spec.source);
  if (!source.startsWith(`${repositoryRoot}${path.sep}`)) {
    throw new Error(`DSH runtime 清单插件路径越界：${options.packageName}`);
  }
  return source;
}

/** 将 scoped package name 拆成安全路径片段。 */
function packageNamePath(packageName: string): readonly string[] {
  const parts = packageName.split("/");
  if (parts.length < 2 || parts.some((part) => part.length === 0 || part === "." || part === "..")) {
    throw new Error(`DSH 插件 package name 无效：${packageName}`);
  }
  return parts;
}

/** 读取并解析 runtime bundle manifest。 */
function readManifest(file: string): RuntimeBundleManifest {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as RuntimeBundleManifest;
  } catch (cause) {
    throw new Error(`无法读取 DSH runtime 清单：${cause instanceof Error ? cause.message : String(cause)}`);
  }
}
