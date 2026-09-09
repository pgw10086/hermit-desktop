import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

/** Product Surface 验收必须使用 Product Desktop 锁定的同一份 tarball。 */
export function lockedPlatformArtifact(repositoryRoot, moduleId) {
  const lock = JSON.parse(fs.readFileSync(path.join(repositoryRoot, 'platform-lock.json'), 'utf8'))
  const module = lock.modules?.find((entry) => entry.id === moduleId)
  if (module === undefined || typeof module.artifact?.path !== 'string') {
    throw new Error(`platform-lock 没有声明模块制品：${moduleId}`)
  }
  const artifact = path.resolve(repositoryRoot, module.artifact.path)
  if (!artifact.startsWith(`${repositoryRoot}${path.sep}`) || !fs.existsSync(artifact)) {
    throw new Error(`platform-lock 模块制品缺失或越界：${moduleId}`)
  }
  const sha256 = createHash('sha256').update(fs.readFileSync(artifact)).digest('hex')
  if (sha256 !== module.artifact.sha256) {
    throw new Error(`platform-lock 模块制品摘要不一致：${moduleId}`)
  }
  return artifact
}
