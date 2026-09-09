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
const platformLockPath = path.join(repositoryRoot, 'platform-lock.json');
const platformLock = readPlatformLock(platformLockPath);
const runtimeHostManifestPath = path.join(
  repositoryRoot,
  'packages',
  'dsh-runtime-host',
  'package.json',
);
const dshUpstreamRegistryPath = path.join(repositoryRoot, 'DEEPSEEK-HARNESS-UPSTREAM.md');
const dshUpstream = readDshUpstreamRegistry(repositoryRoot);
const runtimeArtifactMode = 'packed-tarball-v1';
const foregroundSessionNavigationPatchScriptPath = path.join(
  scriptDir,
  'dsh-foreground-session-navigation-patch.mjs',
);
const productSurfaceSource = resolveManifestSource(runtimeBundleManifest.productSurfacePackage);
const bundledPackages = runtimeBundleManifest.bundledPackages.map((runtimeSpec) => {
  const lockedModule = platformLock.modulesById.get(runtimeSpec.moduleId);
  if (lockedModule === undefined) {
    throw new Error(`DSH runtime module 未在 platform-lock 声明：${runtimeSpec.moduleId}`);
  }
  const spec = {
    ...runtimeSpec,
    packageName: lockedModule.packageName,
    repository: lockedModule.repository,
    sourceCommit: lockedModule.sourceCommit,
  };
  return {
    spec,
    source: resolveManifestSource(spec),
    artifact: resolveLockedArtifact(lockedModule),
  };
});
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
hashInput('platform-lock', fs.readFileSync(platformLockPath));
hashInput('runtime-host-manifest', fs.readFileSync(runtimeHostManifestPath));
hashInput('dsh-upstream-registry', fs.readFileSync(dshUpstreamRegistryPath));
hashInput('runtime-artifact-mode', Buffer.from(runtimeArtifactMode));
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
for (const { spec, artifact } of bundledPackages) {
  hashInput(`${spec.packageName}:packed-artifact`, fs.readFileSync(artifact));
}
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
    repository: spec.repository,
    sourceCommit: spec.sourceCommit,
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
  const artifactDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'hermit-dsh-artifacts-'));

  try {
    const packedArtifacts = packRuntimePackages(buildPackages, artifactDirectory);
    for (const { spec, artifact } of bundledPackages) {
      packedArtifacts.set(spec.packageName, artifact);
    }
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
    for (const { packageName } of runtimePackages) {
      materializePackedPackage(target, packageName, packedArtifacts.get(packageName));
    }
    assertRuntimePackageContents(target);
    // patch source 固定来自已经 materialize 的 Product Surface package，避免再次从 workspace
    // 覆盖 tarball 内容。
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
        nodeVersion: nodeRuntimeManifest.version,
        pnpmVersion: pnpmPackage.version,
        platform: process.platform,
        architecture: process.arch,
        inputSha256,
        runtimePackages: runtimePackageEvidence.map((entry) => ({
          ...entry,
          packedArtifactSha256: sha256File(packedArtifacts.get(entry.packageName)),
        })),
        productSurfacePatch,
        foregroundSessionNavigationPatch,
      }, null, 2) + '\n',
    );
  } finally {
    fs.rmSync(artifactDirectory, { recursive: true, force: true });
  }
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
    const packageContentEvidence = manifest.runtimePackages.map(({ packedArtifactSha256: _packed, ...entry }) => entry);
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

function packRuntimePackages(packages, artifactDirectory) {
  const artifacts = new Map();
  for (const { packageName } of packages) {
    const before = new Set(fs.readdirSync(artifactDirectory));
    const result = spawnSync(
      bundledNode,
      [pnpmCli, '--filter', packageName, 'pack', '--pack-destination', artifactDirectory],
      { cwd: repositoryRoot, env: { ...process.env, CI: 'true' }, stdio: 'inherit' },
    );
    if (result.error !== undefined) throw result.error;
    if (result.status !== 0) throw new Error(`Failed to pack runtime package ${packageName}`);
    const produced = fs.readdirSync(artifactDirectory)
      .filter((name) => name.endsWith('.tgz') && !before.has(name));
    if (produced.length !== 1) {
      throw new Error(`Runtime package must produce one tarball: ${packageName}`);
    }
    artifacts.set(packageName, path.join(artifactDirectory, produced[0]));
  }
  return artifacts;
}

