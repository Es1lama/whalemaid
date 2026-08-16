import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outfile = resolve(root, 'lib/client.js')
const result = await build({
  entryPoints: [resolve(root, 'src/client/index.ts')],
  bundle: true,
  write: false,
  platform: 'browser',
  format: 'cjs',
  target: 'es2022',
  jsx: 'automatic',
  loader: { '.css': 'text' },
  external: ['react', 'react/jsx-runtime', '@deepseek-ai/*'],
})

const bundled = result.outputFiles[0]?.text
if (bundled === undefined) throw new Error('client build produced no JavaScript output')
const wrapped = `window.__ModuleLoader__.load({\n  id: "@whalemaid/plugin",\n  factory: (require) => {\n    var module = { exports: {} };\n    var exports = module.exports;\n${bundled}\n    return module.exports;\n  },\n});\n`
await mkdir(dirname(outfile), { recursive: true })
await writeFile(outfile, wrapped, 'utf8')
