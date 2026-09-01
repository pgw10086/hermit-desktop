import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const appRoot = path.resolve(scriptDirectory, '..')
const assets = [
  ['src/desktop/smart-clipboard-preload.cjs', 'lib/desktop/smart-clipboard-preload.cjs'],
  ['src/quick-retrieval/index.html', 'lib/quick-retrieval/index.html'],
]

for (const [sourcePath, destinationPath] of assets) {
  const source = path.join(appRoot, sourcePath)
  const destination = path.join(appRoot, destinationPath)
  fs.mkdirSync(path.dirname(destination), { recursive: true })
  fs.copyFileSync(source, destination)
}
