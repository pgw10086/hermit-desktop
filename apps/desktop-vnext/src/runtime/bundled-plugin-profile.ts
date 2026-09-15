import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'

export interface BundledPluginProfileOptions {
  /** 要安装或核对的插件 package name。 */
  readonly packageName: string
  /** 需要在 DSH 启动前迁移掉的历史 package name。 */
  readonly legacyPackageNames?: readonly string[]
  /** Hermit 管理标记文件名。 */
  readonly markerName: string
  /** 执行 DSH CLI 的 Node 路径。 */
  readonly nodeBinary: string
  /** DSH CLI 入口。 */
  readonly dshEntry: string
  /** DSH web profile 所在目录。 */
  readonly profileHome: string
  /** 当前候选插件制品路径。 */
  readonly pluginPath: string
  /** 受限的 CLI 环境。 */
  readonly environment: NodeJS.ProcessEnv
}

export interface BundledPluginProfileResult {
  /** profile 中插件的最终状态。 */
  readonly state: 'active' | 'disabled' | 'uninstalled'
  /** 本次是否更新了安装制品。 */
  readonly artifactUpdated: boolean
}

interface ProductPluginManifest {
  readonly name?: unknown
  readonly hermit?: { readonly type?: unknown }
}

interface ProfileManifest {
  readonly name?: unknown
  readonly dependencies?: Record<string, unknown>
  readonly dsh?: { readonly profile?: { readonly bundles?: unknown } }
}

interface ManagedMarker {
  readonly schemaVersion?: unknown
  readonly packageName?: unknown
}

type LegacyMigrationState = 'active' | 'disabled' | 'uninstalled'

export interface LegacyPluginProfileMigration {
  readonly packageName: string
  readonly markerName: string
  readonly legacyPackageNames: readonly string[]
}

/** 将随 Hermit 发布的插件接入 DSH web profile，并区分用户停用、卸载和制品刷新。 */
export function ensureBundledPluginProfile(options: BundledPluginProfileOptions): BundledPluginProfileResult {
  if (!fs.existsSync(options.pluginPath)) throw new Error(`${options.packageName} 制品不存在：${options.pluginPath}`)
  assertProductPlugin(options.pluginPath, options.packageName)
  fs.mkdirSync(options.profileHome, { recursive: true, mode: 0o700 })
  const profilePath = path.join(options.profileHome, 'profiles', 'web', 'package.json')
  const markerPath = path.join(options.profileHome, 'hermit-managed', `${options.markerName}.json`)
  const legacyMigration = migrateLegacyProfile({
    profilePath,
    markerPath,
    packageName: options.packageName,
    legacyPackageNames: options.legacyPackageNames ?? [],
  })
  const registration = readRegistration(profilePath, options.packageName)
  const managedBefore = readManagedMarker(markerPath, options.packageName)
  if (legacyMigration?.state === 'disabled') {
    writeManagedMarker(markerPath, options.packageName)
    return { state: 'disabled', artifactUpdated: false }
  }
  if (legacyMigration?.state === 'uninstalled') {
    writeManagedMarker(markerPath, options.packageName)
    return { state: 'uninstalled', artifactUpdated: false }
  }
  if (registration.dependency && !registration.active) {
    writeManagedMarker(markerPath, options.packageName)
    return { state: 'disabled', artifactUpdated: false }
  }
  if (!registration.dependency && managedBefore && legacyMigration?.state !== 'active') {
    return { state: 'uninstalled', artifactUpdated: false }
  }
  if (registration.active && isCurrentArtifact(profilePath, options.pluginPath, options.packageName)) {
    writeManagedMarker(markerPath, options.packageName)
    return { state: 'active', artifactUpdated: false }
  }
  const result = spawnSync(options.nodeBinary, [options.dshEntry, 'plugin', '--profile', 'web', 'add', '--force', options.pluginPath], { cwd: options.profileHome, env: options.environment, encoding: 'utf8', windowsHide: true })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim()
    throw new Error(`${options.packageName} 制品安装失败${output.length === 0 ? '' : `：${output}`}`)
  }
  if (!readRegistration(profilePath, options.packageName).active) throw new Error(`${options.packageName} 安装命令成功但 profile 未登记插件`)
  if (!isCurrentArtifact(profilePath, options.pluginPath, options.packageName)) throw new Error(`${options.packageName} 安装命令成功但 profile 未使用当前随包制品`)
  writeManagedMarker(markerPath, options.packageName)
  return { state: 'active', artifactUpdated: registration.active }
}

/** 在任何插件重新登记前一次性迁移所有历史 scope，避免 DSH CLI 先清掉其他旧 bundle。 */
export function migrateLegacyPluginProfiles(
  profileHome: string,
  migrations: readonly LegacyPluginProfileMigration[],
): ReadonlyMap<string, LegacyMigrationState> {
  const profilePath = path.join(profileHome, 'profiles', 'web', 'package.json')
  const states = new Map<string, LegacyMigrationState>()
  for (const migration of migrations) {
    const result = migrateLegacyProfile({
      profilePath,
      markerPath: path.join(profileHome, 'hermit-managed', `${migration.markerName}.json`),
      packageName: migration.packageName,
      legacyPackageNames: migration.legacyPackageNames,
    })
    if (result !== undefined) states.set(migration.packageName, result.state)
  }
  return states
}

