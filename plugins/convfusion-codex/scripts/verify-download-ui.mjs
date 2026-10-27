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
const timers = new Map()
let timerId = 0
const later = (fn, ms) => { const id = ++timerId; timers.set(id, { fn, ms }); return id }
const clear = (id) => timers.delete(id)
new Function('window', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8'))({
  __ModuleLoader__: { load: (m) => { captured = m } },
}, later, clear, later, clear)
const mod = captured.factory((id) => id === 'react' ? hooks : require(id))
const t = (key, args = {}) => key + (Object.keys(args).length ? JSON.stringify(args) : '')
const account = { serverUrl: 'https://download-ui.example', keyConfigured: true, keySource: 'file', account: { id: 'student', roles: ['RESEARCHER'] } }
const proposal = { id: 'proposal', projectId: 'project', direction: 'SEEK_MENTOR', status: 'ACCEPTED', projectTitle: 'Test', mentor: { id: 'teacher', displayName: 'Teacher' }, researcher: { id: 'student', displayName: 'Student' }, guidanceScope: '', totalFee: 0, depositAmount: 0, successPaymentAmount: 0, successCondition: { type: 'RESEARCH_COMPLETED', description: null }, workspaceFiles: 1, reviewFiles: 1 }
let job = null, starts = 0, cancels = 0, statuses = 0, nextId = 0, prepared = null
let holdStatus, resolveStatus, holdStart, resolveStart
const cancelledIntents = new Set()
const cancelledJob = (intent) => ({ id: `cancelled-${intent}`, state: 'cancelled', phase: 'preparing', received: 0, totalBytes: null })
const send = async (endpoint, payload) => {
  if (endpoint === 'account/state' || endpoint === 'account/verify') return { ok: true, value: account }
  if (endpoint === 'work/mine') return { ok: true, value: { items: [], registry: { available: true } } }
  if (endpoint === 'work/list') return { ok: true, value: { items: [] } }
  if (endpoint === 'mentor/list') return { ok: true, value: { proposals: [proposal] } }
  if (endpoint === 'mentor/downloadState') return { ok: true, value: { files: 1, bytes: 9999, expectedName: 'guessed.zip', available: true, reason: null, items: [{ id: 'target', title: 'Target', path: '/fixture/target' }], currentWorkspaceId: 'target', downloadRevision: 'revision' } }
  if (endpoint === 'mentor/downloadStart') {
    starts++
    if (holdStart) { holdStart = false; await new Promise((resolve) => { resolveStart = resolve }); if (cancelledIntents.has(payload.intent)) return { ok: true, value: { job: cancelledJob(payload.intent) } } }
    job = { id: `job-${++nextId}`, state: 'running', phase: 'downloading', received: 12, totalBytes: null, intent: payload.intent }
    throw new Error('Simulated lost acknowledgement')
  }
  if (endpoint === 'mentor/downloadStatus') {
    statuses++
    if (holdStatus) { holdStatus = false; return new Promise((resolve) => { resolveStatus = resolve }) }
    return { ok: true, value: { job: cancelledIntents.has(payload.intent) ? cancelledJob(payload.intent) : payload.intent && job?.intent !== payload.intent ? null : job } }
  }
  if (endpoint === 'mentor/downloadCancel') {
    cancels++
    if (!payload.jobId && payload.intent && job?.intent !== payload.intent) { cancelledIntents.add(payload.intent); return { ok: true, value: { job: cancelledJob(payload.intent) } } }
    assert.equal(payload.jobId, job.id); job = { ...job, state: 'cancelled' }; return { ok: true, value: { job } }
  }
  throw new Error(`Unexpected endpoint ${endpoint}`)
}
const h = { cells: [], effects: [], dirty: true, cursor: 0, tree: null, props: { send, initial: account, t, session: { sessionId: 'target', downloadTasks: true, draftEmpty: false, syncCommand: (zip) => `sync ${JSON.stringify(zip)}`, prepareSync: (text) => { prepared = text } } } }
async function settle() {
  for (let n = 0; n < 30; n++) {
    if (h.dirty) {
      h.dirty = false; h.cursor = 0; active = h
      h.tree = mod.CommunityTab(h.props)
      for (const run of h.effects.splice(0)) run()
    }
    await new Promise(setImmediate)
    if (!h.dirty && !h.effects.length) return
  }
  throw new Error('UI effects did not settle')
}
function* walk(node) {
  if (!node) return
  if (Array.isArray(node)) { for (const child of node) yield* walk(child); return }
  yield node
  if (node.props) yield* walk(node.props.children)
}
const nodes = () => [...walk(h.tree)]
const dialog = () => nodes().find((n) => n.type?.name === 'DownloadDialog')
const renderDialogText = () => [...walk(mod.DownloadDialog(dialog().props))].filter((x) => typeof x === 'string').join(' ')
const open = async () => { nodes().find((n) => n.props?.title === 'community.tip.download').props.onClick(); await settle() }
const tick = async () => { const pending = [...timers.entries()]; timers.clear(); for (const [, timer] of pending) timer.fn(); await settle() }
try {
  await settle()
  nodes().find((n) => n.type?.name === 'MiniTab' && n.props.children === 'community.tab.mentorship').props.onClick()
  await settle(); await open()
  assert.equal(dialog().props.busy, false)
  assert.equal(dialog().props.onCancel, undefined, 'no cancellation control before any download intent exists')
  const start = dialog().props.onDownload
  start(); start(); await settle()
  assert.equal(starts, 1, 'double click is guarded before React rerenders')
  assert.equal(dialog().props.busy, true, 'lost start response reconnects to the same running task')
  assert.equal(dialog().props.done, null, 'no speculative sync command or saved receipt')
  assert.ok(!renderDialogText().includes('community.exchange.downloadDone'))
  assert.ok(!renderDialogText().includes('%'), 'manifest size cannot be used as compressed transfer percentage')
  assert.ok(renderDialogText().includes('community.download.close'))

  const beforeClose = statuses
  dialog().props.onClose(); await settle(); await tick()
  assert.equal(dialog(), undefined)
  assert.equal(cancels, 0, 'closing does not cancel the transfer')
  assert.equal(statuses, beforeClose, 'closing stops polling')
  await open()
  assert.equal(starts, 1)
  assert.equal(dialog().props.busy, true, 'reopening discovers an existing transfer')

  // A delayed response from a closed dialog cannot corrupt a reopened one.
  holdStatus = true
  await tick()
  assert.ok(resolveStatus)
  dialog().props.onClose(); await settle(); await open()
  resolveStatus({ ok: true, value: { job: { id: 'stale', state: 'succeeded', result: { ok: true, value: { dir: '/wrong', name: 'stale.zip' } } } } })
  await settle()
  assert.equal(dialog().props.done, null)
  dialog().props.onCancel(); await settle()
  assert.equal(cancels, 1)
  assert.equal(dialog().props.busy, false)
  assert.ok(dialog().props.notice.text.includes('community.download.cancelled'))

  dialog().props.onDownload(); await settle()
  const receipt = { dir: '/fixture/target', path: '/fixture/target/actual-2.zip', name: 'actual-2.zip', bytes: 100, workspaceStatus: 'same' }
  job = { ...job, state: 'succeeded', result: { ok: true, value: receipt } }
  await tick()
  assert.equal(dialog().props.done.name, 'actual-2.zip')
  assert.equal(dialog().props.done.prompt, 'sync "/fixture/target/actual-2.zip"')
  assert.equal(dialog().props.done.fillHint, null, 'Codex sync action must not claim the user is outside a chat')
  assert.equal(dialog().props.busy, false)
  dialog().props.onRequest(); await settle()
  assert.equal(prepared, 'sync "/fixture/target/actual-2.zip"')
  job = null
  await open()
  holdStart = true
  dialog().props.onDownload(); await settle()
  assert.ok(resolveStart)
  dialog().props.onCancel(); await settle()
  assert.equal(dialog().props.busy, false, 'cancel can precede the start acknowledgement')
  assert.ok(dialog().props.notice.text.includes('community.download.cancelled'))
  dialog().props.onDownload(); await settle()
  assert.equal(dialog().props.busy, true, 'a new intent can retry while an old start response is delayed')
  const activeId = job.id
  resolveStart(); await settle()
  assert.equal(dialog().props.busy, true, 'late cancelled response cannot replace a newer running task')
  assert.equal(job.id, activeId)
  dialog().props.onCancel(); await settle()
  console.log('Download UI passed: lost acknowledgement recovery, click deduplication, close/reopen, polling cleanup, stale responses, cancellation, truthful progress and verified filenames (offline component hooks).')
} finally { for (const cell of h.cells) cell?.cleanup?.(); timers.clear() }
