import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCodexUiHost } from './codex-ui-server.mjs'

const temp = await mkdtemp(join(tmpdir(), 'cf-upload-task-'))
const home = join(temp, 'home')
const root = join(temp, 'research')
const key = 'cf_live_upload_fixture'
await mkdir(home)
await mkdir(root)
await writeFile(join(home, 'config.json'), JSON.stringify({
  serverUrl: 'https://fixture.example.com', convfusionProdApiKey: key,
}))
await writeFile(join(root, 'project.md'), '---\ntitle: Fixture\n---\n')
const bytes = Buffer.from('verified bytes')
await writeFile(join(root, 'paper.md'), bytes)
const jobs = new Map()
let signalStage
const stageStarted = new Promise((resolve) => { signalStage = resolve })
let releaseStage
const stageReleased = new Promise((resolve) => { releaseStage = resolve })
let starts = 0
let completes = 0
let stages = 0
let stagedA = false
let cancelled = false
const receipt = { uploaded: 1, uploaded_bytes: bytes.length, skipped_existing: 0 }

const host = createCodexUiHost({ home, env: { CONVFUSION_ENV: 'production' }, fetchImpl: async (url, init) => {
  assert.equal(init.headers.authorization, `Bearer ${key}`)
  const [, project, suffix = ''] = /\/projects\/([^/]+)\/uploads(.*)$/.exec(url) ?? []
  assert.ok(project)
  if (!suffix) {
    starts++
    const manifest = JSON.parse(init.body)
    assert.deepEqual(manifest.files, [{
      path: 'paper.md', size: bytes.length, sha256: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
    }])
    const prior = jobs.get(project)
    if (prior) assert.equal(prior.id, manifest.id, 'retry must reuse the upload id')
    const job = prior ?? { id: manifest.id, status: 'pending', needed: [0], received: [], receipt: null }
    jobs.set(project, job)
    if (!prior && project === 'A') throw new Error('lost start acknowledgement')
    return Response.json(job)
  }
  const job = jobs.get(project)
  assert.ok(suffix.startsWith('/' + job.id))
  if (init.method === 'DELETE') {
    assert.equal(project, 'C')
    job.status = 'cancelled'
    job.received = []
    cancelled = true
    return Response.json(job)
  }
  if (suffix.endsWith('/files')) {
    stages++
    assert.equal(init.body.get('indexes'), '0')
    assert.deepEqual(Buffer.from(await init.body.get('files').arrayBuffer()), bytes)
    job.received = [0]
    if (project === 'C') {
      return await new Promise((_, reject) => {
        init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true })
      })
    }
    if (project === 'A') {
      assert.equal(stagedA, false, 'a verified batch is not resent after lost acknowledgement')
      stagedA = true
      signalStage()
      await stageReleased
      throw new Error('lost stage acknowledgement')
    }
    return Response.json({ received: [0] })
  }
  if (suffix.endsWith('/complete')) {
    assert.deepEqual(job.received, [0])
    if (job.status === 'pending') {
      completes++
      job.status = 'completed'
      job.receipt = receipt
      if (project === 'A') throw new Error('lost completion acknowledgement')
    }
    return Response.json(job)
  }
  return Response.json(job)
} })
try {
  const workspaceId = host.registerWorkspace(root).id
  const target = (projectId) => ({ kind: 'mentor', projectId, workspaceId, paths: ['paper.md'], intent: projectId })
  const start = (project) => host.dispatch(root, 'upload/start', target(project))
  const status = async (project) => {
    for (let attempt = 0; attempt < 200; attempt++) {
      const value = (await host.dispatch(root, 'upload/status', target(project))).value
      if (value?.result && !value.cancelling) return value.result
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    throw new Error('upload did not finish')
  }
  assert.equal((await start('A')).value.result, null, 'start returns while the background operation is running')
  await Promise.race([stageStarted, new Promise((_, reject) => setTimeout(() => reject(new Error('stage never started')), 2000).unref())])
  assert.equal((await start('A')).value.result, null, 'second click observes the same job')
  assert.equal((await start('B')).ok, true)
  assert.equal((await status('B')).value.uploaded, 1, 'different work can finish while A is still uploading')
  releaseStage()
  assert.equal((await status('A')).value.uploaded, 1)
  assert.equal((await start('A')).value.result.ok, true, 'replay returns the completed result')
  assert.deepEqual({ starts, stages, completes }, { starts: 3, stages: 2, completes: 2 })
  assert.equal((await start('C')).ok, true)
  for (let attempt = 0; !jobs.get('C')?.received.length && attempt < 200; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  assert.deepEqual(jobs.get('C')?.received, [0])
  assert.equal((await host.dispatch(root, 'upload/cancel', target('C'))).ok, true)
  assert.equal((await status('C')).error.code, 'upload-cancelled')
  assert.equal(cancelled, true)
  assert.equal(completes, 2, 'cancelled upload must never complete')
  console.log('Background upload passed: cancellation, independent workspaces, duplicate clicks and lost start, batch and completion acknowledgements.')
} finally {
  releaseStage()
  await host.close()
  await rm(temp, { recursive: true, force: true })
}
