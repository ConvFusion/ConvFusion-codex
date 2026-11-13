import { writeBundleNotices } from './lib/bundle-notices.mjs'
import { build } from 'esbuild'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const protocol = /HOST_PROTOCOL\s*=\s*(\d+)/.exec(readFileSync(join(root, 'src/protocol.ts'), 'utf8'))?.[1]
if (!protocol) throw new Error('HOST_PROTOCOL is missing')
const output = await build({ absWorkingDir: root, metafile: true, entryPoints: [join(root, 'src/client/codex-app.tsx')], bundle: true, format: 'iife', platform: 'browser', target: 'es2022', jsx: 'automatic', charset: 'utf8', minify: true, define: { __HOST_PROTOCOL__: protocol, 'process.env.NODE_ENV': '"production"' }, loader: { '.svg': 'dataurl' }, write: false, legalComments: 'inline' })
const script = output.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')
const css = `:root{color-scheme:light dark;--dsw-alias-bg-base:#f6f7f9;--dsw-alias-bg-layer-1:#fff;--dsw-alias-bg-layer-2:#f7f8fa;--dsw-alias-bg-layer-3:#edf0f4;--dsw-alias-border-l1:#e4e7ec;--dsw-alias-border-l2:#d0d5dd;--dsw-alias-label-primary:#182230;--dsw-alias-label-secondary:#475467;--dsw-alias-label-tertiary:#667085;--dsw-alias-brand-primary:#3157a4;--dsw-alias-button-primary-fill:#3157a4;--dsw-alias-state-business-primary:#3157a4;--dsw-alias-state-business-tertiary:#edf3ff;--dsw-alias-state-error-primary:#b42318;--dsw-alias-state-success-primary:#087443;--dsw-alias-state-success-tertiary:#ecfdf3;--dsw-alias-state-warn-primary:#b54708;--dsw-alias-state-warn-tertiary:#fffaeb;--ds-font-family-code:ui-monospace,monospace;--ds-transition-duration:160ms;--ds-ease-in-out:ease-in-out}*{box-sizing:border-box}body{margin:0;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:14px/1.6 system-ui,sans-serif}#root{max-width:1100px;margin:auto;padding:24px}.header{display:flex;align-items:center;gap:14px}.header img{width:42px;height:42px}h1{margin:0;font-size:24px}small{color:var(--dsw-alias-label-secondary)}.workbench-nav{display:flex;flex-wrap:wrap;gap:8px;margin:24px 0}.workbench-nav button{border:0;border-radius:10px;padding:9px 18px;background:var(--dsw-alias-bg-layer-1);color:inherit;cursor:pointer}.workbench-nav button[aria-current]{background:var(--dsw-alias-brand-primary);color:var(--workbench-selected-text,#fff)}button:focus-visible,a:focus-visible{outline:2px solid #528bff;outline-offset:3px}.loading{padding:40px;white-space:pre-wrap}main{min-width:0}@media(max-width:600px){#root{padding:12px}.workbench-nav{gap:4px}.workbench-nav button{padding:8px 12px}}@media(prefers-color-scheme:dark){:root{--workbench-selected-text:#14171c;--dsw-alias-bg-base:#14171c;--dsw-alias-bg-layer-1:#1e232b;--dsw-alias-bg-layer-2:#252c35;--dsw-alias-bg-layer-3:#303944;--dsw-alias-border-l1:#35404d;--dsw-alias-border-l2:#475567;--dsw-alias-label-primary:#f0f3f8;--dsw-alias-label-secondary:#c0cad8;--dsw-alias-label-tertiary:#95a3b6;--dsw-alias-brand-primary:#7da8ff;--dsw-alias-state-business-primary:#a8c5ff;--dsw-alias-state-business-tertiary:#243754;--dsw-alias-state-success-primary:#67dfa6;--dsw-alias-state-success-tertiary:#16382c;--dsw-alias-state-warn-primary:#ffcb7c;--dsw-alias-state-warn-tertiary:#43321c;--dsw-alias-state-error-primary:#ff9e94}}`
const controlsCss = `
.method-actions{display:flex;flex-wrap:wrap;align-items:center;gap:12px;margin:12px 0;padding:14px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:12px}
.method-actions button,.sync-request button,.preferences-form button{padding:7px 12px;background:var(--dsw-alias-bg-layer-2);color:inherit;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;cursor:pointer}
.method-actions button:disabled,.preferences-form button:disabled{opacity:.55;cursor:default}
.method-actions p{width:100%;margin:0;overflow-wrap:anywhere}
.preferences h2{font-size:22px;margin:0 0 16px}
.preferences-layout{display:grid;grid-template-columns:176px minmax(0,1fr);gap:18px;align-items:start}
.preferences-nav{display:grid;gap:4px;padding:6px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1)}
.preferences-nav button{border:0;border-radius:7px;padding:9px 10px;text-align:start;font:inherit;color:inherit;background:transparent;cursor:pointer}
.preferences-nav button:hover{background:var(--dsw-alias-bg-layer-2)}
.preferences-nav button[aria-current]{background:var(--dsw-alias-state-business-tertiary);color:var(--dsw-alias-state-business-primary);font-weight:650}
.preferences-content{display:grid;gap:12px;min-width:0}
.preferences-content h3{font-size:16px;margin:0}
.preferences-card{display:grid;gap:12px;min-width:0;padding:14px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:12px}
.preferences-card h4{font-size:13px;margin:0}
.preferences-card p{margin:0;overflow-wrap:anywhere}
.preferences-card [role=alert]{color:var(--dsw-alias-state-error-primary)}
.preferences-row,.preferences-form,.preferences-check{display:flex;align-items:center;gap:8px}
.preferences-row,.preferences-form{flex-wrap:wrap}
.preferences-check{align-items:flex-start}
.preferences-row{justify-content:space-between}
.preferences-form{gap:12px}
.preferences-row select,.preferences-row input{padding:6px 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:inherit;font:inherit}
.preferences-row input[type=number]{width:76px}
.preferences-check input,.preferences-card input[type=checkbox]{margin:4px 3px;flex:none}
@media(max-width:600px){.preferences-layout{grid-template-columns:minmax(0,1fr);gap:12px}.preferences-nav{display:flex;flex-wrap:wrap}.preferences-nav button{padding:6px 9px}.preferences-content{gap:9px}}
.sync-request{width:min(640px,92vw);max-height:85vh;overflow:auto;padding:24px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary)}.sync-request::backdrop{background:#0008}.sync-request textarea{width:100%;padding:12px;color:inherit;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l2);border-radius:8px}.sync-request button{margin-right:8px}`

mkdirSync(join(root, 'lib'), { recursive: true })
writeFileSync(join(root, 'lib/codex-ui.html'), `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ConvFusion</title><style>${css}${controlsCss}</style></head><body><div id="root"></div><script>${script}</script></body></html>\n`)
console.log(`Codex workbench built (${(script.length / 1024).toFixed(0)} KiB, no remote frontend dependencies).`)

writeBundleNotices(root, output.metafile, 'codex-ui')
