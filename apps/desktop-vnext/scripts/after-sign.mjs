import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

export default async function afterSign(context) {
  if (context.electronPlatformName !== 'darwin') return
  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  const addonPath = path.join(appPath, 'Contents', 'Resources', 'runtime', 'native', 'hermit_macos_clipboard_bridge.node')
  if (!fs.existsSync(addonPath)) throw new Error(`Signed app is missing macOS Clipboard bridge: ${addonPath}`)

  const appIdentity = identity(appPath)
  if (appIdentity === undefined) {
    console.log('Skipped native bridge signature verification because signing is SKIPPED')
    return
  }
  verify(addonPath)
  verify(appPath)
  const addonIdentity = identity(addonPath)
  if (addonIdentity !== appIdentity) {
    throw new Error(`macOS Clipboard bridge Team ID ${String(addonIdentity)} does not match app Team ID ${appIdentity}`)
  }
  console.log(`Verified signed macOS Clipboard bridge: TeamIdentifier=${appIdentity}`)
}

function identity(target) {
  const result = spawnSync('/usr/bin/codesign', ['-dv', '--verbose=4', target], { encoding: 'utf8' })
  if (result.status !== 0) return undefined
  const match = /^TeamIdentifier=(.+)$/mu.exec(`${result.stdout}\n${result.stderr}`)
  return match?.[1] === 'not set' ? undefined : match?.[1]
}

function verify(target) {
  const result = spawnSync('/usr/bin/codesign', ['--verify', '--strict', '--verbose=2', target], { encoding: 'utf8' })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) throw new Error(`codesign verification failed for ${target}: ${result.stderr}`)
}
