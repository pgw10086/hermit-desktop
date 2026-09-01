import fs from 'node:fs'

fs.rmSync(new URL('../lib', import.meta.url), { recursive: true, force: true })
