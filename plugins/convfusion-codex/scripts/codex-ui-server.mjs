/** Codex adapter for the shared settings/community service. No DSH runtime is started. */
import { createServer } from 'node:http'
import { randomBytes, createHash } from 'node:crypto'
import { existsSync, readFileSync, mkdirSync, writeFileSync, renameSync, chmodSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createSettingsRpcHandler, SETTINGS_MAX_BODY_BYTES } from '../lib/settings-rpc.js'
import { createFileCustomizationStore } from '../lib/research/skill-customization.js'
import { createFilePaidBriefStore } from '../lib/research/paid-briefs.js'
import { createFilePublishedStore } from '../lib/research/published-store.js'
import { createFileSyncWatermarkStore } from '../lib/research/sync-watermarks.js'
import { createFileSyncNoteStore } from '../lib/research/sync-note.js'
import { createFileWorkIdentityStore } from '../lib/research/work-identity.js'
import { effectiveSkillContentById } from '../lib/research/library.js'
import { listSystemSkills } from '../lib/research/skills.js'
import { researchWorkspaceOf } from '../lib/research/workspace.js'
import { collectResearchContext, renderResearchContext } from '../lib/research/context.js'
import { collectSyncFacts, buildSyncText, resolveZipReference } from '../lib/research/sync-request.js'

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(pluginRoot, 'package.json'), 'utf8'))
export const UI_URI = 'ui://convfusion/workbench-v1.html'
export const UI_MIME = 'text/html;profile=mcp-app'
const failure = (code, message) => ({ ok: false, error: { code, message, details: {} } })

function readJson(path, fallback) {
  if (!existsSync(path)) return fallback
  // A corrupt settings file must not silently discard a saved credential on the next write.
  return JSON.parse(readFileSync(path, 'utf8'))
}
function writePrivateJson(path, value) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const temp = `${path}.${randomBytes(8).toString('hex')}.tmp`
  writeFileSync(temp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' })
  renameSync(temp, path)
  chmodSync(path, 0o600)
}

