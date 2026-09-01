import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
if (process.platform !== 'darwin') {
  console.log(`macOS native bridge tests skipped on ${process.platform}`)
  process.exit(0)
}

run(process.execPath, [path.join(packageRoot, 'scripts', 'build.mjs')])
const testBinary = path.join(packageRoot, 'build', 'pasteboard-tests')
run('/usr/bin/xcrun', [
  'clang++', '-std=c++20', '-fobjc-arc', '-fblocks',
  '-framework', 'Foundation', '-framework', 'AppKit', '-framework', 'ApplicationServices', '-framework', 'CoreGraphics',
  path.join(packageRoot, 'src', 'pasteboard.mm'),
  path.join(packageRoot, 'tests', 'pasteboard_test.mm'),
  '-o', testBinary,
])
run(testBinary, [])

const addonPath = path.join(packageRoot, 'build', 'Release', 'hermit_macos_clipboard_bridge.node')
const addon = createRequire(import.meta.url)(addonPath)
for (const name of ['readStableSnapshot', 'writeSnapshot', 'captureFrontmostApplication', 'requestActivate', 'postPasteIfCurrent']) {
  if (typeof addon[name] !== 'function') throw new Error(`native bridge export missing: ${name}`)
}
if (!fs.existsSync(path.join(packageRoot, 'build', 'manifest.json'))) throw new Error('native bridge manifest missing')
console.log('macOS native bridge passed: unique pasteboard semantics + N-API load')

function run(command, args) {
  const result = spawnSync(command, args, { cwd: packageRoot, env: process.env, encoding: 'utf8' })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) throw new Error(`${command} failed (${String(result.status)}):\n${result.stdout}${result.stderr}`)
  if (result.stdout.length > 0) process.stdout.write(result.stdout)
}
