#!/usr/bin/env node
/** Exercise the shipped component's hooks/effects with an offline transport. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const React = require('react')
let active
const same = (a, b) => a && b && a.length === b.length && a.every((x, i) => Object.is(x, b[i]))
const hooks = {
  ...React,
  useState(initial) {
    const h = active, i = h.cursor++
    if (!(i in h.cells)) h.cells[i] = typeof initial === 'function' ? initial() : initial
    return [h.cells[i], (value) => {
      const next = typeof value === 'function' ? value(h.cells[i]) : value
      if (!Object.is(next, h.cells[i])) { h.cells[i] = next; h.dirty = true }
    }]
  },
  useRef(initial) {
    const h = active, i = h.cursor++
    return h.cells[i] ??= { current: initial }
  },
  useMemo(fn, deps) {
    const h = active, i = h.cursor++, prev = h.cells[i]
    if (!prev || !same(prev.deps, deps)) h.cells[i] = { deps, value: fn() }
    return h.cells[i].value
  },
  useCallback(fn, deps) { return hooks.useMemo(() => fn, deps) },
  useEffect(fn, deps) {
    const h = active, i = h.cursor++, prev = h.cells[i]
    if (!prev || !same(prev.deps, deps)) {
      prev?.cleanup?.()
      h.cells[i] = { deps }
      h.effects.push(() => { h.cells[i].cleanup = fn() })
    }
  },
}
let captured
new Function('window', readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8'))({
  __ModuleLoader__: { load: (m) => { captured = m } },
})
const mod = captured.factory((id) => id === 'react' ? hooks : require(id))
const t = (key) => key
let account = {
  serverUrl: 'https://offline-a.example', keyConfigured: true, keySource: 'file',
  account: { id: 'user-a', displayName: 'Fixture', roles: ['RESEARCHER'] },
}
const calls = []
let mineWait
const send = async (endpoint, payload) => {
  calls.push({ endpoint, payload, server: account.serverUrl })
  if (endpoint === 'account/state' || endpoint === 'account/verify') return { ok: true, value: { ...account, account: { ...account.account } } }
  if (endpoint === 'work/mine') {
    if (mineWait) return mineWait
    return { ok: true, value: { items: [], registry: { available: false, reason: 'fixture-registry-unavailable' } } }
  }
  if (endpoint === 'mentor/list') return { ok: true, value: { proposals: [] } }
  if (endpoint === 'work/list') return { ok: true, value: { items: [] } }
  throw new Error(`Unexpected endpoint: ${endpoint}`)
}
const count = (endpoint) => calls.filter((x) => x.endpoint === endpoint).length
const listCalls = () => calls.filter((x) => ['work/mine', 'work/list', 'mentor/list'].includes(x.endpoint)).length
function mount(sessionId = 'task-a') {
  return { cells: [], effects: [], dirty: true, cursor: 0, tree: null,
    props: { send, initial: account, t, session: { sessionId, draftEmpty: false } },
  }
}
async function settle(h) {
  for (let n = 0; n < 25; n++) {
    if (h.dirty) {
      h.dirty = false; h.cursor = 0; active = h
      h.tree = mod.CommunityTab(h.props)
      for (const run of h.effects.splice(0)) run()
    }
    await new Promise(setImmediate)
    if (!h.dirty && !h.effects.length) return
  }
  throw new Error('Effects did not settle')
}
function* walk(node) {
  if (!node) return
  if (Array.isArray(node)) { for (const child of node) yield* walk(child); return }
  yield node
  if (node.props) yield* walk(node.props.children)
}
const text = (h) => [...walk(h.tree)].filter((x) => typeof x === 'string').join(' ')
const unmount = (h) => h.cells.forEach((cell) => cell?.cleanup?.())
const state = async (h, next) => { account = next; h.cells[0] = next; h.dirty = true; await settle(h) }

const first = mount()
await settle(first)
assert.equal(count('work/mine'), 1)
assert.equal(count('work/list'), 2)
assert.ok(text(first).includes('fixture-registry-unavailable'))
const loaded = listCalls()
await state(first, { ...account, account: { ...account.account } })
assert.equal(listCalls(), loaded, 'account object replacement must not reload lists')
unmount(first)
const second = mount()
await settle(second)
assert.equal(listCalls(), loaded, 'remount uses cached lists')
assert.ok(text(second).includes('fixture-registry-unavailable'), 'cache preserves unavailable registry state')
const refresh = [...walk(second.tree)].find((x) => x.type?.name === 'RefreshIconButton')
assert.ok(refresh, 'mine tab exposes a refresh action')
refresh.props.onClick()
await settle(second)
assert.equal(count('work/mine'), 2, 'manual refresh reloads mine')

await state(second, { ...account, serverUrl: 'https://offline-b.example' })
assert.equal(count('work/mine'), 3, 'new server misses cache')
await state(second, { ...account, account: { ...account.account, id: 'user-b' } })
assert.equal(count('work/mine'), 4, 'new account misses cache')
unmount(second)
const third = mount('task-b')
await settle(third)
assert.equal(count('work/mine'), 5, 'another workspace cannot reuse local registry results')

// A response begun for the old account/server must never overwrite the new view.
let finish
mineWait = new Promise((resolve) => { finish = resolve })
await state(third, { ...account, serverUrl: 'https://offline-slow.example' })
mineWait = undefined
await state(third, { ...account, serverUrl: 'https://offline-new.example' })
finish({ ok: true, value: { items: [], registry: { available: false, reason: 'stale-response' } } })
await settle(third)
assert.ok(!text(third).includes('stale-response'), 'late response from previous scope is ignored')
assert.ok(text(third).includes('fixture-registry-unavailable'))
unmount(third)

// A placeholder and a real descendant can coexist in defensive/legacy input.
const tree = mod.buildUploadTree([{ relPath: 'papers/', size: 0 }, { relPath: 'papers/main.tex', size: 42 }])
assert.equal(tree[0].count, 1)
assert.equal(tree[0].bytes, 42)
assert.equal(tree[0].placeholder, false)
assert.equal(mod.folderState(tree[0], new Set(['papers/main.tex'])), 'all')
assert.deepEqual(mod.treeFilePaths(mod.buildUploadTree([{ relPath: ' papers/file.tex ', size: 1 }])), [' papers/file.tex '], 'tree selection preserves exact upload-plan paths')
const many = mod.buildUploadTree(Array.from({ length: 260 }, (_, i) => ({ relPath: `papers/file-${i}.tex`, size: 1 })))
let toggled
const folderRows = mod.CategoryFileTreeView({ t, nodes: many, open: new Set(['papers::papers']), categoryId: 'papers', selection: new Set(), maxFileBytes: 100,
  onToggleFiles: (paths, next) => { toggled = { paths, next } }, onToggleOpen: () => {},
})
const boxes = [...walk(folderRows)].filter((x) => x.type === 'input' && x.props.type === 'checkbox')
assert.equal(boxes.length, 201, 'only 200 file rows render alongside the folder checkbox')
boxes[0].props.onChange({ target: { checked: true } })
assert.equal(toggled.paths.length, 260, 'folder selection includes files hidden by the row limit')
assert.equal(toggled.next, true)
boxes[0].props.onChange({ target: { checked: false } })
assert.equal(toggled.paths.length, 260)
assert.equal(toggled.next, false)
console.log('Community lists passed: remount cache, manual refresh, account/server/workspace isolation, registry failures, stale response rejection and placeholder recovery.')
