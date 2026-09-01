import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'

export interface BundledPluginProfileOptions {
  /** 要安装或核对的插件 package name。 */
  readonly packageName: string
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

/** 将随 Hermit 发布的插件接入 DSH web profile，并区分用户停用、卸载和制品刷新。 */
export function ensureBundledPluginProfile(options: BundledPluginProfileOptions): BundledPluginProfileResult {
  if (!fs.existsSync(options.pluginPath)) throw new Error(`${options.packageName} 制品不存在：${options.pluginPath}`)
  assertProductPlugin(options.pluginPath, options.packageName)
  fs.mkdirSync(options.profileHome, { recursive: true, mode: 0o700 })
  const profilePath = path.join(options.profileHome, 'profiles', 'web', 'package.json')
  const markerPath = path.join(options.profileHome, 'hermit-managed', `${options.markerName}.json`)
  const registration = readRegistration(profilePath, options.packageName)
  const managedBefore = readManagedMarker(markerPath, options.packageName)
  if (registration.dependency && !registration.active) {
    writeManagedMarker(markerPath, options.packageName)
    return { state: 'disabled', artifactUpdated: false }
  }
  if (!registration.dependency && managedBefore) return { state: 'uninstalled', artifactUpdated: false }
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
  if (!fs.existsSync(profilePath)) return { dependency: false, active: false }
  let profile: { readonly dependencies?: Record<string, unknown>; readonly dsh?: { readonly profile?: { readonly bundles?: unknown } } }
  try { profile = JSON.parse(fs.readFileSync(profilePath, 'utf8')) as typeof profile } catch (cause) { throw new Error(`DSH web profile 无法读取：${cause instanceof Error ? cause.message : String(cause)}`) }
  const dependency = typeof profile.dependencies?.[packageName] === 'string'
  const bundles = profile.dsh?.profile?.bundles
  const active = Array.isArray(bundles) && bundles.includes(packageName)
  if (active && !dependency) throw new Error(`DSH web profile 中 ${packageName} 已激活但依赖缺失`)
  return { dependency, active }
}

/** 比较 profile 实际安装包与当前制品的内容摘要。 */
function isCurrentArtifact(profilePath: string, pluginPath: string, packageName: string): boolean {
  try { const installedManifest = createRequire(profilePath).resolve(`${packageName}/package.json`); return artifactDigest(path.dirname(installedManifest)) === artifactDigest(pluginPath) } catch { return false }
}

/** 读取 Hermit 管理标记并校验其 package 身份。 */
function readManagedMarker(markerPath: string, packageName: string): boolean {
  if (!fs.existsSync(markerPath)) return false
  try { const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8')) as { readonly schemaVersion?: unknown; readonly packageName?: unknown }; if (marker.schemaVersion !== 1 || marker.packageName !== packageName) throw new Error('字段不符合 schema'); return true } catch (cause) { throw new Error(`${packageName} 受管状态损坏：${cause instanceof Error ? cause.message : String(cause)}`) }
}

/** 写入受限权限的 Hermit 管理标记。 */
function writeManagedMarker(markerPath: string, packageName: string): void {
  if (readManagedMarker(markerPath, packageName)) return
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