/** 一次性安装迁移后仍处于 active 的插件，避免 pnpm reconcile 先移除其他旧 bundle。 */
export function installBundledPluginProfiles({
  nodeBinary,
  dshEntry,
  profileHome,
  environment,
  pluginPaths,
}: {
  readonly nodeBinary: string
  readonly dshEntry: string
  readonly profileHome: string
  readonly environment: NodeJS.ProcessEnv
  readonly pluginPaths: readonly string[]
}): void {
  if (pluginPaths.length === 0) return
  const result = spawnSync(
    nodeBinary,
    [dshEntry, 'plugin', '--profile', 'web', 'add', '--force', ...pluginPaths],
    { cwd: profileHome, env: environment, encoding: 'utf8', windowsHide: true },
  )
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim()
    throw new Error(`迁移后的插件制品批量安装失败${output.length === 0 ? '' : `：${output}`}`)
  }
}

/** 在 DSH 启动前清理旧 package scope，避免历史 bundle 名称让新 runtime 直接退出。 */
function migrateLegacyProfile({
  profilePath,
  markerPath,
  packageName,
  legacyPackageNames,
}: {
  readonly profilePath: string
  readonly markerPath: string
  readonly packageName: string
  readonly legacyPackageNames: readonly string[]
}): { readonly state: LegacyMigrationState } | undefined {
  if (legacyPackageNames.length === 0) return undefined
  const profile = readProfileManifest(profilePath)
  const marker = readManagedMarkerRecord(markerPath)
  if (marker !== undefined && marker.schemaVersion !== 1) {
    throw new Error(`${packageName} 受管状态损坏：字段不符合 schema`)
  }
  const markerPackageName = typeof marker?.packageName === 'string' ? marker.packageName : undefined
  if (
    markerPackageName !== undefined &&
    markerPackageName !== packageName &&
    !legacyPackageNames.includes(markerPackageName)
  ) {
    throw new Error(`${packageName} 受管状态损坏：packageName 不匹配`)
  }
  if (profile === undefined && markerPackageName !== undefined && legacyPackageNames.includes(markerPackageName)) {
    writeManagedMarkerFile(markerPath, packageName)
    return { state: 'uninstalled' }
  }
  if (profile === undefined) return undefined

  const dependencies = { ...(profile.dependencies ?? {}) }
  const bundles = Array.isArray(profile.dsh?.profile?.bundles)
    ? [...profile.dsh.profile.bundles]
    : []
  const legacyPackageName = legacyPackageNames.find((name) =>
    Object.hasOwn(dependencies, name) || bundles.includes(name),
  )
  if (legacyPackageName === undefined) {
    if (markerPackageName !== undefined && legacyPackageNames.includes(markerPackageName)) {
      writeManagedMarkerFile(markerPath, packageName)
      return { state: 'uninstalled' }
    }
    return undefined
  }

  const dependency = typeof dependencies[legacyPackageName] === 'string'
  const active = bundles.includes(legacyPackageName)
  if (active && !dependency) {
    throw new Error(`DSH web profile 中历史插件 ${legacyPackageName} 已激活但依赖缺失`)
  }
  if (!Object.hasOwn(dependencies, packageName) && dependency) {
    dependencies[packageName] = dependencies[legacyPackageName]
  }
  delete dependencies[legacyPackageName]
  const nextBundles: unknown[] = []
  for (const name of bundles) {
    const nextName = name === legacyPackageName ? packageName : name
    if (!nextBundles.includes(nextName)) nextBundles.push(nextName)
  }
  writeProfileManifest(profilePath, {
    ...profile,
    ...(Object.keys(dependencies).length === 0 ? { dependencies: {} } : { dependencies }),
    dsh: {
      ...profile.dsh,
      profile: {
        ...profile.dsh?.profile,
        bundles: nextBundles,
      },
    },
  })
  writeManagedMarkerFile(markerPath, packageName)
  return { state: active ? 'active' : dependency ? 'disabled' : 'uninstalled' }
}

/** 在进入 DSH Profile 前校验制品身份，避免把普通目录或错误插件当成 Product Plugin。 */
function assertProductPlugin(pluginPath: string, packageName: string): void {
  const manifestPath = path.join(pluginPath, 'package.json')
  let manifest: ProductPluginManifest
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as ProductPluginManifest
  } catch (cause) {
    throw new Error(`${packageName} manifest 无法读取：${cause instanceof Error ? cause.message : String(cause)}`)
  }
  if (manifest.name !== packageName || manifest.hermit?.type !== 'product-plugin') {
    throw new Error(`${packageName} manifest 不是受支持的 Product Plugin`)
  }
}

