import path from "node:path";

/** 随安装包发布的初始 generation 标识。 */
export const BUNDLED_GENERATION_ID = "bundled";

/** 计算 resources 下 bundled generation 的根目录。 */
export function bundledGenerationRoot(resourcesPath) {
  return path.join(resourcesPath, "runtime", "generations", BUNDLED_GENERATION_ID);
}

/** 根据平台和架构计算未安装应用的 resources 目录。 */
export function defaultResourcesPath(appRoot, platform = process.platform, architecture = process.arch) {
  const outputDirectory = platform === "win32"
    ? "win-unpacked"
    : platform === "darwin"
      ? architecture === "arm64" ? "mac-arm64" : "mac"
      : "linux-unpacked";
  const resourcesSuffix = platform === "darwin"
    ? path.join("Hermit.app", "Contents", "Resources")
    : "resources";
  return path.join(appRoot, "dist", outputDirectory, resourcesSuffix);
}
