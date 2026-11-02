#!/usr/bin/env node
/** Offline checks for publishing prices and server-resolved download sides. */
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { resolveConfig } from '../lib/config.js'
import { createSettingsRpcHandler } from '../lib/settings-rpc.js'
import { createMemoryCustomizationStore } from '../lib/research/skill-customization.js'
import { createMemoryPublishedStore } from '../lib/research/published-store.js'
import { createMemorySyncWatermarkStore } from '../lib/research/sync-watermarks.js'
import { createMemoryWorkIdentityStore, writeWorkMarker, makeWorkIdentity } from '../lib/research/work-identity.js'
import { createMemorySyncNoteStore } from '../lib/research/sync-note.js'
import { fetchProjectFiles, fetchProjectArchive, fetchPriceGuide } from '../lib/server-client.js'

const temp = realpathSync(mkdtempSync(join(tmpdir(), 'cf-file-exchange-')))
const base = 'https://offline.example'
const key = 'cf_live_offline_exchange_test'
const workId = `ws_${'a'.repeat(32)}`
const zip = Buffer.from('UEsDBBQAAAAAAAAAW12WFM9YBwAAAAcAAAAIAAAAY2hlY2subWQjIFRlc3QKUEsBAhQDFAAAAAAAAABbXZYUz1gHAAAABwAAAAgAAAAAAAAAAAAAAIABAAAAAGNoZWNrLm1kUEsFBgAAAAABAAEANgAAAC0AAAAAAA==', 'base64')
const guide = { min_allowed: 1, recommended_min: 500, recommended_max: 1000, token_value_fen: 1000,
  tiers: [{ tokens: 1000, label: 'Advanced' }, { tokens: 500, label: 'Entry' }, { tokens: 500, label: 'Duplicate' }, { tokens: 1.5, label: 'Invalid' }] }
