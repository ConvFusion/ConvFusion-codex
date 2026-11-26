import { writeBundleNotices } from './lib/bundle-notices.mjs'
import { clientBuildStamp } from './lib/client-build-stamp.mjs'
import { build } from 'esbuild'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const protocol = /HOST_PROTOCOL\s*=\s*(\d+)/.exec(readFileSync(join(root, 'src/protocol.ts'), 'utf8'))?.[1]
if (!protocol) throw new Error('HOST_PROTOCOL is missing')
const stamp = clientBuildStamp()
const output = await build({ absWorkingDir: root, metafile: true, entryPoints: [join(root, 'src/client/codex-app.tsx')], bundle: true, format: 'iife', platform: 'browser', target: 'es2022', jsx: 'automatic', charset: 'utf8', minify: true, define: { __HOST_PROTOCOL__: protocol, __CLIENT_BUILD__: JSON.stringify(stamp), 'process.env.NODE_ENV': '"production"' }, loader: { '.svg': 'dataurl' }, write: false, legalComments: 'inline' })
const script = output.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')
const css = readFileSync(join(root, 'src/client/codex-workbench.css'), 'utf8')

mkdirSync(join(root, 'lib'), { recursive: true })
writeFileSync(join(root, 'lib/codex-ui.html'), `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ConvFusion</title><style>${css}</style></head><body><div id="root"></div><script>${script}</script></body></html>\n`)
console.log(`Codex workbench built (${(script.length / 1024).toFixed(0)} KiB, build ${stamp}, no remote frontend dependencies).`)

writeBundleNotices(root, output.metafile, 'codex-ui')
