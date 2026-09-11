import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const runtimeManifestPath = path.join(root, 'apps', 'desktop-vnext', 'runtime-bundle-manifest.json')
const knownDesktopCapabilities = new Set([
  'system-clipboard',
  'global-shortcut',
  'quick-surface',
  'focus-restore',
  'notification',
])
const failures = []

const runtimeManifest = JSON.parse(fs.readFileSync(runtimeManifestPath, 'utf8'))
if (runtimeManifest.schemaVersion !== 4) {
  failures.push(`runtime bundle manifest schemaVersion 必须为 4，收到 ${String(runtimeManifest.schemaVersion)}`)
}
for (const spec of runtimeManifest.bundledPackages ?? []) {
  if (typeof spec.packageName !== 'string' || spec.packageName.length === 0) {
    failures.push('runtime bundle manifest 缺少 packageName')
    continue
  }
  const packageRoot = path.resolve(root, spec.source)
  const packagePath = path.join(packageRoot, 'package.json')
  if (!packageRoot.startsWith(`${root}${path.sep}`) || !fs.existsSync(packagePath)) {
    failures.push(`${String(spec.packageName)}: runtime 清单指向缺失或越界的插件 package`)
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
  if (manifest.name !== spec.packageName) {
    failures.push(`${relative}: package name 与 runtime bundle manifest 不一致`)
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