function sha256File(file) {
  if (typeof file !== 'string' || !fs.existsSync(file)) {
    throw new Error('无法计算缺失的 packed runtime 制品摘要');
  }
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function materializePackedPackage(runtimeRoot, packageName, artifact) {
  if (typeof artifact !== 'string' || !fs.existsSync(artifact)) {
    throw new Error(`Runtime package tarball is missing: ${packageName}`);
  }
  const extractionRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hermit-dsh-package-'));
  try {
    const extraction = spawnSync('tar', ['-xzf', artifact, '-C', extractionRoot], {
      encoding: 'utf8',
      windowsHide: true,
    });
    if (extraction.error !== undefined) throw extraction.error;
    if (extraction.status !== 0) {
      throw new Error(`无法解压 runtime package ${packageName}：${extraction.stderr ?? ''}`.trim());
    }
    const packedRoot = path.join(extractionRoot, 'package');
    if (!fs.existsSync(path.join(packedRoot, 'package.json'))) {
      throw new Error(`runtime package tarball 缺少 package/package.json：${packageName}`);
    }
    const targetRoot = path.join(runtimeRoot, 'node_modules', ...packageName.split('/'));
    if (!targetRoot.startsWith(`${path.resolve(runtimeRoot)}${path.sep}`)) {
      throw new Error(`runtime package path escapes closure: ${packageName}`);
    }
    fs.rmSync(targetRoot, { recursive: true, force: true });
    fs.cpSync(packedRoot, targetRoot, { recursive: true, dereference: true });
  } finally {
    fs.rmSync(extractionRoot, { recursive: true, force: true });
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
    // pack 会按 package.json#files 过滤源码（例如不发布 d.ts.map）；比较 tarball 实际
    // 携带的相对路径，避免把合法的发布过滤误判成制品损坏。
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
  if (manifest?.schemaVersion !== 3) throw new Error('DSH 运行时清单 schemaVersion 必须为 3');
  const productSurfacePackage = validateManifestPackage(manifest.productSurfacePackage, 'productSurfacePackage');
  const declaredBundledPackages = manifest.bundledPackages;
  if (!Array.isArray(declaredBundledPackages) || declaredBundledPackages.length === 0) {
    throw new Error('DSH 运行时清单必须列出至少一个 bundledPackages 项');
  }
  const bundledPackages = declaredBundledPackages.map((spec, index) => (
    validateRuntimeModule(spec, `bundledPackages[${index}]`)
  ));
  const moduleIds = new Set();
  for (const spec of bundledPackages) {
    if (moduleIds.has(spec.moduleId)) throw new Error(`DSH 运行时清单包含重复 moduleId：${spec.moduleId}`);
    moduleIds.add(spec.moduleId);
  }
  return { schemaVersion: 3, productSurfacePackage, bundledPackages };
}

function validateRuntimeModule(spec, label) {
  if (spec === null || typeof spec !== 'object') throw new Error(`${label} 必须是对象`);
  if (typeof spec.moduleId !== 'string' || spec.moduleId.length === 0) {
    throw new Error(`${label}.moduleId 必须是非空字符串`);
  }
  for (const field of ['packageName', 'repository', 'sourceCommit', 'version', 'artifact', 'artifactSha256']) {
    if (spec[field] !== undefined) throw new Error(`${label}.${field} 统一由 platform-lock 负责`);
  }
  const validated = validateManifestPackage({ ...spec, packageName: `platform-module:${spec.moduleId}` }, label);
  return {
    moduleId: spec.moduleId,
    source: validated.source,
    hashPaths: validated.hashPaths,
  };
}

function readPlatformLock(file) {
  let value;
  try {
    value = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (cause) {
    throw new Error(`无法读取 platform-lock：${cause instanceof Error ? cause.message : String(cause)}`);
  }
  if (value?.schemaVersion !== 1 || value.kind !== 'platform-lock' || !Array.isArray(value.modules)) {
    throw new Error('platform-lock schema 无效');
  }
  const modulesById = new Map();
  for (const module of value.modules) {
    if (
      typeof module?.id !== 'string' ||
      typeof module.packageName !== 'string' ||
      typeof module.repository !== 'string' ||
      typeof module.sourceCommit !== 'string' ||
      typeof module.artifact?.path !== 'string' ||
      typeof module.artifact?.sha256 !== 'string'
    ) {
      throw new Error('platform-lock module 缺少 runtime 所需字段');
    }
    if (modulesById.has(module.id)) throw new Error(`platform-lock moduleId 重复：${module.id}`);
    modulesById.set(module.id, module);
  }
  return { modulesById };
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
  if (spec.artifact !== undefined && (typeof spec.artifact !== 'string' || spec.artifact.length === 0)) {
    throw new Error(`${label}.artifact 必须是非空字符串`);
  }
  if (
    spec.artifactSha256 !== undefined &&
    (typeof spec.artifactSha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(spec.artifactSha256))
  ) {
    throw new Error(`${label}.artifactSha256 必须是 SHA-256`);
  }
  if ((spec.artifact === undefined) !== (spec.artifactSha256 === undefined)) {
    throw new Error(`${label}.artifact 和 artifactSha256 必须同时声明`);
  }
  if (
    spec.repository !== undefined &&
    (typeof spec.repository !== 'string' || spec.repository.length === 0)
  ) {
    throw new Error(`${label}.repository 必须是非空字符串`);
  }
  if (
    spec.sourceCommit !== undefined &&
    (typeof spec.sourceCommit !== 'string' || !/^[a-f0-9]{40}$/u.test(spec.sourceCommit))
  ) {
    throw new Error(`${label}.sourceCommit 必须是完整 Git commit`);
  }
  if ((spec.repository === undefined) !== (spec.sourceCommit === undefined)) {
    throw new Error(`${label}.repository 和 sourceCommit 必须同时声明`);
  }
  return {
    packageName: spec.packageName,
    ...(spec.repository === undefined ? {} : { repository: spec.repository }),
    ...(spec.sourceCommit === undefined ? {} : { sourceCommit: spec.sourceCommit }),
    source: spec.source,
    hashPaths: [...spec.hashPaths],
    ...(spec.artifact === undefined ? {} : { artifact: spec.artifact }),
    ...(spec.artifactSha256 === undefined ? {} : { artifactSha256: spec.artifactSha256 }),
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

function resolveLockedArtifact(module) {
  if (!/^[a-f0-9]{64}$/u.test(module.artifact.sha256)) {
    throw new Error(`platform-lock artifact.sha256 无效：${module.packageName}`);
  }
  const declaredArtifact = path.resolve(repositoryRoot, module.artifact.path);
  if (!declaredArtifact.startsWith(`${repositoryRoot}${path.sep}`) || !fs.existsSync(declaredArtifact)) {
    throw new Error(`platform-lock artifact 无效：${module.artifact.path}`);
  }
  const artifact = fs.realpathSync(declaredArtifact);
  if (!artifact.startsWith(`${repositoryRoot}${path.sep}`)) {
    throw new Error(`platform-lock artifact 解析后越界：${module.artifact.path}`);
  }
  if (sha256File(artifact) !== module.artifact.sha256) {
    throw new Error(`platform-lock artifact 摘要不一致：${module.packageName}`);
  }
  return artifact;
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
