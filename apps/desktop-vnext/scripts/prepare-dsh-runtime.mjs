import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  installProductSurfacePatch,
  validateProductSurfacePatch,
  validateRuntimeClosure,
} from './after-pack.mjs';
import {
  installForegroundSessionNavigationPatch,
  validateForegroundSessionNavigationPatch,
} from './dsh-foreground-session-navigation-patch.mjs';
import { readDshUpstreamRegistry } from '../../../scripts/dsh-upstream.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDir, '..', '..', '..');
const runtimeParent = path.join(repositoryRoot, '.hermit', 'runtime');
const target = path.join(runtimeParent, 'dsh');
const require = createRequire(import.meta.url);
const pnpmManifest = require.resolve('pnpm');
const pnpmPackage = JSON.parse(fs.readFileSync(pnpmManifest, 'utf8'));
const pnpmCli = path.join(path.dirname(pnpmManifest), 'bin', 'pnpm.cjs');
const runtimeBundleManifestPath = path.join(
  repositoryRoot,
  'apps',
  'desktop-vnext',
  'runtime-bundle-manifest.json',
);
const runtimeBundleManifest = readRuntimeBundleManifest(runtimeBundleManifestPath);
const runtimeHostManifestPath = path.join(
  repositoryRoot,
  'packages',
  'dsh-runtime-host',
  'package.json',
);
const dshUpstreamRegistryPath = path.join(repositoryRoot, 'DEEPSEEK-HARNESS-UPSTREAM.md');
const dshUpstream = readDshUpstreamRegistry(repositoryRoot);
const runtimeArtifactMode = 'installed-package-v1';
const runtimeMaterializationPolicy = 'dsh-runtime-files-v1';
const foregroundSessionNavigationPatchScriptPath = path.join(
  scriptDir,
  'dsh-foreground-session-navigation-patch.mjs',
);
const productSurfaceSource = resolveManifestSource(runtimeBundleManifest.productSurfacePackage);
const bundledPackages = runtimeBundleManifest.bundledPackages.map((runtimeSpec) => ({
  spec: runtimeSpec,
  source: resolveManifestSource(runtimeSpec),
}));
const runtimeBuildConfigs = [
  path.join(productSurfaceSource, 'tsdown.config.ts'),
];
const bundledNode = path.join(
  runtimeParent,
  'node',
  process.platform === 'win32' ? 'node.exe' : path.join('bin', 'node'),
);
if (!fs.existsSync(bundledNode)) {
  throw new Error('Bundled Node runtime must be prepared before the DSH runtime closure');
}
const nodeRuntimeManifest = JSON.parse(
  fs.readFileSync(path.join(runtimeParent, 'node', 'hermit-runtime.json'), 'utf8'),
);
if (
  nodeRuntimeManifest.platform !== process.platform ||
  nodeRuntimeManifest.architecture !== process.arch
) {
  throw new Error(
    'Bundled Node runtime target does not match this native DSH deployment host',
  );
}
const desktopManifest = JSON.parse(
  fs.readFileSync(path.join(repositoryRoot, 'apps', 'desktop-vnext', 'package.json'), 'utf8'),
);
const buildPackages = [
  { packageName: runtimeBundleManifest.productSurfacePackage.packageName, source: productSurfaceSource },
];
const runtimePackages = [
  ...buildPackages,
  ...bundledPackages.map(({ spec, source }) => ({ packageName: spec.packageName, source })),
];
for (const { packageName } of buildPackages) {
  const build = spawnSync(
    bundledNode,
    [pnpmCli, '--filter', packageName, 'build'],
    { cwd: repositoryRoot, env: { ...process.env, CI: 'true' }, stdio: 'inherit' },
  );
  if (build.error !== undefined) throw build.error;
  if (build.status !== 0) throw new Error(`Failed to build first-party runtime package ${packageName}`);
}
const expectedDshVersion = desktopManifest.dependencies?.['@deepseek-ai/dsh'];
if (typeof expectedDshVersion !== 'string') {
  throw new Error('Desktop manifest must declare the DSH runtime dependency');
}
if (dshUpstream.status !== 'active' || dshUpstream.dshPackageVersion !== expectedDshVersion) {
  throw new Error(
    `DSH runtime 与官方 active 快照不一致：runtime=${expectedDshVersion}, ` +
      `snapshot=${String(dshUpstream.dshPackageVersion)}, status=${String(dshUpstream.status)}`,
  );
}
const dshUpstreamEvidence = {
  repository: dshUpstream.upstreamRepository,
  tag: dshUpstream.upstreamTag,
  commit: dshUpstream.upstreamCommit,
  packageVersion: dshUpstream.dshPackageVersion,
  snapshotPath: dshUpstream.snapshotPath,
  snapshotChecksum: dshUpstream.snapshotChecksum,
};
const inputHash = createHash('sha256');
hashInput('pnpm-lock.yaml', fs.readFileSync(path.join(repositoryRoot, 'pnpm-lock.yaml')));
hashInput(
  'pnpm-workspace.yaml',
  fs.readFileSync(path.join(repositoryRoot, 'pnpm-workspace.yaml')),
);
hashInput('runtime-bundle-manifest', fs.readFileSync(runtimeBundleManifestPath));
hashInput('runtime-host-manifest', fs.readFileSync(runtimeHostManifestPath));
hashInput('dsh-upstream-registry', fs.readFileSync(dshUpstreamRegistryPath));
hashInput('runtime-artifact-mode', Buffer.from(runtimeArtifactMode));
hashInput('runtime-materialization-policy', Buffer.from(runtimeMaterializationPolicy));
hashInput(
  'dsh-foreground-session-navigation-patch-script',
  fs.readFileSync(foregroundSessionNavigationPatchScriptPath),
);
for (const buildConfig of runtimeBuildConfigs) {
  hashInput(
    `runtime-build-config:${path.relative(repositoryRoot, buildConfig)}`,
    fs.readFileSync(buildConfig),
  );
}
hashPackage(runtimeBundleManifest.productSurfacePackage, productSurfaceSource);
for (const { spec, source } of bundledPackages) hashPackage(spec, source);
const runtimePackageEvidence = [
  {
    role: 'product-navigation-shortcut-center-desktop-surface-and-primary-workspace',
    packageName: runtimeBundleManifest.productSurfacePackage.packageName,
    version: readPackageVersion(productSurfaceSource),
    packageContentSha256: packageDigest(runtimeBundleManifest.productSurfacePackage, productSurfaceSource),
  },
  ...bundledPackages.map(({ spec, source }) => ({
    role: 'bundled-plugin',
    packageName: spec.packageName,
    version: readPackageVersion(source),
    packageContentSha256: packageDigest(spec, source),
  })),
];
hashInput(
  'desktop-deployment-manifest',
  Buffer.from(JSON.stringify({
    name: desktopManifest.name,
    version: desktopManifest.version,
    dependencies: desktopManifest.dependencies,
  })),
);
const inputSha256 = inputHash.digest('hex');

