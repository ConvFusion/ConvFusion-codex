#!/usr/bin/env node
/** Offline integration through the shipped Codex adapter and real streamed ZIP writes. */
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readdir, readFile, writeFile, stat, rm, realpath, rename, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fork } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createCodexUiHost } from './codex-ui-server.mjs'
import { fetchProjectArchive } from '../lib/server-client.js'

const key = 'cf_live_download_offline_fixture'
const env = { CONVFUSION_ENV: 'production', CONVFUSION_ENV_FILE: '-' }
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const zip = Buffer.from('UEsDBBQAAAAAAAAAW12WFM9YBwAAAAcAAAAIAAAAY2hlY2subWQjIFRlc3QKUEsBAhQDFAAAAAAAAABbXZYUz1gHAAAABwAAAAgAAAAAAAAAAAAAAIABAAAAAGNoZWNrLm1kUEsFBgAAAAABAAEANgAAAC0AAAAAAA==', 'base64')
function fixture() {
  let revision = 1
  let mode = 'normal'
  let blockPostflight = false
  const transfers = []
  const fetchImpl = async (url, init) => {
    const u = new URL(url)
    const json = (body, status = 200) => new Response(JSON.stringify(body), { status })
    if (u.pathname.endsWith('/auth/me')) return json({ id: 'fixture-account', email: 'fixture@example.com', display_name: 'Offline fixture', status: 'ACTIVE', roles: ['RESEARCHER'] })
    if (u.pathname.endsWith('/tokens')) return json({ available_balance: 100, frozen_balance: 0, total_balance: 100 })
    if (u.pathname.endsWith('/files') && blockPostflight && transfers.length) return new Promise(() => {})
    if (u.pathname.endsWith('/files')) return json({ workspace_id: `ws_${'a'.repeat(32)}`, items: [{ id: `version-${revision}`, relative_path: 'check.md', size: 7, sha256: `digest-${revision}` }] })
    if (u.pathname.endsWith('/files/archive')) {
      if (mode === 'forbidden') return json({ detail: 'Forbidden' }, 403)
      let finish
      const body = new ReadableStream({ start(controller) {
        controller.enqueue(zip.subarray(0, 12))
        let ended = false
        let offset = 12
        let tick, complete
        finish = (truncated = false) => {
          if (ended) return
          ended = true
          clearInterval(tick); clearTimeout(complete)
          if (!truncated) controller.enqueue(zip.subarray(offset))
          controller.close()
        }
        init.signal.addEventListener('abort', () => { if (!ended) { ended = true; clearInterval(tick); clearTimeout(complete); controller.error(new Error('aborted')) } }, { once: true })
        if (mode === 'long') {
          tick = setInterval(() => { controller.enqueue(zip.subarray(offset, ++offset)) }, 2000)
          complete = setTimeout(() => finish(), 185_000)
        }
      } })
      transfers.push({ finish, signal: init.signal, url })
      const source = u.searchParams.get('source')
      return new Response(body, { headers: { 'content-disposition': 'attachment; filename="teacher-final.zip"', 'x-source': source ? 'mentor' : 'owner', 'x-file-count': '1', ...(mode === 'unknown-length' ? {} : { 'content-length': String(zip.length) }) } })
    }
    throw new Error(`Unexpected fixture route ${u.pathname}`)
  }
  return { fetchImpl, transfers, next: () => revision++, version: (value) => { revision = value }, blockPostflight: () => { blockPostflight = true }, mode: (value) => { mode = value } }
}
const until = async (read, predicate) => {
  for (let n = 0; n < 300; n++) {
    const value = await read()
    if (predicate(value)) return value
    await sleep(10)
  }
  throw new Error('Fixture did not reach the expected state')
}
if (['--worker', '--saved-worker'].includes(process.argv[2])) {
  const [home, root] = process.argv.slice(3)
  const server = fixture()
  const host = createCodexUiHost({ home, env, fetchImpl: server.fetchImpl })
  if (process.argv[2] === '--saved-worker') server.blockPostflight()
  const workspaceId = host.registerWorkspace(root).id
  const result = await host.dispatch(root, 'mentor/downloadStart', { projectId: 'crash', workspaceId, source: 'counterpart' })
  if (process.argv[2] === '--saved-worker') {
    await until(() => server.transfers.length, Boolean)
    server.transfers[0].finish()
  }
  process.send(result)
} else {
  const temp = await realpath(await mkdtemp(join(tmpdir(), 'convfusion-downloads-')))
  const home = join(temp, 'home'), root = join(temp, 'target'), other = join(temp, 'other')
  await mkdir(root); await mkdir(other)
  const server = fixture()
  let nextFolder = null
  const host = createCodexUiHost({ home, env, fetchImpl: server.fetchImpl, pickDownloadFolder: async () => nextFolder })
  const replacement = createCodexUiHost({ home, env, fetchImpl: server.fetchImpl })
  let child
  try {
    assert.equal((await host.dispatch(root, 'account/login', { apiKey: key, serverUrl: 'https://fixture.example' })).ok, true)
    const payload = { projectId: 'project', workspaceId: host.registerWorkspace(root).id, source: 'counterpart', prefix: 'guessed-name', intent: 'first-intent' }
    const call = async (endpoint, args = payload, caller = host) => {
      const res = await caller.dispatch(root, `mentor/download${endpoint}`, args)
      assert.equal(res.ok, true, JSON.stringify(res))
      return res.value.job
    }
    const status = (args = payload) => call('Status', args, replacement)
    const terminal = (args = payload) => until(() => status(args), (j) => j && !['running', 'finalizing', 'cancelling'].includes(j.state))
    const preflight = await host.dispatch(root, 'mentor/downloadState', payload)
    assert.equal(preflight.ok, true)
    payload.revision = preflight.value.downloadRevision
    const preparation = { ...payload, projectId: 'preparing', intent: 'cancel-before-start' }
    assert.equal((await call('Cancel', preparation)).state, 'cancelled')
    assert.equal((await call('Start', preparation)).state, 'cancelled', 'a delayed start cannot ignore an earlier cancellation')
    assert.equal((await status(preparation)).state, 'cancelled')
    assert.equal(server.transfers.length, 0)
    const [a, b] = await Promise.all([call('Start'), call('Start')])
    assert.equal(a.id, b.id, 'simultaneous starts join one transfer')
    await until(() => status(), (j) => j?.received === 12)
    assert.equal(server.transfers.length, 1)
    assert.equal(new URL(server.transfers[0].url).searchParams.get('source'), 'counterpart', 'Codex task adapter preserves counterpart')
    assert.equal((await status({ ...payload, revision: 'stale-ui-revision' })).id, a.id, 'lost start acknowledgement is recovered by intent even when preflight became stale')
    assert.equal(await status({ ...payload, intent: 'unstarted-intent' }), null)
    assert.equal((await status()).totalBytes, zip.length, 'progress uses compressed response size')
    assert.equal((await call('Start', payload, replacement)).id, a.id, 'replacement host joins the existing worker')
    assert.ok(!(await readdir(root)).some((name) => name.endsWith('.zip')), 'a running download cannot appear complete')
    server.transfers[0].finish()
    const completed = await terminal({ ...payload, jobId: a.id })
    assert.equal(completed.state, 'succeeded')
    assert.equal(completed.result.value.name, 'teacher-final.zip', 'receipt uses server filename, never preflight guess')
    assert.deepEqual(await readFile(completed.result.value.path), zip)
    assert.equal((await call('Start')).id, a.id, 'same completed version reuses the ZIP')
    assert.equal(server.transfers.length, 1)
    assert.equal((await stat(join(home, 'download-jobs'))).mode & 0o777, 0o700)
    for (const name of await readdir(join(home, 'download-jobs'))) {
      assert.equal((await stat(join(home, 'download-jobs', name))).mode & 0o777, 0o600)
      assert.ok(!(await readFile(join(home, 'download-jobs', name), 'utf8')).includes(key))
    }

    server.next()
    assert.equal((await call('Start')).id, a.id, 'replay of one intent retains its result even when remote files advance')
    assert.equal(server.transfers.length, 1)
    payload.intent = 'new-download-intent'

    // Modified/missing local results and remote revisions may be downloaded again.
    await writeFile(completed.result.value.path, 'changed')
    assert.equal((await status({ ...payload, intent: undefined })).state, 'interrupted')
    const changed = await call('Start')
    server.transfers.at(-1).finish()
    const repaired = await terminal({ ...payload, jobId: changed.id })
    assert.equal(repaired.state, 'succeeded')
    assert.equal(repaired.result.value.name, 'teacher-final-2.zip', 'existing files are never overwritten')
    await unlink(repaired.result.value.path)
    const missing = await call('Start')
    assert.notEqual(missing.id, changed.id)
    await call('Cancel', { ...payload, jobId: missing.id }, replacement)
    assert.equal((await terminal()).state, 'cancelled')
    assert.equal(server.transfers.at(-1).signal.aborted, true)
    assert.ok(!(await readdir(root)).some((name) => name.endsWith('.part')), 'cancellation removes partial data')

    server.next()
    payload.intent = 'fresh-version-intent'
    const fresh = await call('Start')
    assert.notEqual(fresh.id, a.id)
    assert.equal(await call('Cancel', { ...payload, jobId: a.id }), null, 'stale cancel cannot stop a new task')
    server.transfers.at(-1).finish(true)
    assert.equal((await terminal()).state, 'failed', 'truncated ZIP cannot report success')
    assert.ok(!(await readdir(root)).some((name) => name.endsWith('.part')))

    // Independent source/destination scopes do not share progress or cancellation.
    const owner = { ...payload, source: 'owner' }
    const elsewhere = { ...payload, workspaceId: host.registerWorkspace(other, true).id }
    const first = await call('Start', owner), second = await call('Start', elsewhere)
    assert.notEqual(first.id, second.id)
    await call('Cancel', { ...owner, jobId: first.id })
    assert.equal((await terminal(owner)).state, 'cancelled')
    assert.equal((await status(elsewhere)).state, 'running')
    await call('Cancel', { ...elsewhere, jobId: second.id })
    await terminal(elsewhere)
    server.mode('unknown-length')
    const unknown = await call('Start')
    assert.equal((await status()).totalBytes, null, 'no fabricated size when Content-Length is absent')
    server.next() // Upload during download invalidates reuse of this snapshot.
    server.transfers.at(-1).finish()
    assert.equal((await terminal({ ...payload, jobId: unknown.id })).state, 'succeeded')
    payload.intent = 'explicit-latest-intent'
    const newer = await call('Start')
    assert.notEqual(newer.id, unknown.id)
    await call('Cancel', { ...payload, jobId: newer.id }); await terminal()
    server.mode('forbidden')
    await call('Start')
    assert.equal((await terminal()).state, 'failed', 'server rejection is distinct from transport uncertainty')

    // A real second process owns the transfer. Killing it must recover its partial file.
    child = fork(fileURLToPath(import.meta.url), ['--worker', home, root], { silent: true })
    const response = await new Promise((resolve, reject) => { child.once('message', resolve); child.once('error', reject); child.once('exit', () => reject(new Error('worker exited early'))) })
    assert.equal(response.ok, true)
    const crash = { ...payload, projectId: 'crash', intent: undefined, jobId: response.value.job.id }
    await until(() => status(crash), (j) => j?.received === 12)
    assert.equal((await call('Start', { ...crash, jobId: undefined })).id, crash.jobId, 'cross-process retry must not start a second transfer')
    const exited = new Promise((resolve) => child.once('exit', resolve))
    child.kill('SIGKILL'); await exited; child = undefined
    assert.equal((await status(crash)).state, 'interrupted')
    assert.ok(!(await readdir(root)).some((name) => name.endsWith('.part')), 'abandoned worker data is cleaned on recovery')

    child = fork(fileURLToPath(import.meta.url), ['--worker', home, root], { silent: true })
    const cancelResponse = await new Promise((resolve, reject) => { child.once('message', resolve); child.once('error', reject); child.once('exit', () => reject(new Error('worker exited early'))) })
    const cancelTask = { ...payload, projectId: 'crash', intent: undefined, jobId: cancelResponse.value.job.id }
    await until(() => status(cancelTask), (j) => j?.received === 12)
    await call('Cancel', cancelTask, replacement)
    assert.equal((await terminal(cancelTask)).state, 'cancelled', 'another process must observe and acknowledge cancellation')
    assert.ok(!(await readdir(root)).some((name) => name.endsWith('.part')))
    if (child.exitCode === null && child.signalCode === null) {
      const cancelExit = new Promise((resolve) => child.once('exit', resolve))
      child.kill('SIGKILL'); await cancelExit
    }
    child = undefined

    // A process can also exit after publishing the ZIP, before its final metadata reply.
    server.mode('normal'); server.version(1)
    child = fork(fileURLToPath(import.meta.url), ['--saved-worker', home, root], { silent: true })
    const savedResponse = await new Promise((resolve, reject) => { child.once('message', resolve); child.once('error', reject); child.once('exit', () => reject(new Error('worker exited early'))) })
    assert.equal(savedResponse.ok, true)
    const savedTask = { ...payload, projectId: 'crash', intent: undefined, jobId: savedResponse.value.job.id }
    await until(() => status(savedTask), (j) => j?.state === 'finalizing')
    assert.equal((await call('Cancel', savedTask)).state, 'finalizing', 'a saved ZIP cannot be reported as cancelled')
    const savedExit = new Promise((resolve) => child.once('exit', resolve))
    child.kill('SIGKILL'); await savedExit; child = undefined
    const recovered = await status(savedTask)
    assert.equal(recovered.state, 'succeeded', 'recover the committed receipt after worker exit')
    const countBeforeRecovery = server.transfers.length
    assert.equal((await call('Start', savedTask)).id, savedTask.jobId, 'recovering a saved ZIP must not redownload it')
    assert.equal(server.transfers.length, countBeforeRecovery)

    const named = {
      ...payload, projectId: 'renamed-project', intent: 'local-work-name',
      archiveSide: 'mentor', prefix: '学生-当前研究工作名', projectTitle: '当前研究工作名',
    }
    const expectedName = '学生-当前研究工作名-mentor.zip'
    const namedPreflight = await host.dispatch(root, 'mentor/downloadState', named)
    assert.equal(namedPreflight.value.expectedName, expectedName)
    const renamedPreflight = await host.dispatch(root, 'mentor/downloadState', { ...named, prefix: '学生-新名称' })
    assert.notEqual(renamedPreflight.value.downloadRevision, namedPreflight.value.downloadRevision, 'a local name change invalidates reuse of the old receipt')
    const longName = await host.dispatch(root, 'mentor/downloadState', { ...named, prefix: '研'.repeat(100) })
    assert.equal(longName.value.expectedName, `${'研'.repeat(66)}-mentor.zip`, 'filenames are limited without splitting a UTF-8 character')
    await writeFile(join(root, expectedName), 'existing download')
    const task = await call('Start', named)
    server.transfers.at(-1).finish()
    const namedResult = (await terminal({ ...named, jobId: task.id })).result.value
    assert.equal(namedResult.name, '学生-当前研究工作名-mentor-2.zip', 'saved name uses the work name and preserves the source suffix and collision numbering')
    assert.equal(await readFile(join(root, expectedName), 'utf8'), 'existing download')
    assert.deepEqual(await readFile(namedResult.path), zip)
    assert.match(replacement.prepareSync(root, namedResult.path).instructions, /- 项目：当前研究工作名/)

    // Only an authenticated workbench picker grants an external ZIP destination.
    const external = join(temp, '本机 下载')
    await mkdir(external)
    const page = await host.open()
    const otherPage = await host.open()
    assert.equal(page.pickDownloadFolder, true)
    const choose = (args = named) => host.dispatchSession(page.uiSession, undefined, 'codex/pickDownloadFolder', args)
    assert.equal((await host.dispatchSession('invalid-session', undefined, 'codex/pickDownloadFolder', named)).error.code, 'auth')
    assert.equal((await choose({ ...named, path: external })).value.target, null, 'request paths cannot substitute for the system picker')
    nextFolder = external
    const picked = await choose()
    assert.equal(picked.ok, true)
    assert.equal(picked.value.target.path, external)
    assert.equal(picked.value.target.status, 'new')
    assert.deepEqual(await readdir(external), [], 'selection alone does not write anything to the chosen folder')
    const externalTask = { ...named, workspaceId: picked.value.target.id, intent: 'browse-and-download' }
    const downloadExternal = (kind, args = externalTask, caller = host, token = page.uiSession) =>
      caller.dispatchSession(token, undefined, `mentor/download${kind}`, args)
    assert.equal((await downloadExternal('Start', externalTask, host, otherPage.uiSession)).error.code, 'not-found')
    assert.equal((await downloadExternal('Start', { ...externalTask, projectId: 'another-project' })).error.code, 'not-found')
    nextFolder = null
    assert.equal((await choose()).value.target, null)
    const reopened = await downloadExternal('State', externalTask, replacement)
    assert.deepEqual(reopened.value.items, [], 'unmatched workspaces do not appear in the workbench')
    assert.equal(reopened.value.pickedDestination.id, externalTask.workspaceId, 'the chosen destination survives replacement of the MCP host')
    const transfer = await downloadExternal('Start', externalTask, replacement)
    assert.equal(transfer.ok, true, JSON.stringify(transfer))
    server.transfers.at(-1).finish()
    const externalResult = await until(async () => (await downloadExternal('Status')).value.job, (j) => j?.state === 'succeeded')
    assert.equal(externalResult.result.value.dir, external)
    assert.deepEqual(await readdir(external), [expectedName])
    assert.deepEqual(await readFile(externalResult.result.value.path), zip)
    assert.ok(!(await readFile(join(home, 'workspaces.json'), 'utf8')).includes(external), 'the picker never registers new project workspaces')
    await rename(external, join(temp, 'moved'))
    await mkdir(external)
    assert.equal((await downloadExternal('Start')).error.code, 'not-found', 'a directory at the same path must be chosen again if replaced')

    // Cancellation must work even for transports which ignore AbortSignal.
    const controller = new AbortController()
    const pending = fetchProjectArchive('https://fixture.example', key, 'project', { write() {} }, { signal: controller.signal, fetchImpl: () => new Promise(() => {}) })
    controller.abort()
    await assert.rejects(pending)

    // Header waits, stalled bodies and disk errors all have bounded cleanup paths.
    await assert.rejects(fetchProjectArchive('https://fixture.example', key, 'project', { write() {} }, {
      timeoutMs: 15, fetchImpl: () => new Promise(() => {}),
    }), /超时/)
    let stalledSignal
    await assert.rejects(fetchProjectArchive('https://fixture.example', key, 'project', { write() {} }, {
      stallTimeoutMs: 15, fetchImpl: async (_url, init) => {
        stalledSignal = init.signal
        return new Response(new ReadableStream({ start() {} }))
      },
    }), /没有收到数据/)
    assert.equal(stalledSignal.aborted, true)
    let diskSignal
    await assert.rejects(fetchProjectArchive('https://fixture.example', key, 'project', { write() { throw new Error('fixture disk full') } }, {
      fetchImpl: async (_url, init) => { diskSignal = init.signal; return new Response(zip) },
    }), /fixture disk full/)
    assert.equal(diskSignal.aborted, true, 'write failures release the upstream connection')

    if (process.argv.includes('--long')) {
      server.mode('long'); server.next()
      const before = performance.now()
      const long = await call('Start')
      assert.ok(performance.now() - before < 1000, 'starting a long transfer must return promptly')
      console.log('Continuous 185-second offline ZIP transfer started; status requests must remain short.')
      for (let seconds = 0; seconds < 195; seconds++) {
        const beforeStatus = performance.now()
        const current = await status({ ...payload, jobId: long.id })
        assert.ok(performance.now() - beforeStatus < 1000)
        if (current.state === 'succeeded') { assert.ok(seconds >= 180); break }
        assert.equal(current.state, 'running')
        assert.ok(seconds < 194, 'long transfer must finish')
        await sleep(1000)
      }
      assert.equal((await call('Start')).id, long.id, 'long completed transfer is reusable')
      console.log('185-second continuous transfer passed beyond the former 60s and 180s limits.')
    }
    console.log('Download tasks passed: simultaneous starts, completed reuse, host/process replacement, remote revisions, changed/missing ZIPs, source/destination isolation, cancellation, truncated ZIPs, server rejection and crash cleanup (offline fixtures).')
  } finally {
    child?.kill('SIGKILL')
    await host.close(); await replacement.close()
    await rm(temp, { recursive: true, force: true })
  }
}
