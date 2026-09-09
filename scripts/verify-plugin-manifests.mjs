import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const runtimeManifestPath = path.join(root, 'apps', 'desktop-vnext', 'runtime-bundle-manifest.json')
const platformLockPath = path.join(root, 'platform-lock.json')
const knownDesktopCapabilities = new Set([
  'system-clipboard',
  'global-shortcut',
  'quick-surface',
  'focus-restore',
  'notification',
])
const failures = []

const runtimeManifest = JSON.parse(fs.readFileSync(runtimeManifestPath, 'utf8'))
const platformLock = JSON.parse(fs.readFileSync(platformLockPath, 'utf8'))
const modulesById = new Map((platformLock.modules ?? []).map((module) => [module.id, module]))
for (const spec of runtimeManifest.bundledPackages ?? []) {
  const lockedModule = modulesById.get(spec.moduleId)
  if (lockedModule === undefined) {
    failures.push(`${String(spec.moduleId)}: runtime 清单引用了 platform-lock 中不存在的模块`)
    continue
  }
  const packageRoot = path.resolve(root, spec.source)
  const packagePath = path.join(packageRoot, 'package.json')
  if (!packageRoot.startsWith(`${root}${path.sep}`) || !fs.existsSync(packagePath)) {
    failures.push(`${lockedModule.packageName}: runtime 清单指向缺失或越界的插件制品`)
    continue
  }
  const relative = path.relative(root, packagePath)
  let manifest
  try {
    manifest = JSON.parse(fs.readFileSync(packagePath, 'utf8'))
  } catch (cause) {
    failures.push(`${relative}: package.json 无法解析：${cause instanceof Error ? cause.message : String(cause)}`)
    continue
  }
  if (manifest.hermit?.type !== 'product-plugin') {
    failures.push(`${relative}: 缺少 hermit.type=product-plugin`)
  }
  if (manifest.name !== lockedModule.packageName) {
    failures.push(`${relative}: package name 与 platform-lock 不一致`)
  }
  const capabilities = manifest.hermit?.desktop?.capabilities
  if (capabilities === undefined) continue
  if (!Array.isArray(capabilities) || new Set(capabilities).size !== capabilities.length) {
    failures.push(`${relative}: hermit.desktop.capabilities 必须是无重复数组`)
    continue
  }
  for (const capability of capabilities) {
    if (typeof capability !== 'string' || !knownDesktopCapabilities.has(capability)) {
      failures.push(`${relative}: 未知 Desktop capability：${String(capability)}`)
    }
  }
}

if (failures.length > 0) {
  console.error('Product Plugin manifest check failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('Product Plugin manifest check passed.')