const json = (body, status = 200) => new Response(JSON.stringify(body), { status })
try {
  for (const direction of ['SEEK_MENTOR', 'SEEK_STUDENT']) {
    const ws = join(temp, direction), root = join(ws, 'workspace')
    mkdirSync(root, { recursive: true })
    writeFileSync(join(root, 'project.md'), '---\ntopic: Test question\ncreated_at: 2026-01-01T00:00:00Z\n---\n# Test\n')
    writeFileSync(join(root, 'research-state.md'), '## Problem\n\nTest question.\n')
    let version = null, askingFee = null, failUpdate = false
    const calls = [], publishedStore = createMemoryPublishedStore()
    const fetchImpl = async (url, init) => {
      const method = init?.method ?? 'GET'
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body
      calls.push({ url, method, body })
      if (url.endsWith('/auth/me')) return json({ id: 'account', email: 'offline@example.com', display_name: 'Test', status: 'ACTIVE', roles: ['RESEARCHER', 'MENTOR'] })
      if (url.endsWith('/mentorship/price-guide')) return json(guide)
      if (url.endsWith('/projects') && method === 'POST') { askingFee = body.asking_fee ?? null; return json({ id: 'project', title: 'Test', status: 'ACTIVE', visibility: 'PRIVATE', workspace_id: workId, asking_fee: askingFee }) }
      if (url.endsWith('/projects/project') && method === 'PUT') {
        if (failUpdate) return json({ error: { code: 'TEMPORARY_ERROR', message: 'Update failed' } }, 503)
        askingFee = body.asking_fee ?? askingFee
        return json({ id: 'project', title: body.title, asking_fee: askingFee })
      }
      if (url.endsWith('/projects/project') && method === 'GET') return json({ id: 'project', title: 'Test question', visibility: 'PUBLISHED', workspace_id: workId, asking_fee: askingFee })
      if (url.endsWith('/state') && method === 'GET') return version === null ? json({}, 404) : json({ version })
      if (url.endsWith('/state') && method === 'POST') { version = (body.base_version ?? 0) + 1; return json({ version, content_hash: 'sha256:test' }) }
      if (url.endsWith('/publish')) return json({ visibility: 'PUBLISHED', charged_tokens: 0 })
      if (url.includes('/discovery/random')) return json({ items: [] })
      if (url.endsWith('/usage')) return json({})
      return json({}, 404)
    }
    const handler = createSettingsRpcHandler({
      getConfig: () => resolveConfig({ serverUrl: base, convfusionProdApiKey: key, customizationDir: temp }),
      env: { CONVFUSION_ENV: 'production', CONVFUSION_ENV_FILE: '-' },
      store: createMemoryCustomizationStore(), publishedStore, fetchImpl,
      listLocalWorkspaces: async () => ({ available: true, items: [{ id: 'local', title: 'Test', path: ws, updatedAt: '' }] }),
    })
    const publish = (price) => handler('work/publish', { id: 'local', direction, selection: [], ...(price === undefined ? {} : { askingFee: price }) })
    for (const price of [0, -1, 1.5, 1_000_001, true, {}, '', '1e3']) {
      const before = calls.length
      assert.equal((await publish(price)).ok, false, `invalid price rejected: ${String(price)}`)
      assert.equal(calls.length, before, 'invalid input performs no network writes')
    }
    const first = await publish(800)
    assert.equal(first.ok, true, JSON.stringify({ direction, first, calls }))
    assert.equal(calls.find((c) => c.url.endsWith('/projects') && c.method === 'POST').body.asking_fee, 800)
    assert.equal(publishedStore.get(root, direction).askingFee, 800)
    assert.equal((await publish(900)).ok, true)
    assert.equal(askingFee, 900)
    assert.equal(publishedStore.get(root, direction).askingFee, 900)
    const plan = await handler('work/uploadPlan', { id: 'local', direction })
    assert.equal(plan.value.askingFee, 900, 'reopening pre-fills saved price')
    assert.equal(plan.value.priceGuide.tiers.length, 3, 'invalid fractional tier excluded')
    const updates = () => calls.filter((c) => c.method === 'PUT').length
    const before = updates()
    assert.equal((await publish()).ok, true)
    assert.equal(updates(), before, 'no requested price leaves server value unchanged')
    assert.equal(publishedStore.get(root, direction).askingFee, 900, 'no-price update preserves saved price')
    failUpdate = true
    const failed = await publish(950)
    assert.equal(failed.ok, true, 'optional metadata failure does not undo published files')
    assert.ok(failed.value.published.renameFailed, 'metadata failure is reported')
    assert.equal(publishedStore.get(root, direction).askingFee, 900, 'failed price update is never recorded as applied')
    failUpdate = false
    assert.equal((await publish(950)).ok, true)
    assert.equal(publishedStore.get(root, direction).askingFee, 950, 'retry applies price')
  }

  const calls = []
  for (const side of ['owner', 'mentor', 'counterpart']) {
    await fetchProjectFiles(base, key, 'project', { source: side, fetchImpl: async (url) => { calls.push(url); return json({ items: [] }) } })
  }
  assert.ok(calls[0].endsWith('/files'))
  assert.ok(calls[1].endsWith('?source=mentor'))
  assert.ok(calls[2].endsWith('?source=counterpart'))
  for (const side of ['owner', 'mentor', null, 'counterpart']) {
    const received = await fetchProjectArchive(base, key, 'project', { write() {} }, {
      source: 'counterpart', fetchImpl: async (url) => {
        assert.ok(url.endsWith('?source=counterpart'))
        return new Response(zip, { headers: side ? { 'X-Source': side } : {} })
      },
    })
    assert.equal(received.sourceSide, side === 'counterpart' ? null : side)
  }
  assert.equal(await fetchPriceGuide(base, key, { fetchImpl: async () => json({}, 404) }), null)

  // Exercise bookkeeping with actual ZIP writes and an existing matching research.
  for (const served of ['owner', 'mentor', null]) {
    const ws = join(temp, `download-${served}`), root = join(ws, 'workspace')
    mkdirSync(root, { recursive: true })
    writeFileSync(join(root, 'project.md'), '# Test\n')
    writeFileSync(join(root, 'research-state.md'), '## Problem\nTest\n')
    writeWorkMarker(root, makeWorkIdentity({ workspaceId: workId, projectId: 'project', serverUrl: base, accountId: 'account', role: 'owner' }))
    const syncStore = createMemorySyncWatermarkStore(), identities = createMemoryWorkIdentityStore(), notes = createMemorySyncNoteStore()
    const handler = createSettingsRpcHandler({
      getConfig: () => resolveConfig({ serverUrl: base, convfusionProdApiKey: key, customizationDir: temp }),
      env: { CONVFUSION_ENV: 'production', CONVFUSION_ENV_FILE: '-' },
      store: createMemoryCustomizationStore(), syncStore, workIdentity: identities, syncNotes: notes,
      listLocalWorkspaces: async () => ({ available: true, items: [{ id: 'local', title: 'Test', path: ws, updatedAt: '' }] }),
      fetchImpl: async (url) => {
        if (url.endsWith('/auth/me')) return json({ id: 'account', status: 'ACTIVE', roles: [] })
        assert.ok(url.endsWith('/files/archive?source=counterpart'))
        return new Response(zip, { headers: { 'X-Workspace-Id': workId, 'X-File-Count': '1', 'X-Source-Updated-At': '2026-10-30T00:00:00Z', ...(served ? { 'X-Source': served } : {}) } })
      },
    })
    const result = await handler('mentor/download', { projectId: 'project', workspaceId: 'local', remoteWorkspaceId: workId, source: 'counterpart' })
    assert.equal(result.ok, true, JSON.stringify(result))
    assert.deepEqual(readFileSync(result.value.path), zip)
    assert.equal(notes.get(result.value.path).source, served, 'sync note records only the actual side, including unknown')
    assert.equal(syncStore.get(base, 'project', 'counterpart'), undefined, 'relative side is never a watermark key')
    if (served) {
      assert.equal(syncStore.get(base, 'project', served).updatedAt, '2026-10-30T00:00:00Z')
      assert.equal(identities.get(root).role, served === 'owner' ? 'mentor' : 'owner')
    } else {
      assert.equal(syncStore.get(base, 'project', 'owner'), undefined)
      assert.equal(syncStore.get(base, 'project', 'mentor'), undefined)
      assert.equal(identities.get(root), undefined, 'missing actual side does not invent identity role')
    }
  }
  const require = createRequire(import.meta.url)
  let captured
  new Function('window', readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8'))({ __ModuleLoader__: { load: (module) => { captured = module } } })
  const ui = captured.factory(require)
  const t = (key) => key
  const rendered = require('react-dom/server').renderToStaticMarkup
  const React = require('react')
  function* walk(node) {
    if (!node) return
    if (Array.isArray(node)) { for (const child of node) yield* walk(child); return }
    yield node
    if (node.props) yield* walk(node.props.children)
  }
  const reference = { minAllowed: 1, recommendedMin: 500, recommendedMax: 1000, tokenValueFen: 1000,
    tiers: [{ tokens: 1000, label: 'Advanced' }, { tokens: 500, label: 'Entry' }, { tokens: 500, label: 'Duplicate' }] }
  assert.deepEqual(ui.priceOptionsOf(reference).map((o) => o.tokens), [500, 1000])
  assert.equal(ui.defaultPriceOf(reference), 500)
  assert.equal(ui.normalizePrice('12.5'), null)
  assert.equal(ui.validatePrice(NaN, null), 'empty')
  assert.equal(ui.formatTokenYuan(500, 1000), '¥5,000')
  const noop = () => {}
  for (const direction of ['SEEK_MENTOR', 'SEEK_STUDENT']) {
    const priceRow = (priceGuide, text = '') => rendered(React.createElement(ui.PriceGuideRow, {
      t, direction, guide: priceGuide, options: ui.priceOptionsOf(priceGuide), mode: 'custom', tokens: null, text,
      onSelectPreset: noop, onSelectCustom: noop, onText: noop,
    }))
    assert.ok(priceRow(reference).includes(direction === 'SEEK_MENTOR' ? 'priceResearcher' : 'priceMentor'))
    assert.ok(priceRow(null).includes('priceUnknown'), 'missing guide and empty price remains optional')
    assert.ok(!priceRow(null).includes('priceInvalid'))
    for (const [priceText, priceTokens, expectedDisabled, priceGuide] of [
      ['', null, true, reference], ['0', null, true, null], ['12.5', null, true, null],
      ['1000001', 1000001, true, null], ['', null, false, null], ['900', 900, false, reference],
    ]) {
      const tree = ui.PublishDialogView({ t, data: { direction, title: 'Test', plan: { categories: [], limits: { maxFilesPerRequest: 20, maxFileBytes: 100 } }, changed: [], priceGuide },
        selection: new Set(), remember: true, expanded: new Set(), busy: false, progress: null,
        priceMode: 'custom', priceText, priceTokens, onToggleFiles: noop, onToggleExpand: noop, onRemember: noop,
        onSelectPricePreset: noop, onSelectPriceCustom: noop, onPriceText: noop, onCancel: noop, onConfirm: noop })
      const confirm = [...walk(tree)].filter((n) => n.type === 'button').at(-1)
      assert.equal(confirm.props.disabled, expectedDisabled, `${direction} input ${priceText}`)
    }
  }
  // Run the real CommunityTab handlers so preset/custom switching submits the visible amount.
  let active
  const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]))
  const hooks = { ...React,
    useState(initial) {
      const h = active, i = h.cursor++
      if (!(i in h.cells)) h.cells[i] = typeof initial === 'function' ? initial() : initial
      return [h.cells[i], (value) => { h.cells[i] = typeof value === 'function' ? value(h.cells[i]) : value; h.dirty = true }]
    },
    useRef(initial) { return active.cells[active.cursor++] ??= { current: initial } },
    useMemo(fn, deps) {
      const h = active, i = h.cursor++, old = h.cells[i]
      if (!old || !same(old.deps, deps)) h.cells[i] = { deps, value: fn() }
      return h.cells[i].value
    },
    useCallback(fn, deps) { return hooks.useMemo(() => fn, deps) },
    useEffect(fn, deps) {
      const h = active, i = h.cursor++, old = h.cells[i]
      if (!old || !same(old.deps, deps)) { old?.cleanup?.(); h.cells[i] = { deps }; h.effects.push(() => { h.cells[i].cleanup = fn() }) }
    },
  }
  const interactive = captured.factory((id) => id === 'react' ? hooks : require(id))
  for (const direction of ['SEEK_MENTOR', 'SEEK_STUDENT']) {
    const account = { serverUrl: `https://ui-${direction}.example`, keyConfigured: true, account: { id: 'account', roles: ['RESEARCHER', 'MENTOR'] } }
    const submissions = []
    const row = { id: 'local', title: 'Test', workName: 'Test', path: '/offline', researchRoot: '/offline/workspace', missingDir: false,
      stage: null, overall: 0, counts: [], published: [{ direction, projectId: 'project', version: 1, updatedAt: '' }] }
    const h = { cursor: 0, cells: [], effects: [], dirty: true, tree: null }
    const send = async (endpoint, payload) => {
      if (endpoint === 'account/state' || endpoint === 'account/verify') return { ok: true, value: account }
      if (endpoint === 'work/mine') return { ok: true, value: { items: [row], registry: { available: true } } }
      if (endpoint === 'work/list') return { ok: true, value: { items: [] } }
      if (endpoint === 'mentor/list') return { ok: true, value: { proposals: [] } }
      if (endpoint === 'work/uploadPlan') return { ok: true, value: { direction, title: 'Test', askingFee: 800, priceGuide: reference,
        selection: ['project.md'], remembered: true, changed: [], plan: { categories: [], limits: { maxFilesPerRequest: 20, maxFileBytes: 100 } } } }
      if (endpoint === 'work/publish') { submissions.push(payload); return { ok: true, value: { published: { version: 2, created: false, chargedTokens: 0 } } } }
      throw new Error(`Unexpected UI test endpoint ${endpoint}`)
    }
    const settle = async () => {
      for (let n = 0; n < 30; n++) {
        if (h.dirty) { h.dirty = false; h.cursor = 0; active = h; h.tree = interactive.CommunityTab({ initial: account, send, t, session: { sessionId: direction } }); for (const run of h.effects.splice(0)) run() }
        await new Promise(setImmediate)
        if (!h.dirty && !h.effects.length) return
      }
      throw new Error('Publishing UI effects did not settle')
    }
    const component = (name) => [...walk(h.tree)].find((n) => n.type?.name === name)
    await settle()
    component('PublishButton').props.onPick(direction)
    await settle()
    assert.equal(submissions.length, 0, 'unchanged research still allows editing price before publication')
    assert.equal(component('PublishDialog').props.priceTokens, 800)
    component('PublishDialog').props.onSelectPricePreset(1000)
    await settle()
    assert.equal(component('PublishDialog').props.priceTokens, 1000)
    component('PublishDialog').props.onSelectPriceCustom()
    await settle()
    assert.equal(component('PublishDialog').props.priceTokens, 800, 'custom amount matches the visible retained text')
    component('PublishDialog').props.onPriceText('900')
    await settle()
    component('PublishDialog').props.onConfirm()
    await settle()
    assert.equal(submissions.at(-1).askingFee, 900)
    assert.equal(submissions.at(-1).direction, direction)
    h.cells.forEach((cell) => cell?.cleanup?.())
  }
  console.log('File exchange passed: both publishing directions, saved prices, validation, retry, optional price guide, price dialog rendering and interactions, counterpart requests and actual-side bookkeeping.')
} finally { rmSync(temp, { recursive: true, force: true }) }