// 直接部署到固定的受管路径，并让 pnpm 生成可搬运的物理 node_modules 布局，避免
// 安装器携带构建机上的 junction 目标。
const reusable = !process.argv.includes('--refresh') && isReusableClosure();
if (!reusable) {
  assertManagedRuntimePath(target);
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(runtimeParent, { recursive: true });

  const deploy = spawnSync(
    bundledNode,
    [
      pnpmCli,
      '--config.ignore-scripts=false',
      '--config.inject-workspace-packages=true',
      '--config.node-linker=hoisted',
      '--filter',
      '@hermit/dsh-runtime-host',
      'deploy',
      '--prod',
      target,
    ],
    { cwd: repositoryRoot, env: { ...process.env, CI: 'true' }, stdio: 'inherit' },
  );
  if (deploy.error !== undefined) throw deploy.error;
  if (deploy.status !== 0) throw new Error('pnpm failed to create the DSH runtime closure');
  for (const { spec, source } of [
    { spec: runtimeBundleManifest.productSurfacePackage, source: productSurfaceSource },
    ...bundledPackages,
  ]) materializeInstalledPackage(target, spec, source);
  assertRuntimePackageContents(target);
  // patch source 固定来自已经 materialize 的 Product Surface package，避免再次从 workspace
  // 覆盖已安装 package 内容。
  installProductSurfacePatch(target);
  const foregroundSessionNavigationPatch = installForegroundSessionNavigationPatch(target);
  validateRuntimeClosure(target, { allowLinks: true });
  assertRuntimePackageContents(target);
  const productSurfacePatch = validateProductSurfacePatch(target);
  fs.writeFileSync(
    path.join(target, 'hermit-runtime.json'),
    JSON.stringify({
      schemaVersion: 1,
      dshVersion: expectedDshVersion,
      dshUpstream: dshUpstreamEvidence,
      artifactMode: runtimeArtifactMode,
      materializationPolicy: runtimeMaterializationPolicy,
      nodeVersion: nodeRuntimeManifest.version,
      pnpmVersion: pnpmPackage.version,
      platform: process.platform,
      architecture: process.arch,
      inputSha256,
      runtimePackages: runtimePackageEvidence,
      productSurfacePatch,
      foregroundSessionNavigationPatch,
    }, null, 2) + '\n',
  );
}