export function createCodexUiHost(options = {}) {
  const env = options.env ?? process.env
  const home = resolve(options.home ?? env.CONVFUSION_CODEX_HOME ?? join(env.CODEX_HOME || join(homedir(), '.codex'), 'convfusion'))
  const path = (name) => join(home, name)
  const workspaces = new Map()
  const saved = readJson(path('workspaces.json'), [])
  if (Array.isArray(saved)) for (const row of saved) {
    if (typeof row?.path === 'string' && isAbsolute(row.path) && existsSync(row.path)) workspaces.set(row.id, row)
  }
  const store = createFileCustomizationStore(() => path('skill-customizations.json'))
  const syncNotes = createFileSyncNoteStore(() => path('sync-notes.json'))
  const workIdentity = createFileWorkIdentityStore(() => path('work-identities.json'))
  let server
  let launch
  const browserSessions = new Map()
  let origin
  let persistQueue = Promise.resolve()
  const getConfig = () => ({
    customizationFile: 'skill-customizations.json',
    openalexApiKey: '', serverUrl: '', convfusionDevApiKey: '', convfusionProdApiKey: '',
    convfusionApiKey: '', autoContinue: false, autoContinueMaxRounds: 0,
    ...readJson(path('config.json'), {}),
    customizationDir: home,
  })
  const setConfig = (patch) => {
    const update = persistQueue.then(() => writePrivateJson(path('config.json'), { ...getConfig(), ...patch, customizationDir: home }))
    persistQueue = update.catch(() => {})
    return update
  }
  const registerWorkspace = (root, persist = false) => {
    if (!isAbsolute(root)) throw new Error('workspace_root must be an absolute task directory')
    const canonical = realpathSync(root)
    const id = createHash('sha256').update(canonical).digest('hex').slice(0, 24)
    workspaces.set(id, { id, title: basename(canonical), path: canonical, updatedAt: new Date().toISOString() })
    if (persist) writePrivateJson(path('workspaces.json'), [...workspaces.values()])
    return workspaces.get(id)
  }
  const handler = createSettingsRpcHandler({
    getConfig, setConfig, store, version: pkg.version, env,
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    resolvePath: () => path('skill-customizations.json'),
    resolveSessionWorkspace: (id) => workspaces.get(id)?.path,
    listLocalWorkspaces: async () => ({ available: true, items: [...workspaces.values()] }),
    paidBriefStore: createFilePaidBriefStore(() => path('paid-briefs.json')),
    publishedStore: createFilePublishedStore(() => path('published.json')),
    syncStore: createFileSyncWatermarkStore(() => path('sync-watermarks.json')),
    syncNotes, workIdentity,
  })
  const bootstrap = (root) => {
    const row = registerWorkspace(root)
    return { workspaceRoot: row.path, sessionId: row.id, title: row.title, version: pkg.version }
  }
  const dispatch = async (root, endpoint, payload) => {
    registerWorkspace(root)
    if (endpoint === 'codex/bootstrap') return { ok: true, value: bootstrap(root) }
    if (endpoint === 'codex/settings') {
      if (payload?.field !== 'openalexApiKey' || typeof payload.value !== 'string') return failure('field', 'Unsupported setting')
      await setConfig({ openalexApiKey: payload.value.trim() })
      return { ok: true, value: { configured: Boolean(getConfig().openalexApiKey) } }
    }
    if (endpoint === 'codex/sync') return { ok: true, value: prepareSync(root, payload?.zip ?? '') }
    // Never accept host transport/directory callbacks from UI input: only the shared RPC dispatcher.
    return handler(String(endpoint), payload ?? {})
  }
  const prepareSync = (root, zip) => {
    const resolved = resolveZipReference(String(zip), root)
    if (!resolved.ok) return { ok: false, ...resolved }
    const facts = collectSyncFacts({ zip: resolved.path, sessionWorkspace: root, researchRoot: researchWorkspaceOf(root), noteStore: syncNotes, identityStore: workIdentity })
    return { ok: facts.zipOk, facts, instructions: buildSyncText(facts, researchWorkspaceOf(root) === root ? '' : 'workspace') }
  }
  const uiHtml = () => readFileSync(join(pluginRoot, 'lib/codex-ui.html'), 'utf8')
  const open = async (root) => {
    registerWorkspace(root, true)
    if (!launch) launch = (async () => {
      server = createServer(async (req, res) => {
        res.setHeader('Cache-Control', 'no-store')
        res.setHeader('X-Content-Type-Options', 'nosniff')
        res.setHeader('Referrer-Policy', 'no-referrer')
        const finish = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)) }
        if (req.headers.host !== new URL(origin).host || (req.headers.origin && req.headers.origin !== origin)) return finish(403, failure('origin', 'Request origin is not allowed'))
        if (req.method === 'GET' && req.url === '/') {
          // Authentication stays in the fragment and browser memory, never in HTML or request logs.
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'" })
          return res.end(uiHtml())
        }
        if (req.method !== 'POST' || req.url !== '/rpc') return finish(404, failure('route', 'Not found'))
        const browserRoot = browserSessions.get((req.headers.authorization ?? '').replace(/^Bearer /, ''))
        if (!browserRoot) return finish(403, failure('auth', 'Open this page from the current ConvFusion tool result'))
        try {
          const chunks = []
          let bytes = 0
          for await (const chunk of req) {
            bytes += chunk.length
            if (bytes > SETTINGS_MAX_BODY_BYTES) return finish(413, failure('size', 'Request too large'))
            chunks.push(chunk)
          }
          const request = JSON.parse(Buffer.concat(chunks).toString('utf8'))
          const root = request.workspaceRoot ?? browserRoot
          if (root !== browserRoot) return finish(403, failure('workspace', 'Workspace is not registered'))
          finish(200, await dispatch(root, request.endpoint, request.payload))
        } catch { finish(500, failure('request', 'Request failed; check the local configuration and retry')) }
      })
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
      origin = `http://127.0.0.1:${server.address().port}`
      server.unref()
    })().catch((error) => { launch = undefined; throw error })
    await launch
    const token = randomBytes(32).toString('hex')
    browserSessions.set(token, registerWorkspace(root).path)
    return { ...bootstrap(root), url: `${origin}/#${token}` }
  }
  return {
    home, store, getConfig, registerWorkspace, bootstrap, dispatch, open, uiHtml, prepareSync,
    context(root, input = '') { return renderResearchContext(collectResearchContext({ workspace: researchWorkspaceOf(root), sessionWorkspace: root, userInput: input, skillContent: (id) => effectiveSkillContentById(id, store) }), input) },
    methods(id) { return id ? { id, content: effectiveSkillContentById(id, store) ?? null } : listSystemSkills().map(({ id, name, category, kind, code, label }) => ({ id, name, category, kind, code, label })) },
    async close() { if (server) await new Promise((resolve) => server.close(resolve)); server = undefined; launch = undefined },
    ref() { server?.ref() },
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const flag = process.argv.indexOf('--workspace')
  if (flag < 0 || !process.argv[flag + 1]) throw new Error('Usage: node scripts/codex-ui-server.mjs --workspace /absolute/task/path')
  const host = createCodexUiHost()
  const result = await host.open(resolve(process.argv[flag + 1]))
  host.ref()
  process.stdout.write(JSON.stringify(result) + '\n')
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => host.close().then(() => process.exit(0)))
}
