import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const appRoot = path.resolve(path.dirname(scriptPath), "..");
const repositoryRoot = path.resolve(appRoot, "..", "..");
const defaultOutputRoot = path.join(repositoryRoot, ".hermit", "runtime", "app-dependencies");

export const APP_DEPENDENCY_NAMES = [
  "@tianbuyv/agent-desktop-core",
  "@tianbuyv/dsh-runtime-adapter",
];

/**
 * 将当前 Desktop frozen install 中的 Electron 主进程依赖物化到受管 staging 目录。
 * pnpm 的 node_modules 入口是链接，不能直接把它当作 app.asar 的运行时依赖来源。
 */
export function prepareAppDependencies({
  desktopRoot = appRoot,
  outputRoot = defaultOutputRoot,
  packageNames = APP_DEPENDENCY_NAMES,
  resolvePackageRoot = defaultResolvePackageRoot,
} = {}) {
  const desktopManifest = readJson(path.join(desktopRoot, "package.json"));
  const packages = packageNames.map((packageName) => {
    const declaredVersion = desktopManifest.dependencies?.[packageName];
    if (typeof declaredVersion !== "string" || declaredVersion.length === 0) {
      throw new Error(`Desktop dependency is not declared: ${packageName}`);
    }
    const sourceRoot = path.resolve(resolvePackageRoot(packageName, desktopRoot));
    const manifest = readJson(path.join(sourceRoot, "package.json"));
    if (manifest.name !== packageName) {
      throw new Error(`Resolved package name mismatch: expected ${packageName}, received ${String(manifest.name)}`);
    }
    if (manifest.version !== declaredVersion) {
      throw new Error(
        `${packageName} version mismatch: Desktop declares ${declaredVersion}, resolved ${String(manifest.version)}`,
      );
    }
    return { name: packageName, version: manifest.version, sourceRoot };
  });

  const runtimeRoot = path.dirname(outputRoot);
  fs.mkdirSync(runtimeRoot, { recursive: true });
  const temporaryRoot = fs.mkdtempSync(path.join(runtimeRoot, "app-dependencies-"));
  let committed = false;
  try {
    for (const packageInfo of packages) {
      materializePackage(packageInfo, path.join(temporaryRoot, "node_modules", ...packageInfo.name.split("/")));
    }
    fs.writeFileSync(
      path.join(temporaryRoot, "app-dependencies-manifest.json"),
      `${JSON.stringify({ schemaVersion: 1, packages: packages.map(({ name, version }) => ({ name, version })) }, null, 2)}\n`,
      "utf8",
    );
    validateStaging(temporaryRoot, packages);
    fs.rmSync(outputRoot, { recursive: true, force: true });
    fs.renameSync(temporaryRoot, outputRoot);
    committed = true;
  } finally {
    if (!committed) fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }

  console.log(`Prepared Desktop app dependencies at ${outputRoot}`);
  return { outputRoot, packages: packages.map(({ name, version }) => ({ name, version })) };
}

function materializePackage({ sourceRoot }, targetRoot) {
  fs.mkdirSync(targetRoot, { recursive: true });
  for (const entry of ["LICENSE", "README.md", "package.json", "lib"]) {
    const source = path.join(sourceRoot, entry);
    if (!fs.existsSync(source)) throw new Error(`Published package file is missing: ${source}`);
    fs.cpSync(source, path.join(targetRoot, entry), { recursive: true, dereference: true });
  }
  if (fs.existsSync(path.join(targetRoot, "node_modules"))) {
    throw new Error(`Materialized app dependency contains nested node_modules: ${targetRoot}`);
  }
}

function validateStaging(root, packages) {
  const manifest = readJson(path.join(root, "app-dependencies-manifest.json"));
  if (manifest.schemaVersion !== 1) throw new Error("Unsupported app dependency staging manifest");
  for (const { name, version } of packages) {
    const packageManifest = readJson(path.join(root, "node_modules", ...name.split("/"), "package.json"));
    if (packageManifest.name !== name || packageManifest.version !== version) {
      throw new Error(`Staged app dependency manifest mismatch: ${name}`);
    }
  }
}

function defaultResolvePackageRoot(packageName, desktopRoot) {
  const require = createRequire(path.join(desktopRoot, "package.json"));
  return path.dirname(require.resolve(`${packageName}/package.json`));
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === scriptPath) {
  try {
    prepareAppDependencies();
  } catch (cause) {
    console.error(`[app-dependencies] ${cause instanceof Error ? cause.message : String(cause)}`);
    process.exitCode = 1;
  }
}
