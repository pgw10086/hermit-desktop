import { readFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { transform } from 'lightningcss'
import { defineConfig } from 'tsdown'

const CSS_PREFIX = '\0hermit-quick-retrieval-css:'
const CSS_SUFFIX = '.mjs'

export default defineConfig({
  name: '@hermit/desktop/quick-retrieval',
  entry: { renderer: 'src/quick-retrieval/main.tsx' },
  tsconfig: 'tsconfig.quick-retrieval.json',
  outDir: 'lib/quick-retrieval',
  format: 'iife',
  platform: 'browser',
  target: 'es2024',
  clean: false,
  sourcemap: true,
  minify: true,
  deps: {
    // 该 renderer 运行在独立 BrowserWindow 中，没有 DSH 提供的 React 实例。
    onlyBundle: false,
    alwaysBundle: () => true,
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  plugins: [{
    name: 'hermit-quick-retrieval-css-modules-inline',
    resolveId(source: string, importer: string | undefined) {
      if (!source.endsWith('.module.css')) return null
      const file = importer === undefined ? source : resolve(importer, '..', source)
      return CSS_PREFIX + file + CSS_SUFFIX
    },
    async load(id: string) {
      if (!id.startsWith(CSS_PREFIX)) return null
      const file = id.slice(CSS_PREFIX.length, -CSS_SUFFIX.length)
      this.addWatchFile(file)
      const source = await readFile(file)
      const { code, exports } = transform({
        filename: file,
        code: source,
        cssModules: { pattern: '[hash]_[local]' },
        minify: true,
      })
      const classes = Object.fromEntries(
        Object.entries(exports ?? {}).map(([name, value]) => [name, value.name]),
      )
      const tagId = `@hermit/desktop/${basename(file)}`
      return [
        `const css = ${JSON.stringify(code.toString())};`,
        `const tagId = ${JSON.stringify(tagId)};`,
        "if (document.querySelector('style[data-desktop-css=' + JSON.stringify(tagId) + ']') === null) {",
        "  const tag = document.createElement('style');",
        '  tag.dataset.desktopCss = tagId;',
        '  tag.textContent = css;',
        '  document.head.appendChild(tag);',
        '}',
        `export default ${JSON.stringify(classes)};`,
      ].join('\n')
    },
  }],
  outputOptions: {
    entryFileNames: 'renderer.js',
  },
})
