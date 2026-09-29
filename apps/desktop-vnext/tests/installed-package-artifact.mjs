import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

/** 从当前 frozen install 的 node_modules 生成临时 package tarball，供 stock DSH 资格测试安装。 */
export function packInstalledPackage({ repositoryRoot, packageName, outputDirectory }) {
  const packageRoot = path.join(
    repositoryRoot,
    'apps',
    'desktop-vnext',
    'node_modules',
    ...packageName.split('/'),
  )
  const packageManifest = path.join(packageRoot, 'package.json')
  if (!fs.existsSync(packageManifest)) throw new Error(`已安装 package 缺少 package.json：${packageName}`)
  const manifest = JSON.parse(fs.readFileSync(packageManifest, 'utf8'))
  if (manifest.name !== packageName) throw new Error(`已安装 package 名称不一致：${packageName}`)
  fs.mkdirSync(outputDirectory, { recursive: true })
  const command = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
  const result = spawnSync(command, ['pack', '--pack-destination', outputDirectory, '--json'], {
    cwd: packageRoot,
    encoding: 'utf8',
    windowsHide: true,
  })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) throw new Error(`pnpm pack failed for ${packageName}: ${result.stderr}`)
  const packed = JSON.parse(result.stdout)
  const filename = typeof packed.filename === 'string' ? packed.filename : undefined
  if (filename === undefined) throw new Error(`pnpm pack 没有返回 tarball：${packageName}`)
  const artifact = path.isAbsolute(filename) ? filename : path.join(outputDirectory, filename)
  if (!fs.existsSync(artifact)) throw new Error(`package tarball 不存在：${artifact}`)
  return artifact
}

/** 在隔离的 DSH runtime 副本中替换一个安装锚点 package，供本地候选包资格测试使用。 */
export function replaceRuntimePackage({ runtimeRoot, packageName, artifact, expectedVersion }) {
  const packageRoot = path.join(runtimeRoot, 'node_modules', ...packageName.split('/'))
  fs.rmSync(packageRoot, { recursive: true, force: true })
  fs.mkdirSync(packageRoot, { recursive: true })
  const result = spawnSync('tar', ['-xzf', artifact, '-C', packageRoot, '--strip-components=1'], {
    encoding: 'utf8',
    windowsHide: true,
  })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) throw new Error(`tar failed for ${packageName}: ${result.stderr ?? result.stdout ?? ''}`)
  const manifest = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'))
  if (manifest.name !== packageName) throw new Error(`runtime package 名称不一致：${packageName}`)
  if (expectedVersion !== undefined && manifest.version !== expectedVersion) {
    throw new Error(`runtime package 版本不一致：${packageName}@${manifest.version}，期望 ${expectedVersion}`)
  }
}
