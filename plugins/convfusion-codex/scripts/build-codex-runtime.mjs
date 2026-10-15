import { writeBundleNotices } from './lib/bundle-notices.mjs'
/** Bundle runtime dependencies while preserving every module's package-relative resource paths. */
import { build } from 'esbuild'
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'lib/codex-mcp.mjs')
await build({
  absWorkingDir: root,
  stdin: { contents: "import { serveStdio } from './scripts/convfusion-mcp.mjs'; serveStdio();", resolveDir: root, sourcefile: 'codex-mcp-entry.mjs', loader: 'js' },
  bundle: true, format: 'esm', platform: 'node', target: 'node20', outfile: out,
  banner: { js: "import { createRequire as __codexCreateRequire } from 'node:module'; const require = __codexCreateRequire(import.meta.url);" },
  plugins: [{
    name: 'package-relative-resource-paths',
    setup(bundler) {
      bundler.onLoad({ filter: /\.(?:mjs|js)$/ }, ({ path }) => {
        if (!path.startsWith(root) || path.includes('/node_modules/')) return
        const modulePath = relative(dirname(out), path).replaceAll('\\', '/')
        const ref = modulePath.startsWith('.') ? modulePath : `./${modulePath}`
        const contents = readFileSync(path, 'utf8').replaceAll('import.meta.url', `new URL(${JSON.stringify(ref)}, import.meta.url).href`)
        return { contents, loader: 'js' }
      })
    },
  }],
  metafile: true,
}).then((result) => {
  // Store an auditable build manifest without machine paths or source content.
  const inputs = Object.keys(result.metafile.inputs).map((name) => name.replaceAll('\\', '/'))
  const dependencies = writeBundleNotices(root, result.metafile, 'codex-runtime')
  writeFileSync(join(root, 'lib/codex-runtime-manifest.json'), JSON.stringify({ entry: 'codex-mcp.mjs', source: 'scripts/convfusion-mcp.mjs', inputCount: inputs.length, dependencies }, null, 2) + '\n')
})
console.log(`Standalone Codex MCP built (${(readFileSync(out).length / 1024).toFixed(0)} KiB).`)

// TypeScript may emit trailing spaces around multiline parameter comments.
// Normalize generated text as part of the reproducible build, not by hand after delivery.
function normalizeGenerated(dir) {
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, item.name)
    if (item.isDirectory()) normalizeGenerated(path)
    else if (/\.(?:js|mjs|ts)$/.test(item.name)) {
      const text = readFileSync(path, 'utf8')
      const normalized = text.replace(/[ \t]+$/gm, '')
      if (text !== normalized) writeFileSync(path, normalized)
    }
  }
}
normalizeGenerated(join(root, 'lib'))