/** 读取 profile 依赖和激活状态，并拒绝 active 但缺失依赖的异常组合。 */
function readRegistration(profilePath: string, packageName: string): { readonly dependency: boolean; readonly active: boolean } {
  const profile = readProfileManifest(profilePath)
  if (profile === undefined) return { dependency: false, active: false }
  const dependency = typeof profile.dependencies?.[packageName] === 'string'
  const bundles = profile.dsh?.profile?.bundles
  const active = Array.isArray(bundles) && bundles.includes(packageName)
  if (active && !dependency) throw new Error(`DSH web profile 中 ${packageName} 已激活但依赖缺失`)
  return { dependency, active }
}

/** 读取 DSH profile manifest；损坏时保留明确的启动边界错误。 */
function readProfileManifest(profilePath: string): ProfileManifest | undefined {
  if (!fs.existsSync(profilePath)) return undefined
  try {
    return JSON.parse(fs.readFileSync(profilePath, 'utf8')) as ProfileManifest
  } catch (cause) {
    throw new Error(`DSH web profile 无法读取：${cause instanceof Error ? cause.message : String(cause)}`)
  }
}

/** 以原子替换写回 profile manifest，避免迁移中断留下半份 JSON。 */
function writeProfileManifest(profilePath: string, profile: ProfileManifest): void {
  const temporaryPath = `${profilePath}.${process.pid}.${Date.now()}.tmp`
  try {
    fs.writeFileSync(temporaryPath, `${JSON.stringify(profile, null, 2)}\n`, 'utf8')
    fs.renameSync(temporaryPath, profilePath)
  } finally {
    if (fs.existsSync(temporaryPath)) fs.rmSync(temporaryPath, { force: true })
  }
}

/** 比较 profile 实际安装包与当前制品的内容摘要。 */
function isCurrentArtifact(profilePath: string, pluginPath: string, packageName: string): boolean {
  try { const installedManifest = createRequire(profilePath).resolve(`${packageName}/package.json`); return artifactDigest(path.dirname(installedManifest)) === artifactDigest(pluginPath) } catch { return false }
}

/** 读取 Hermit 管理标记并校验其 package 身份。 */
function readManagedMarker(markerPath: string, packageName: string): boolean {
  const marker = readManagedMarkerRecord(markerPath)
  if (marker === undefined) return false
  try {
    if (marker.schemaVersion !== 1 || marker.packageName !== packageName) throw new Error('字段不符合 schema')
    return true
  } catch (cause) {
    throw new Error(`${packageName} 受管状态损坏：${cause instanceof Error ? cause.message : String(cause)}`)
  }
}

/** 读取受管 marker 原始字段，供 scope 迁移判断历史身份。 */
function readManagedMarkerRecord(markerPath: string): ManagedMarker | undefined {
  if (!fs.existsSync(markerPath)) return undefined
  try {
    return JSON.parse(fs.readFileSync(markerPath, 'utf8')) as ManagedMarker
  } catch (cause) {
    throw new Error(`受管状态无法读取：${cause instanceof Error ? cause.message : String(cause)}`)
  }
}

/** 写入受限权限的 Hermit 管理标记。 */
function writeManagedMarker(markerPath: string, packageName: string): void {
  if (readManagedMarker(markerPath, packageName)) return
  writeManagedMarkerFile(markerPath, packageName)
}

/** 写入 marker 文件；调用方已完成 package 身份校验时可直接替换历史 scope。 */
function writeManagedMarkerFile(markerPath: string, packageName: string): void {
  fs.mkdirSync(path.dirname(markerPath), { recursive: true, mode: 0o700 })
  fs.writeFileSync(markerPath, `${JSON.stringify({ schemaVersion: 1, packageName }, null, 2)}\n`, { mode: 0o600 })
}

/** 对插件 manifest、patch 和 lib 文件生成确定性制品摘要。 */
function artifactDigest(packageRoot: string): string {
  const hash = createHash('sha256')
  for (const file of artifactFiles(packageRoot)) { hash.update(path.relative(packageRoot, file)); hash.update('\0'); hash.update(fs.readFileSync(file)); hash.update('\0') }
  return hash.digest('hex')
}

/** 收集参与制品摘要的文件。 */
function artifactFiles(packageRoot: string): readonly string[] {
  const files = ['package.json', 'cordis.patch.yml'].map((relative) => path.join(packageRoot, relative)).filter((file) => fs.existsSync(file))
  const libRoot = path.join(packageRoot, 'lib')
  if (fs.existsSync(libRoot)) collectFiles(libRoot, files)
  return files.sort()
}

/** 递归收集构建产物文件。 */
function collectFiles(directory: string, files: string[]): void {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) { const target = path.join(directory, entry.name); if (entry.isDirectory()) collectFiles(target, files); else if (entry.isFile()) files.push(target) }
}
