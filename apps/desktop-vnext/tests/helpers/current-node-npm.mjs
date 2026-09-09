import fs from "node:fs";
import path from "node:path";

/**
 * 返回当前 Node 发行版自带的 npm CLI，避免 Windows 下直接启动 npm.cmd 绕进 cmd.exe。
 * 发布资格测试必须使用启动测试本身的 Node/npm 闭包，不能因为 PATH 顺序换用 runner 的 npm。
 */
export function currentNodeNpmInvocation() {
  const npmPackagePath = process.platform === "win32"
    ? path.join(path.dirname(process.execPath), "node_modules", "npm", "package.json")
    : path.resolve(path.dirname(process.execPath), "../lib/node_modules/npm/package.json");
  if (!fs.existsSync(npmPackagePath)) {
    throw new Error(`当前 Node 发行版缺少 npm package manifest: ${npmPackagePath}`);
  }
  const npmPackage = JSON.parse(fs.readFileSync(npmPackagePath, "utf8"));
  const npmBin = typeof npmPackage.bin === "string" ? npmPackage.bin : npmPackage.bin?.npm;
  if (typeof npmBin !== "string" || npmBin.length === 0) {
    throw new Error(`npm package manifest 缺少 npm bin: ${npmPackagePath}`);
  }
  const cliPath = path.resolve(path.dirname(npmPackagePath), npmBin);
  if (!fs.existsSync(cliPath)) {
    throw new Error(`当前 Node 发行版缺少 npm CLI: ${cliPath}`);
  }
  return { command: process.execPath, cliPath };
}
