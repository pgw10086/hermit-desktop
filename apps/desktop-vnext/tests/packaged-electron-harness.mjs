import { createRequire } from 'node:module'
import path from 'node:path'

const require = createRequire(import.meta.url)
const loaderPath = path.join(
  path.dirname(require.resolve('playwright-core')),
  'lib',
  'server',
  'electron',
  'loader.js',
)

/** 已打包 Electron 需要显式开启 Playwright 主进程握手；正式包不会设置这个变量。 */
export function packagedElectronTestEnvironment(extra = {}) {
  return { ...process.env, ...extra, HERMIT_PLAYWRIGHT_LOADER: loaderPath }
}
