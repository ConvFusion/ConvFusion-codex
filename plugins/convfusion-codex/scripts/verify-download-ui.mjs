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
proposal.workName = 'Current research work name'
const uploadProposal = { ...proposal, id: 'upload-proposal', projectId: 'upload-project', direction: 'SEEK_STUDENT', workspaceFiles: 0 }
const target = (id, status) => ({ id, title: id, path: `/fixture/${id}`, status, exists: true, identityConflict: false })
let downloadItems = [target('unrelated', 'other'), target('target', 'same'), target('empty', 'new')]
let currentWorkspaceId = 'unrelated'
let protocol = 31
let pickerCalls = 0
let finishPicker
let uploadMatch = true
const uploadPlans = []
let job = null, starts = 0, cancels = 0, statuses = 0, nextId = 0, prepared = null
let holdStatus, resolveStatus, holdStart, resolveStart, startPayload
const cancelledIntents = new Set()
const cancelledJob = (intent) => ({ id: `cancelled-${intent}`, state: 'cancelled', phase: 'preparing', received: 0, totalBytes: null })
const send = async (endpoint, payload) => {
  if (endpoint.startsWith('mentor/download')) assert.equal(payload.source, 'counterpart', 'preflight and task operations download the counterpart side')
  if (endpoint === 'account/state' || endpoint === 'account/verify') return { ok: true, value: account }
  if (endpoint === 'work/mine') return { ok: true, value: { items: [], registry: { available: true } } }
  if (endpoint === 'work/list') return { ok: true, value: { items: [] } }
  if (endpoint === 'mentor/list') return { ok: true, value: { proposals: [proposal, uploadProposal] } }
  if (endpoint === 'mentor/downloadState') return { ok: true, value: { files: 1, bytes: 9999, expectedName: 'guessed.zip', available: true, reason: null, items: downloadItems, currentWorkspaceId, protocol, downloadRevision: 'revision' } }
  if (endpoint === 'codex/pickDownloadFolder') {
    assert.equal(payload.projectId, proposal.projectId)
    pickerCalls++
    return new Promise((resolve) => { finishPicker = (picked) => resolve({ ok: true, value: { target: picked } }) })
  }
  if (endpoint === 'mentor/uploadState') {
    assert.equal(payload.projectId, uploadProposal.projectId)
    return { ok: true, value: { available: true, currentWorkspaceId: 'unrelated', items: [
      { id: 'unrelated', title: 'Unrelated', path: '/fixture/unrelated', root: '/fixture/unrelated/workspace' },
      { id: 'target', title: 'Target', path: '/fixture/target', root: '/fixture/target/workspace', matchesProject: uploadMatch },
    ] } }
  }
  if (endpoint === 'mentor/uploadPlan') {
    uploadPlans.push(payload.workspaceId)
    return { ok: true, value: { workspaceId: payload.workspaceId, plan: { defaultSelection: [] } } }
  }
  if (endpoint === 'mentor/downloadStart') {
    startPayload = payload
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
const h = { cells: [], effects: [], dirty: true, cursor: 0, tree: null, props: { send, initial: account, t, session: { sessionId: 'target', downloadTasks: true, pickDownloadFolder: true, draftEmpty: false, syncCommand: (zip) => `sync ${JSON.stringify(zip)}`, prepareSync: (text) => { prepared = text } } } }
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
const uploadDialog = () => nodes().find((n) => n.type?.name === 'UploadDialog')
const openUpload = async () => { nodes().find((n) => n.props?.title === 'community.tip.upload').props.onClick(); await settle() }
const renderDialogText = () => [...walk(mod.DownloadDialog(dialog().props))].filter((x) => typeof x === 'string').join(' ')
const open = async () => { nodes().find((n) => n.props?.title === 'community.tip.download').props.onClick(); await settle() }
const tick = async () => { const pending = [...timers.entries()]; timers.clear(); for (const [, timer] of pending) timer.fn(); await settle() }
try {
  await settle()
  nodes().find((n) => n.type?.name === 'MiniTab' && n.props.children === 'community.tab.mentorship').props.onClick()
  await settle(); await open()
  assert.equal(dialog().props.selection, 'target', 'the unique match wins over an unrelated current workspace')
  const pickerTree = mod.DownloadDialog(dialog().props)
  const browseButton = [...walk(pickerTree)].find((n) => n.type === 'button' && n.props.children === 'community.exchange.otherDestinations')
  const optionIds = (node) => [...walk(node)].filter((n) => n.type === 'option' && n.props.value).map((n) => n.props.value)
  assert.ok(browseButton, 'the system picker is available alongside the matching workspace')
  assert.deepEqual(optionIds(pickerTree), ['target'], 'unrelated local workspaces are never rendered as options')
  assert.ok(renderDialogText().includes('community.exchange.ws.same'))
  browseButton.props.onClick(); browseButton.props.onClick(); await settle()
  assert.equal(pickerCalls, 1)
  assert.ok(dialog().props.pickingFolder)
  assert.equal(starts, 0, 'opening the chooser never starts a download')
  finishPicker(null); await settle()
  assert.equal(dialog().props.selection, 'target', 'cancelling the chooser retains the matching destination')
  assert.equal(dialog().props.busy, false)
  assert.equal(dialog().props.onCancel, undefined, 'no cancellation control before any download intent exists')
  const start = dialog().props.onDownload
  start(); start(); await settle()
  assert.equal(starts, 1, 'double click is guarded before React rerenders')
  assert.equal(startPayload.projectTitle, proposal.workName, 'sync notes receive the work name')
  assert.equal(startPayload.prefix, `Student-${proposal.workName}`, 'fallback filename uses the work name')
  assert.equal(startPayload.archiveSide, 'mentor', 'Codex uses the counterpart side for the local archive name')
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
  assert.ok(dialog().props.done.fillHint.includes('community.merge.otherWorkspace'))
  assert.equal(dialog().props.busy, false)
  assert.equal(dialog().props.onRequest, undefined, 'a matching directory in another chat still uses copy')
  currentWorkspaceId = 'target'
  downloadItems.push(target('copy', 'same'))
  await open()
  assert.equal(dialog().props.selection, 'target', 'the current match wins when several directories match')
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
  dialog().props.onClose(); await settle()

  job = null
  currentWorkspaceId = 'unrelated'
  await open()
  assert.equal(dialog().props.selection, '', 'several matching copies require a choice when none is current')
  downloadItems = downloadItems.filter((w) => w.status !== 'same')
  await open()
  assert.equal(dialog().props.selection, '', 'no match leaves the destination blank')
  assert.ok(renderDialogText().includes('community.exchange.noMatchingDestination'))
  const beforeManual = starts
  dialog().props.onDownload(); await settle()
  assert.equal(starts, beforeManual, 'no destination means no start request')
  protocol = undefined
  downloadItems = []
  await open()
  assert.equal(dialog().props.selection, '', 'an empty workspace list still supports browsing')
  dialog().props.onBrowse(); await settle()
  finishPicker(target('folder-outside-registry', 'new')); await settle()
  assert.ok(renderDialogText().includes('/fixture/folder-outside-registry'))
  assert.equal(starts, beforeManual, 'picking a folder still requires clicking Download')
  dialog().props.onDownload(); await settle()
  assert.equal(startPayload.workspaceId, 'folder-outside-registry', 'the native picker result is used for download')
  dialog().props.onCancel(); await settle()
  dialog().props.onClose(); await settle()

  await openUpload()
  assert.equal(uploadDialog().props.workspaceId, 'target', 'upload preselects the confirmed research, not the current workspace')
  assert.deepEqual(uploadPlans, ['target'])
  uploadDialog().props.onClose(); await settle()
  uploadMatch = false
  await openUpload()
  assert.equal(uploadDialog().props.workspaceId, '', 'upload waits for a manual choice when identity is unavailable')
  assert.deepEqual(uploadPlans, ['target'], 'no upload plan is loaded for an unconfirmed workspace')
  uploadDialog().props.onSelectWorkspace('unrelated'); await settle()
  assert.deepEqual(uploadPlans, ['target', 'unrelated'])
  console.log('File exchange UI passed: workspace matches, explicit fallback selection, transfer recovery, cancellation, progress and verified filenames.')
} finally { for (const cell of h.cells) cell?.cleanup?.(); timers.clear() }