const dshEntry = path.join(target, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js');
const smokeCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'hermit-dsh-prep-'));
const smokeEnv = {
  ...process.env,
  DSH_HOME: path.join(smokeCwd, 'dsh-home'),
  PATH: [
    path.dirname(bundledNode),
    path.join(target, 'node_modules', '.bin'),
  ].join(path.delimiter),
};
delete smokeEnv.Path;
delete smokeEnv.NODE_PATH;
delete smokeEnv.node_path;
delete smokeEnv.PNPM_HOME;
delete smokeEnv.NODE_OPTIONS;
delete smokeEnv.COREPACK_HOME;
for (const key of Object.keys(smokeEnv)) {
  const normalized = key.toLowerCase();
  if (
    normalized === 'npm_execpath' ||
    normalized === 'npm_node_execpath' ||
    normalized.startsWith('npm_config_') ||
    normalized.startsWith('pnpm_config_')
  ) {
    delete smokeEnv[key];
  }
}
const smoke = spawnSync(bundledNode, [dshEntry, '--version'], {
  cwd: smokeCwd,
  encoding: 'utf8',
  env: smokeEnv,
});
fs.rmSync(smokeCwd, { recursive: true, force: true });
if (smoke.error !== undefined) throw smoke.error;
if (smoke.status !== 0 || smoke.stdout.trim() !== expectedDshVersion) {
  throw new Error('Deployed DSH CLI did not pass the runtime closure smoke check');
}

console.log((reusable ? 'Reused' : 'Prepared') + ' DSH runtime closure at ' + target);

function isReusableClosure() {
  const manifestPath = path.join(target, 'hermit-runtime.json');
  if (!fs.existsSync(manifestPath)) return rejectReuse('manifest missing');
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (
      manifest.schemaVersion !== 1 ||
      manifest.dshVersion !== expectedDshVersion ||
      JSON.stringify(manifest.dshUpstream) !== JSON.stringify(dshUpstreamEvidence) ||
      manifest.artifactMode !== runtimeArtifactMode ||
      manifest.materializationPolicy !== runtimeMaterializationPolicy ||
      manifest.nodeVersion !== nodeRuntimeManifest.version ||
      manifest.pnpmVersion !== pnpmPackage.version ||
      manifest.platform !== process.platform ||
      manifest.architecture !== process.arch ||
      manifest.inputSha256 !== inputSha256
    ) {
      return rejectReuse('static manifest evidence mismatch');
    }
    validateRuntimeClosure(target, { allowLinks: true });
    const productSurfacePatch = validateProductSurfacePatch(target);
    if (JSON.stringify(manifest.productSurfacePatch) !== JSON.stringify(productSurfacePatch)) {
      return rejectReuse('Product Surface patch evidence mismatch');
    }
    const foregroundSessionNavigationPatch = validateForegroundSessionNavigationPatch(target);
    if (
      JSON.stringify(manifest.foregroundSessionNavigationPatch) !==
      JSON.stringify(foregroundSessionNavigationPatch)
    ) {
      return rejectReuse('foreground session navigation patch evidence mismatch');
    }
    const packageContentEvidence = manifest.runtimePackages;
    if (JSON.stringify(packageContentEvidence) !== JSON.stringify(runtimePackageEvidence)) {
      return rejectReuse('runtime package evidence mismatch');
    }
    return true;
  } catch (error) {
    return rejectReuse(error instanceof Error ? error.message : String(error));
  }
}

