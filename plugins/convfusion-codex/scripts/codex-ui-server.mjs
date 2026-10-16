/** Codex adapter for the shared settings/community service. No DSH runtime is started. */
import { createServer } from 'node:http'
import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, resolve, relative, sep } from 'node:path'
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
import { codexResearchContext } from '../lib/codex/context.js'
import { codexHome, stateKey, readPrivateJson as readJson, writePrivateJson, readCodexWorkspaces, registerCodexWorkspace } from '../lib/codex/storage.js'
import { latestCodexTurn } from '../lib/codex/lifecycle.js'
import { DEFAULT_AUTO_CONTINUE } from '../lib/research/advance.js'
import { writeMethodsExport } from '../lib/research/methods-export.js'
import { collectSyncFacts, buildSyncText, resolveZipReference } from '../lib/research/sync-request.js'

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(pluginRoot, 'package.json'), 'utf8'))
export const UI_URI = 'ui://convfusion/workbench-v1.html'
export const UI_MIME = 'text/html;profile=mcp-app'
const failure = (code, message) => ({ ok: false, error: { code, message, details: {} } })

export function createCodexUiHost(options = {}) {
  const env = options.env ?? process.env
  const home = resolve(options.home ?? codexHome(env))
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
    convfusionApiKey: '', autoContinue: DEFAULT_AUTO_CONTINUE.enabled, autoContinueMaxRounds: DEFAULT_AUTO_CONTINUE.maxRounds,
    ...readJson(path('config.json'), {}),
    customizationDir: home,
  })
  const setConfig = (patch) => {
    const update = persistQueue.then(() => writePrivateJson(path('config.json'), { ...getConfig(), ...patch, customizationDir: home }))
    persistQueue = update.catch(() => {})
    return update
  }
  const registerWorkspace = (root, persist = false) => {
    if (typeof root !== 'string' || !isAbsolute(root)) throw new Error('请输入项目文件夹的绝对路径')
    const canonical = realpathSync(root)
    if (!statSync(canonical).isDirectory()) throw new Error('请选择现有的项目文件夹')
    const fromPlugin = relative(realpathSync(pluginRoot), canonical)
    if (!fromPlugin || (!fromPlugin.startsWith(`..${sep}`) && fromPlugin !== '..' && !isAbsolute(fromPlugin))) throw new Error('请选择研究项目目录，不能使用插件安装目录')
    const id = stateKey(canonical)
    workspaces.set(id, { id, title: basename(canonical), path: canonical, updatedAt: new Date().toISOString() })
    if (persist) registerCodexWorkspace(home, canonical)
    return workspaces.get(id)
  }
  const handler = createSettingsRpcHandler({
    getConfig, setConfig, store, version: pkg.version, env,
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    resolvePath: () => path('skill-customizations.json'),
    resolveSessionWorkspace: (id) => workspaces.get(id)?.path,
    listLocalWorkspaces: async () => ({ available: true, items: workspaceRows() }),
    paidBriefStore: createFilePaidBriefStore(() => path('paid-briefs.json')),
    publishedStore: createFilePublishedStore(() => path('published.json')),
    syncStore: createFileSyncWatermarkStore(() => path('sync-watermarks.json')),
    syncNotes, workIdentity,
  })
  const workspaceRows = () => {
    for (const row of readCodexWorkspaces(home)) workspaces.set(row.id, row)
    return [...workspaces.values()].filter((row) => { try { return statSync(row.path).isDirectory() } catch { return false } })
  }
  const exportMethods = (root, full = false) => {
    const researchRoot = researchWorkspaceOf(root)
    const { markdown, ...result } = writeMethodsExport(researchRoot, { store, full })
    return { ...result, path: isAbsolute(result.path) ? result.path : join(researchRoot, result.path) }
  }
  const bootstrap = (root) => {
    const row = root ? registerWorkspace(root) : null
    return { workspaceRoot: row?.path ?? null, sessionId: row?.id ?? null, title: row?.title ?? '研究工作台', version: pkg.version }
  }
  const dispatch = async (root, endpoint, payload) => {
    if (root) registerWorkspace(root)
    if (endpoint === 'codex/bootstrap') return { ok: true, value: bootstrap(root) }
    if (endpoint === 'codex/settings') {
      if (payload?.field === 'autoContinue' && typeof payload.value === 'boolean') await setConfig({ autoContinue: payload.value })
      else if (payload?.field === 'autoContinueMaxRounds' && Number.isInteger(payload.value) && payload.value >= 0 && payload.value <= 100) await setConfig({ autoContinueMaxRounds: payload.value })
      else if (payload?.field === 'openalexApiKey' && typeof payload.value === 'string') await setConfig({ openalexApiKey: payload.value.trim() })
      else return failure('field', 'Unsupported setting')
      return { ok: true, value: { configured: Boolean(getConfig().openalexApiKey) } }
    }
    if (endpoint === 'codex/continuation') return { ok: true, value: { enabled: getConfig().autoContinue, maxRounds: getConfig().autoContinueMaxRounds } }
    if (endpoint === 'codex/export-methods') return root ? { ok: true, value: exportMethods(root, payload?.full === true) } : failure('workspace', '请先选择研究项目目录')
    if (endpoint === 'codex/sync' && !root) return failure('workspace', '请先选择研究项目目录')
    if (endpoint === 'codex/sync') return { ok: true, value: prepareSync(root, payload?.zip ?? '') }
    // Never accept host transport/directory callbacks from UI input: only the shared RPC dispatcher.
    const result = await handler(String(endpoint), payload ?? {})
    if (endpoint === 'progress/workspace' && root && result.ok && result.value?.research) {
      const latest = latestCodexTurn(home, root)
      result.value.lastTurn = latest?.report ?? null
      result.value.lastTurnSessionId = latest?.sessionId ?? null
    }
    return result
  }
  const prepareSync = (root, zip) => {
    const resolved = resolveZipReference(String(zip), root)
    if (!resolved.ok) return { ok: false, ...resolved }
    const facts = collectSyncFacts({ zip: resolved.path, sessionWorkspace: root, researchRoot: researchWorkspaceOf(root), noteStore: syncNotes, identityStore: workIdentity })
    return { ok: facts.zipOk, facts, instructions: buildSyncText(facts, researchWorkspaceOf(root) === root ? '' : 'workspace') }
  }
  const uiHtml = () => readFileSync(join(pluginRoot, 'lib/codex-ui.html'), 'utf8')
  const sessionInfo = (token, state) => ({ ...bootstrap(state.root), uiScope: state.selectable ? 'global' : 'workspace', uiSession: token })
  const dispatchSession = async (token, root, endpoint, payload) => {
    const state = browserSessions.get(token)
    if (!state) return failure('auth', '界面连接已失效，请重新打开 ConvFusion')
    if (root !== undefined && root !== state.root) return failure('workspace', 'Workspace is not registered')
    if (endpoint === 'codex/bootstrap') return { ok: true, value: sessionInfo(token, state) }
    if (endpoint === 'codex/workspaces') return { ok: true, value: workspaceRows() }
    if (endpoint === 'codex/select-workspace') {
      if (!state.selectable) return failure('workspace', '聊天工作台绑定当前任务，请从全局入口切换研究目录')
      try {
        state.root = registerWorkspace(payload?.path, true).path
        return { ok: true, value: sessionInfo(token, state) }
      } catch (error) {
        const message = error.code === 'ENOENT' ? '目录不存在，请检查路径' : error.code === 'EACCES' ? '无法读取该目录，请检查访问权限' : error.message
        return failure('workspace', message)
      }
    }
    // Progress always follows this page's selection, never an arbitrary session ID from the UI.
    if (endpoint === 'progress/workspace') payload = { ...payload, sessionId: bootstrap(state.root).sessionId ?? '' }
    return dispatch(state.root, endpoint, payload)
  }
  const open = async (root) => {
    const selected = root === undefined ? null : registerWorkspace(root, true).path
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
        const token = (req.headers.authorization ?? '').replace(/^Bearer /, '')
        const browserState = browserSessions.get(token)
        if (!browserState) return finish(403, failure('auth', 'Open this page from the current ConvFusion tool result'))
        try {
          const chunks = []
          let bytes = 0
          for await (const chunk of req) {
            bytes += chunk.length
            if (bytes > SETTINGS_MAX_BODY_BYTES) return finish(413, failure('size', 'Request too large'))
            chunks.push(chunk)
          }
          const request = JSON.parse(Buffer.concat(chunks).toString('utf8'))
          if (request.workspaceRoot !== undefined && request.workspaceRoot !== browserState.root) return finish(403, failure('workspace', 'Workspace is not registered'))
          finish(200, await dispatchSession(token, request.workspaceRoot, request.endpoint, request.payload))
        } catch { finish(500, failure('request', 'Request failed; check the local configuration and retry')) }
      })
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
      origin = `http://127.0.0.1:${server.address().port}`
      server.unref()
    })().catch((error) => { launch = undefined; throw error })
    await launch
    const token = randomBytes(32).toString('hex')
    const state = { root: selected, selectable: root === undefined }
    browserSessions.set(token, state)
    return { ...sessionInfo(token, state), url: `${origin}/#${token}` }
  }
  return {
    home, store, getConfig, registerWorkspace, bootstrap, dispatch, dispatchSession, open, uiHtml, prepareSync, exportMethods,
    context(root, input = '') { return codexResearchContext(root, input, store) },
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
