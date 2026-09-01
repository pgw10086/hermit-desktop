import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const output = path.join(packageRoot, 'build', 'Release', 'hermit_macos_clipboard_bridge.node')
const packageDirectory = path.join(packageRoot, 'build', 'package')
fs.rmSync(packageDirectory, { recursive: true, force: true })
if (process.platform !== 'darwin') {
  fs.mkdirSync(packageDirectory, { recursive: true })
  console.log(`macOS native bridge skipped on ${process.platform}`)
  process.exit(0)
}
if (process.arch !== 'arm64') throw new Error(`macOS native bridge requires arm64, received ${process.arch}`)

const require = createRequire(import.meta.url)
const electronVersion = JSON.parse(fs.readFileSync(require.resolve('electron/package.json'), 'utf8')).version
if (!electronVersion.startsWith('43.')) throw new Error(`Expected Electron 43.x headers, received ${electronVersion}`)
const nodeGyp = require.resolve('node-gyp/bin/node-gyp.js')
const repositoryRoot = path.resolve(packageRoot, '..', '..')
const devDir = path.join(repositoryRoot, '.hermit', 'cache', 'node-gyp')
fs.mkdirSync(devDir, { recursive: true })

run(process.execPath, [
  nodeGyp,
  'rebuild',
  `--target=${electronVersion}`,
  '--arch=arm64',
  '--dist-url=https://electronjs.org/headers',
  '--napi_build_version=8',
  `--devdir=${devDir}`,
])
if (!fs.existsSync(output)) throw new Error(`native bridge output missing: ${output}`)
const architectures = run('/usr/bin/lipo', ['-archs', output]).trim().split(/\s+/u)
if (architectures.length !== 1 || architectures[0] !== 'arm64') {
  throw new Error(`native bridge must contain only arm64, received ${architectures.join(', ')}`)
}
const digest = createHash('sha256').update(fs.readFileSync(output)).digest('hex')
fs.mkdirSync(packageDirectory, { recursive: true })
const manifest = {
  schemaVersion: 1,
  electronVersion,
  napiVersion: 8,
  architecture: 'arm64',
  sha256: digest,
}
fs.writeFileSync(path.join(packageRoot, 'build', 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
fs.copyFileSync(output, path.join(packageDirectory, 'hermit_macos_clipboard_bridge.node'))
fs.writeFileSync(path.join(packageDirectory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
console.log(`Built macOS clipboard bridge for Electron ${electronVersion}: ${digest}`)

function run(command, args) {
  const result = spawnSync(command, args, { cwd: packageRoot, env: process.env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) throw new Error(`${command} failed (${String(result.status)}):\n${result.stdout}${result.stderr}`)
  return result.stdout
}