function rejectReuse(reason) {
  if (process.env.HERMIT_DSH_RUNTIME_DEBUG === '1') {
    console.error(`[dsh-runtime] rebuild required: ${reason}`);
  }
  return false;
}

function materializeInstalledPackage(runtimeRoot, spec, source) {
  const packageName = spec.packageName;
  const targetRoot = path.join(runtimeRoot, 'node_modules', ...packageName.split('/'));
  if (!targetRoot.startsWith(`${path.resolve(runtimeRoot)}${path.sep}`)) {
    throw new Error(`runtime package path escapes closure: ${packageName}`);
  }
  fs.rmSync(targetRoot, { recursive: true, force: true });
  fs.mkdirSync(targetRoot, { recursive: true });
  for (const relativePath of spec.hashPaths) {
    const sourcePath = path.resolve(source, relativePath);
    if (!sourcePath.startsWith(`${source}${path.sep}`) || !fs.existsSync(sourcePath)) {
      throw new Error(`运行时 package 文件不存在：${packageName}/${relativePath}`);
    }
    const targetPath = path.join(targetRoot, relativePath);
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.cpSync(sourcePath, targetPath, { recursive: true, dereference: true });
  }
}

function assertRuntimePackageContents(runtimeRoot) {
  for (const { packageName, source } of runtimePackages) {
    const sourceSpec = packageName === runtimeBundleManifest.productSurfacePackage.packageName
      ? runtimeBundleManifest.productSurfacePackage
      : bundledPackages.find(({ spec }) => spec.packageName === packageName)?.spec;
    if (sourceSpec === undefined) throw new Error(`运行时 package 清单缺少规格：${packageName}`);
    const targetPackage = path.join(runtimeRoot, 'node_modules', ...packageName.split('/'));
    if (!fs.existsSync(targetPackage)) {
      throw new Error(`runtime package 未物化：${packageName}`);
    }
    // 只比较 runtime manifest 声明的发布路径，避免把不参与 runtime 的开发文件带入闭包。
    const packagedPaths = packageFiles(sourceSpec, targetPackage)
      .map((file) => path.relative(targetPackage, file));
    const expected = packageDigestAtPaths(source, packagedPaths);
    const actual = packageDigestAtPaths(targetPackage, packagedPaths);
    if (actual !== expected) {
      throw new Error(`runtime package 内容与 packed 制品不一致：${packageName}`);
    }
  }
}

function hashInput(label, value) {
  inputHash
    .update(label)
    .update('\0')
    .update(String(value.length))
    .update('\0')
    .update(value);
}

function readRuntimeBundleManifest(file) {
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (cause) {
    throw new Error(`无法读取 DSH 运行时清单：${cause instanceof Error ? cause.message : String(cause)}`);
  }
  if (manifest?.schemaVersion !== 4) throw new Error('DSH 运行时清单 schemaVersion 必须为 4');
  const productSurfacePackage = validateManifestPackage(manifest.productSurfacePackage, 'productSurfacePackage');
  const declaredBundledPackages = manifest.bundledPackages;
  if (!Array.isArray(declaredBundledPackages) || declaredBundledPackages.length === 0) {
    throw new Error('DSH 运行时清单必须列出至少一个 bundledPackages 项');
  }
  const bundledPackages = declaredBundledPackages.map((spec, index) => (
    validateBundledPackage(spec, `bundledPackages[${index}]`)
  ));
  const packageNames = new Set();
  for (const spec of bundledPackages) {
    if (packageNames.has(spec.packageName)) {
      throw new Error(`DSH 运行时清单包含重复 package：${spec.packageName}`);
    }
    packageNames.add(spec.packageName);
  }
  return { schemaVersion: 4, productSurfacePackage, bundledPackages };
}

function validateBundledPackage(spec, label) {
  if (spec === null || typeof spec !== 'object') throw new Error(`${label} 必须是对象`);
  return validateManifestPackage(spec, label);
}

