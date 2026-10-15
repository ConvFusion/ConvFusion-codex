#!/usr/bin/env node
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, stat, rm, readdir, realpath } from 'node:fs/promises'
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
  const retrieval = await host.dispatch(first, 'codex/settings', { field: 'openalexApiKey', value: 'fixture-openalex-secret' })
  assert.equal(retrieval.ok, true)
  assert.ok(!JSON.stringify(retrieval).includes('fixture-openalex-secret'))
  assert.equal((await host.dispatch(first, 'codex/settings', { field: 'customizationDir', value: '/outside' })).ok, false)
  const recreated = createCodexUiHost({ home })
  assert.equal(recreated.getConfig().convfusionProdApiKey, key, 'account survives restart')
  const opened = await host.open(first)
  const openedSecond = await host.open(second)
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
  console.log('Codex workbench transport passed: persisted/redacted credentials, read-only workspace inspection, settings, numeric Codex versions, authenticated loopback and task isolation. Network responses were offline fixtures.')
} finally {
  await host.close()
  await rm(temp, { recursive: true, force: true })
}
