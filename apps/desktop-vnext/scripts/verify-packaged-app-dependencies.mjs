import fs from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { APP_DEPENDENCY_NAMES } from "./prepare-app-dependencies.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const appRoot = path.resolve(path.dirname(scriptPath), "..");
const workspaceRoot = path.resolve(appRoot, "..", "..");
const requiredEntries = APP_DEPENDENCY_NAMES.flatMap((packageName) => [
  `node_modules/${packageName}/package.json`,
  `node_modules/${packageName}/lib/index.js`,
]);

export function verifyPackagedAppDependencies({
  appAsar,
  asarCli = findAsarCli(workspaceRoot),
  run = runCommand,
} = {}) {
  if (typeof appAsar !== "string" || appAsar.length === 0) throw new Error("app.asar path is required");
  if (!fs.existsSync(appAsar)) throw new Error(`app.asar is missing: ${appAsar}`);
  const entries = run(process.execPath, [asarCli, "list", appAsar])
    .split(/\r?\n/u)
    .map((entry) => entry.replaceAll("\\", "/").replace(/^\//u, ""));
  for (const required of requiredEntries) {
    if (!entries.includes(required)) throw new Error(`app.asar is missing first-party dependency: ${required}`);
  }
  return { appAsar, requiredEntries: [...requiredEntries] };
}

export function findAsarCli(root) {
  const pnpmRoots = [
    path.join(root, "node_modules", ".pnpm"),
    path.join(root, "..", "..", "node_modules", ".pnpm"),
  ];
  for (const pnpmRoot of pnpmRoots) {
    if (!fs.existsSync(pnpmRoot)) continue;
    const candidate = fs.readdirSync(pnpmRoot)
      .filter((entry) => entry.startsWith("@electron+asar@"))
      .map((entry) => path.join(pnpmRoot, entry, "node_modules", "@electron", "asar", "bin", "asar.js"))
      .find((entry) => fs.existsSync(entry));
    if (candidate !== undefined) return candidate;
  }
  throw new Error("Unable to locate the @electron/asar CLI");
}

function runCommand(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with ${String(result.status)}: ${result.stderr}`);
  return result.stdout;
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === scriptPath) {
  try {
    const result = verifyPackagedAppDependencies({ appAsar: path.resolve(process.argv[2] ?? "") });
    console.log(`Packaged app dependencies passed: ${result.appAsar}`);
  } catch (cause) {
    console.error(`[packaged-app-dependencies] ${cause instanceof Error ? cause.message : String(cause)}`);
    process.exitCode = 1;
  }
}