function validateManifestPackage(spec, label) {
  if (spec === null || typeof spec !== 'object') throw new Error(`${label} 必须是对象`);
  if (typeof spec.packageName !== 'string' || spec.packageName.length === 0) {
    throw new Error(`${label}.packageName 必须是非空字符串`);
  }
  if (typeof spec.source !== 'string' || spec.source.length === 0) {
    throw new Error(`${label}.source 必须是非空字符串`);
  }
  if (
    !Array.isArray(spec.hashPaths) ||
    spec.hashPaths.length === 0 ||
    spec.hashPaths.some((value) => typeof value !== 'string' || value.length === 0)
  ) {
    throw new Error(`${label}.hashPaths 必须是非空字符串数组`);
  }
  return {
    packageName: spec.packageName,
    source: spec.source,
    hashPaths: [...spec.hashPaths],
  };
}

function resolveManifestSource(spec) {
  const declaredSource = path.resolve(repositoryRoot, spec.source);
  if (!declaredSource.startsWith(`${repositoryRoot}${path.sep}`) || !fs.existsSync(declaredSource)) {
    throw new Error(`DSH 运行时清单 source 无效：${spec.source}`);
  }
  const source = fs.realpathSync(declaredSource);
  if (!source.startsWith(`${repositoryRoot}${path.sep}`)) {
    throw new Error(`DSH 运行时清单 source 解析后越界：${spec.source}`);
  }
  const packageManifest = path.join(source, 'package.json');
  if (!fs.existsSync(packageManifest)) throw new Error(`运行时 package 缺少 package.json：${source}`);
  const packageJson = JSON.parse(fs.readFileSync(packageManifest, 'utf8'));
  if (packageJson.name !== spec.packageName) {
    throw new Error(`运行时清单与 package.json 名称不一致：${spec.packageName} != ${String(packageJson.name)}`);
  }
  return source;
}

function hashPackage(spec, source) {
  for (const file of packageFiles(spec, source)) {
    hashInput(`${spec.packageName}:${path.relative(source, file)}`, fs.readFileSync(file));
  }
}

function packageDigest(spec, source) {
  return packageDigestAtPaths(
    source,
    packageFiles(spec, source).map((file) => path.relative(source, file)),
  );
}

function packageDigestAtPaths(source, relativePaths) {
  const hash = createHash('sha256');
  for (const relativePath of relativePaths) {
    const file = path.resolve(source, relativePath);
    if (!file.startsWith(`${source}${path.sep}`) || !fs.existsSync(file)) {
      throw new Error(`运行时 package 的发布文件不存在：${relativePath}`);
    }
    const content = path.basename(file) === 'package.json'
      ? Buffer.from(JSON.stringify(canonicalJson(JSON.parse(fs.readFileSync(file, 'utf8')))))
      : fs.readFileSync(file);
    hash.update(relativePath).update('\0').update(content).update('\0');
  }
  return hash.digest('hex');
}

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalJson(entry)]),
    );
  }
  return value;
}

function packageFiles(spec, source) {
  const files = [];
  for (const relativePath of spec.hashPaths) {
    const targetPath = path.resolve(source, relativePath);
    if (!targetPath.startsWith(`${source}${path.sep}`) || !fs.existsSync(targetPath)) {
      throw new Error(`运行时 package 的 hashPaths 无效：${spec.packageName}/${relativePath}`);
    }
    const stat = fs.statSync(targetPath);
    files.push(...(stat.isDirectory() ? collectFiles(targetPath) : [targetPath]));
  }
  return [...new Set(files)].sort();
}

function readPackageVersion(source) {
  const manifest = JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8'));
  if (typeof manifest.version !== 'string' || manifest.version.length === 0) {
    throw new Error(`运行时 package 缺少 version：${source}`);
  }
  return manifest.version;
}

function collectFiles(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const targetPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...collectFiles(targetPath));
    else if (entry.isFile()) files.push(targetPath);
  }
  return files;
}

function assertManagedRuntimePath(value) {
  if (!value.startsWith(runtimeParent + path.sep)) {
    throw new Error('Refusing to replace unmanaged DSH runtime path: ' + value);
  }
}
