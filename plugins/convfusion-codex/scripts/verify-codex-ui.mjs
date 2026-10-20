#!/usr/bin/env node
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, stat, rm, readdir, realpath, writeFile, symlink, rename } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCodexUiHost } from './codex-ui-server.mjs'
import { compareVersions } from '../lib/settings-rpc.js'
const temp = await realpath(await mkdtemp(join(tmpdir(), 'convfusion-codex-ui-')))
const home = join(temp, 'home')
const first = join(temp, 'task-one')
const second = join(temp, 'task-two')
await mkdir(first); await mkdir(second)
const key = 'cf_live_codex_offline_fixture_secret'
const calls = []
const host = createCodexUiHost({ home, env: { CONVFUSION_ENV: 'production' }, fetchImpl: async (url, options) => {
  calls.push({ url, method: options.method })
  assert.equal(options.headers.authorization, `Bearer ${key}`)
  if (url.endsWith('/auth/me')) return new Response(JSON.stringify({ id: 'offline-account', email: 'fixture@example.com', display_name: 'Offline fixture', status: 'ACTIVE', roles: ['RESEARCHER'] }), { status: 200 })
  if (url.endsWith('/tokens')) return new Response(JSON.stringify({ available_balance: 100, frozen_balance: 0, total_balance: 100 }), { status: 200 })
  throw new Error(`Unexpected request: ${url}`)
} })
try {
  assert.equal(compareVersions('0.6.2-codex.10', '0.6.2-codex.9'), 1)
  assert.equal(compareVersions('0.6.2-codex.1', '0.6.2-codex.2'), -1)
  assert.equal(compareVersions('0.6.2-codex.1', '0.6.2-codex.1'), 0)
  const bootstrap = host.bootstrap(first)
  assert.equal(bootstrap.workspaceRoot, first)
  assert.deepEqual(await readdir(first), [], 'reading a non-research folder must not initialize research')
  const global = await host.open()
  const anotherGlobal = await host.open()
  assert.equal(global.uiScope, 'global')
  assert.equal(global.workspaceRoot, null)
  assert.equal(global.sessionId, null)
  const globalCall = (endpoint, payload = {}, root) => host.dispatchSession(global.uiSession, root, endpoint, payload)
  assert.equal((await globalCall('state')).ok, true, 'settings are usable before choosing a directory')
  assert.equal((await globalCall('progress/workspace', { sessionId: bootstrap.sessionId })).value.workspace, null, 'unselected global page must not borrow another page workspace')
  for (const root of ['relative/path', join(temp, 'does-not-exist')]) await assert.rejects(() => host.open(root))
  await writeFile(join(temp, 'a-file'), '')
  await assert.rejects(() => host.open(join(temp, 'a-file')))
  const pluginRoot = await realpath(new URL('..', import.meta.url))
  await assert.rejects(() => host.open(pluginRoot))
  await symlink(pluginRoot, join(temp, 'plugin-link'), 'dir')
  await assert.rejects(() => host.open(join(temp, 'plugin-link')))
  assert.equal((await globalCall('codex/select-workspace', { path: first })).ok, false, 'global pages have no manual directory switch')
  assert.equal((await globalCall('codex/workspaces')).ok, false, 'unused directory listing route is removed')
  assert.equal((await host.dispatchSession(anotherGlobal.uiSession, undefined, 'codex/bootstrap')).value.workspaceRoot, null)
  const globalBrowser = new URL(global.url)
  const globalBrowserRpc = (body) => fetch(`${globalBrowser.origin}/rpc`, { method: 'POST', headers: { Authorization: `Bearer ${globalBrowser.hash.slice(1)}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  assert.equal((await (await globalBrowserRpc({ endpoint: 'codex/bootstrap' })).json()).value.workspaceRoot, null)
  const local = await host.dispatch(first, 'work/mine', {})
  assert.equal(local.ok, true)
  assert.deepEqual(await readdir(first), [])
  const state = await host.dispatch(first, 'account/state', {})
  assert.equal(state.ok, true)
  assert.equal(calls.length, 0, 'account state must be available offline')
  const login = await host.dispatch(first, 'account/login', { apiKey: key, serverUrl: 'https://fixture.example.com' })
  assert.equal(login.ok, true)
  assert.ok(!JSON.stringify(login).includes(key), 'account response must not disclose a credential')
  assert.ok((await readFile(join(home, 'config.json'), 'utf8')).includes(key))
  assert.equal((await stat(join(home, 'config.json'))).mode & 0o777, 0o600)
  const retrieval = await host.dispatch(first, 'retrieval/saveKey', { apiKey: 'fixture-openalex-secret' })
  assert.equal(retrieval.ok, true)
  assert.ok(!JSON.stringify(retrieval).includes('fixture-openalex-secret'))
  assert.equal((await host.dispatch(first, 'state')).value.retrieval.configured, true)
  assert.equal((await host.dispatch(first, 'retrieval/clearKey')).value.retrieval.configured, false)
  assert.equal((await host.dispatch(first, 'codex/settings', { field: 'openalexApiKey', value: 'unused' })).ok, false)
  assert.equal((await host.dispatch(first, 'codex/settings', { field: 'customizationDir', value: '/outside' })).ok, false)
  assert.equal((await host.dispatch(first, 'codex/continuation')).value.enabled, true)
  assert.equal((await host.dispatch(first, 'codex/settings', { field: 'autoContinue', value: false })).ok, true)
  assert.equal((await host.dispatch(first, 'codex/settings', { field: 'autoContinueMaxRounds', value: 5 })).ok, true)
  assert.equal((await host.dispatch(first, 'codex/settings', { field: 'autoContinueMaxRounds', value: -1 })).ok, false)
  assert.equal((await host.dispatch(first, 'codex/settings', { field: 'autoContinueMaxRounds', value: 1.5 })).ok, false)
  assert.equal((await host.dispatch(first, 'codex/export-methods')).value.skillCount, 57)
  assert.equal((await host.dispatchSession(anotherGlobal.uiSession, undefined, 'codex/export-methods')).ok, false)
  const recreated = createCodexUiHost({ home })
  assert.equal(recreated.getConfig().convfusionProdApiKey, key, 'account survives restart')
  assert.equal(recreated.getConfig().autoContinue, false)
  assert.equal(recreated.getConfig().autoContinueMaxRounds, 5)
  const resumed = await recreated.dispatchSession(global.uiSession, undefined, 'codex/bootstrap')
  assert.equal(resumed.ok, true, 'a replacement host must accept the existing page capability')
  assert.equal(resumed.value.workspaceRoot, null, 'replacement retains global scope')
  assert.equal(resumed.value.uiScope, 'global')
  assert.equal(resumed.value.uiSession, global.uiSession)
  assert.equal((await recreated.dispatchSession(anotherGlobal.uiSession, undefined, 'codex/bootstrap')).value.workspaceRoot, null, 'unselected pages remain independent after host replacement')
  assert.equal((await recreated.dispatchSession(global.uiSession, first, 'state')).ok, false, 'replacement must still reject an incorrect directory')
  assert.equal((await recreated.dispatchSession(global.uiSession, undefined, 'codex/select-workspace', { path: first })).ok, false)
  assert.equal((await host.dispatchSession(global.uiSession, undefined, 'codex/bootstrap')).value.workspaceRoot, null)
  const isolated = createCodexUiHost({ home: join(temp, 'other-home') })
  assert.equal((await isolated.dispatchSession(global.uiSession, undefined, 'state')).error.code, 'auth', 'capabilities do not cross private adapter homes')
  const sessionFiles = await readdir(join(home, 'ui-sessions'))
  assert.equal((await stat(join(home, 'ui-sessions'))).mode & 0o777, 0o700)
  for (const file of sessionFiles) {
    const saved = join(home, 'ui-sessions', file)
    assert.equal((await stat(saved)).mode & 0o777, 0o600)
    assert.ok(!file.includes(global.uiSession))
    assert.ok(!(await readFile(saved, 'utf8')).includes(global.uiSession), 'do not persist bearer tokens')
  }
  const digest = createHash('sha256').update(global.uiSession).digest('hex')
  assert.equal((await recreated.dispatchSession(digest, undefined, 'state')).error.code, 'auth', 'a stored capability digest cannot be used as a bearer token')
  const corrupt = await host.open()
  const corruptPath = join(home, 'ui-sessions', `${createHash('sha256').update(corrupt.uiSession).digest('hex')}.json`)
  await writeFile(corruptPath, '{')
  assert.equal((await host.dispatchSession(corrupt.uiSession, undefined, 'state')).error.code, 'auth', 'unreadable session state fails closed without an in-memory fallback')
  const opened = await host.open(first)
  const openedSecond = await host.open(second)
  assert.equal(opened.uiScope, 'workspace')
  assert.equal((await recreated.dispatchSession(opened.uiSession, first, 'codex/bootstrap')).value.uiScope, 'workspace')
  assert.equal((await recreated.dispatchSession(opened.uiSession, first, 'codex/select-workspace', { path: second })).ok, false, 'replacement cannot broaden a task-bound capability')
  assert.equal((await host.dispatchSession(opened.uiSession, first, 'codex/select-workspace', { path: second })).ok, false, 'task-bound page cannot switch directories')
  assert.equal((await host.dispatchSession('invalid-session', undefined, 'state')).ok, false)
  const url = new URL(opened.url)
  const base = url.origin
  const auth = { Authorization: `Bearer ${url.hash.slice(1)}`, 'Content-Type': 'application/json' }
  const rpc = (body, headers = {}) => fetch(`${base}/rpc`, { method: 'POST', headers: { ...auth, ...headers }, body: JSON.stringify(body) })
  assert.equal((await fetch(base)).status, 200)
  assert.ok((await (await fetch(base)).text()).includes('<title>ConvFusion</title>'))
  assert.equal((await fetch(`${base}/rpc`, { method: 'POST', body: '{}' })).status, 403)
  assert.equal((await rpc({ endpoint: 'codex/bootstrap' }, { Origin: 'https://untrusted.example' })).status, 403)
  assert.equal((await rpc({ endpoint: 'codex/bootstrap', workspaceRoot: second })).status, 403, 'a page capability cannot change its task root')
  const own = await (await rpc({ endpoint: 'codex/bootstrap' })).json()
  assert.equal(own.value.workspaceRoot, first, 'a second page must not switch the first page to another task')
  assert.notEqual(opened.url, openedSecond.url)
  const settings = await (await rpc({ endpoint: 'state' })).json()
  assert.equal(settings.ok, true)
  assert.ok(!JSON.stringify(settings).includes(key))
  assert.equal((await host.dispatch(first, 'account/logout', {})).ok, true)
  assert.equal(host.getConfig().convfusionProdApiKey, '')
  await verifyResearchSwap(temp)
  console.log('Codex workbench transport passed: host replacement, private capabilities, credentials, task isolation, shared retrieval RPC, research swaps, identity-keyed publication records, workspace write headers and server/local list merging. Network responses were offline fixtures.')
} finally {
  await host.close()
  await rm(temp, { recursive: true, force: true })
}

async function verifyResearchSwap(temp) {
  const home = join(temp, 'swap-home')
  const root = join(temp, 'swap-task')
  const live = join(root, 'workspace')
  const stashA = join(root, 'research-a')
  const stashB = join(root, 'research-b')
  await mkdir(live, { recursive: true })
  await mkdir(stashB)
  for (const [dir, title, date] of [[live, 'Research A', '2026-01-01'], [stashB, 'Research B', '2026-02-01']]) {
    await writeFile(join(dir, 'project.md'), `---\ncreated_at: ${date}\ntopic: ${title}\n---\n\n# ${title}\n`)
    await writeFile(join(dir, 'research-state.md'), `# ${title}\n\n- Version: v1\n`)
  }
  const projects = new Map()
  const writes = []
  let listAvailable = true
  const swapHost = createCodexUiHost({ home, env: { CONVFUSION_ENV: 'production', CONVFUSION_ENV_FILE: '-' }, fetchImpl: async (url, init) => {
    const path = new URL(url).pathname.replace('/api/v1', '')
    const method = init?.method ?? 'GET'
    const json = (body, status = 200) => new Response(JSON.stringify(body), { status })
    if (path === '/auth/me') return json({ id: 'swap-owner', email: 'swap@example.com', status: 'ACTIVE', roles: ['RESEARCHER'] })
    if (path === '/tokens') return json({ available_balance: 100, frozen_balance: 0, total_balance: 100 })
    if (path === '/projects' && method === 'GET') {
      if (!listAvailable) throw new Error('offline fixture')
      return json([...projects.values()])
    }
    if (path === '/projects' && method === 'POST') {
      const n = projects.size + 1
      const project = { id: `project-${n}`, workspace_id: `ws_${String(n).repeat(32)}`, title: JSON.parse(init.body).title, direction: 'SEEK_MENTOR', visibility: 'PRIVATE', status: 'ACTIVE', updated_at: '2026-10-20' }
      projects.set(project.id, project)
      return json(project, 201)
    }
    const [, id, action] = /^\/projects\/([^/]+)(?:\/(.*))?$/.exec(path) ?? []
    const project = projects.get(id)
    assert.ok(project, `unexpected fixture request ${method} ${path}`)
    if (!action && method === 'GET') return json(project)
    if (!action && method === 'PUT') return json(project)
    if (method === 'POST') {
      assert.equal(init.headers['X-Workspace-Id'] ?? init.headers['x-workspace-id'], project.workspace_id, `${action} must carry the current research identity`)
      writes.push({ id, action })
    }
    if (action === 'state' && method === 'GET') return json({ version: project.version ?? 0 })
    if (action === 'state' && method === 'POST') return json({ project_id: id, version: project.version = (project.version ?? 0) + 1, content_hash: 'sha256:fixture', content: JSON.parse(init.body).content }, 201)
    if (action === 'files') return json(init.body.getAll('relative_paths').map((relative_path, i) => ({ id: `file-${i}`, relative_path, size: 4, sha256: `sha256:${i}` })), 201)
    if (action === 'publish') { project.visibility = 'PUBLISHED'; return json({ project_id: id, visibility: 'PUBLISHED', charged_tokens: 1 }) }
    throw new Error(`unexpected fixture request ${method} ${path}`)
  } })
  const call = (endpoint, payload = {}) => swapHost.dispatch(root, endpoint, payload)
  const mine = async () => { const result = await call('work/mine'); assert.equal(result.ok, true); return result.value.items }
  try {
    assert.equal((await call('account/login', { apiKey: 'cf_live_swap_fixture', serverUrl: 'https://fixture.example.com' })).ok, true)
    const rowA = (await mine()).find((item) => !item.detached)
    const publishedA = await call('work/publish', { id: rowA.id }); assert.equal(publishedA.ok, true, JSON.stringify(publishedA))
    const stored = JSON.parse(await readFile(join(home, 'published.json'), 'utf8'))
    assert.ok(Object.keys(stored).some((key) => key.includes('ws_11111111111111111111111111111111')), 'adapter must wire identity-keyed file storage')
    await rename(live, stashA); await rename(stashB, live)
    const afterSwap = await mine()
    const rowB = afterSwap.find((item) => !item.detached)
    assert.equal(rowB.workId, null)
    assert.deepEqual(rowB.published, [])
    assert.ok(afterSwap.some((item) => item.detached && item.published.some((record) => record.projectId === 'project-1')))
    const publishedB = await call('work/publish', { id: rowB.id }); assert.equal(publishedB.ok, true, JSON.stringify(publishedB))
    assert.equal(projects.size, 2, 'new research must create a different server project')
    assert.ok(writes.some((write) => write.id === 'project-2' && write.action === 'files'))
    await rename(live, stashB); await rename(stashA, live)
    const restored = await mine()
    assert.equal(restored.find((item) => !item.detached).workId, 'ws_11111111111111111111111111111111')
    assert.equal(restored.filter((item) => item.published.some((record) => record.projectId === 'project-1')).length, 1)
    listAvailable = false
    assert.equal((await mine()).find((item) => !item.detached).published[0].projectId, 'project-1', 'local records remain usable when server listing fails')
  } finally { await swapHost.close() }
}
