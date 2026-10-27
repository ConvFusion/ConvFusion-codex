/** Durable downloads shared by Codex's concurrent/replacement MCP hosts. */
import { createHash, randomBytes } from 'node:crypto'
import { existsSync, statSync, unlinkSync } from 'node:fs'
import { dirname, join, basename } from 'node:path'
import { readPrivateJson, writePrivateJson, withPrivateLock } from './storage.js'

type Result = { ok: boolean; value?: unknown; error?: { code: string; message: string } }
type State = 'running' | 'finalizing' | 'cancelling' | 'succeeded' | 'failed' | 'cancelled' | 'interrupted'
export interface DownloadControl {
  signal: AbortSignal
  check(): void
  onPart(path: string): void
  onProgress(received: number): void
  onHeaders(totalBytes: number | null): void
  validating(): void
  onSaved(value: { path: string; [key: string]: unknown }): void
}
export interface DownloadJob {
  id: string
  state: State
  phase: 'preparing' | 'downloading' | 'validating'
  received: number
  totalBytes: number | null
  result?: Result
}
interface Record extends DownloadJob {
  pid: number
  heartbeat: number
  revision: string | null
  directory: string
  part?: string
  stamp?: string
  intents: string[]
}
const active = (job: DownloadJob) => ['running', 'finalizing', 'cancelling'].includes(job.state)
const stamp = (file: unknown): string | null => {
  if (typeof file !== 'string') return null
  try {
    const s = statSync(file)
    return s.isFile() ? [s.dev, s.ino, s.size, s.mtimeMs, s.ctimeMs].join(':') : null
  } catch { return null }
}
const resultStamp = (result?: Result) => stamp((result?.value as { path?: unknown } | undefined)?.path)
const view = ({ id, state, phase, received, totalBytes, result }: Record): DownloadJob => ({ id, state, phase, received, totalBytes, ...(result ? { result } : {}) })

export function createDownloadJobs(home: string) {
  const workers = new Map<string, { controller: AbortController; done: Promise<void> }>()
  const fileOf = (scope: string) => join(home, 'download-jobs', `${createHash('sha256').update(scope).digest('hex')}.json`)
  const cancellationFile = (scope: string, intent: string) => join(home, 'download-cancellations', `${createHash('sha256').update(JSON.stringify([scope, intent])).digest('hex')}.json`)
  const cancelledIntent = (scope: string, intent?: string): Record | null => intent && existsSync(cancellationFile(scope, intent)) ? {
    id: `cancelled-${createHash('sha256').update(intent).digest('hex').slice(0, 32)}`,
    state: 'cancelled', phase: 'preparing', received: 0, totalBytes: null,
    pid: 0, heartbeat: 0, directory: '', revision: null, intents: [intent],
    result: { ok: false, error: { code: 'cancelled', message: '下载已取消。' } },
  } : null
  const read = (file: string): Record | null => readPrivateJson<Record | null>(file, null)
  const clean = (job: Record) => {
    // Only remove a temporary file recorded by the worker, never a finished ZIP.
    if (job.part && dirname(job.part) === job.directory && /^\.convfusion-.*\.zip\.part$/.test(basename(job.part))) {
      try { unlinkSync(job.part) } catch { /* already cleaned */ }
    }
  }
  const recover = (file: string): Record | null => {
    const job = read(file)
    if (!job) return null
    let alive = true
    if (active(job)) {
      try { process.kill(job.pid, 0) } catch (e) { alive = (e as NodeJS.ErrnoException).code !== 'ESRCH' }
      if (!alive || Date.now() - job.heartbeat > 45_000) {
        if (job.result?.ok && job.stamp && resultStamp(job.result) === job.stamp) job.state = 'succeeded'
        else {
          job.state = 'interrupted'
          job.result = { ok: false, error: { code: 'interrupted', message: '下载进程已中断，请重新下载。' } }
        }
        writePrivateJson(file, job)
        clean(job)
      }
    } else if (job.state === 'succeeded' && (!job.stamp || resultStamp(job.result) !== job.stamp)) {
      job.state = 'interrupted'
      job.result = { ok: false, error: { code: 'local-file-changed', message: '已下载的 ZIP 已被移动、删除或修改，请重新下载。' } }
      writePrivateJson(file, job)
    }
    return job
  }
  const get = (scope: string, revision?: string, id?: string, intent?: string): DownloadJob | null => {
    const file = fileOf(scope)
    return withPrivateLock(file, () => {
      const cancelled = cancelledIntent(scope, intent)
      if (cancelled) return !id || id === cancelled.id ? view(cancelled) : null
      const job = recover(file)
      if (!job || (id && job.id !== id)) return null
      if (intent && !job.intents.includes(intent)) return null
      if (!id && !intent && job.state === 'succeeded' && job.revision !== revision) return null
      return view(job)
    })
  }
  const start = (scope: string, revision: string, directory: string, execute: (control: DownloadControl) => Promise<Result>, verifyRevision: () => Promise<string | null>, intent?: string): DownloadJob => {
    const file = fileOf(scope)
    let created = false
    const initial = withPrivateLock(file, () => {
      const cancelled = cancelledIntent(scope, intent)
      if (cancelled) return cancelled
      const old = recover(file)
      if (old && (active(old) || (old.state === 'succeeded' && (old.revision === revision || !!intent && old.intents.includes(intent))))) {
        if (intent && !old.intents.includes(intent)) { old.intents = [...old.intents, intent].slice(-128); writePrivateJson(file, old) }
        return old
      }
      const job: Record = { id: randomBytes(16).toString('hex'), state: 'running', phase: 'preparing', received: 0, totalBytes: null, pid: process.pid, heartbeat: Date.now(), revision, directory, intents: intent ? [intent] : [] }
      writePrivateJson(file, job)
      created = true
      return job
    })
    if (!created) return view(initial)
    const controller = new AbortController()
    let lastProgress = 0
    let latestReceived = 0
    const change = (update: (job: Record) => void) => withPrivateLock(file, () => {
      const job = read(file)
      if (!job || job.id !== initial.id || !active(job)) return
      update(job)
      writePrivateJson(file, job)
    })
    const check = () => {
      controller.signal.throwIfAborted()
      const job = read(file)
      if (!job || job.id !== initial.id || !['running', 'finalizing'].includes(job.state)) {
        controller.abort()
        controller.signal.throwIfAborted()
      }
    }
    const control: DownloadControl = {
      signal: controller.signal, check,
      onPart: (part) => { check(); change((job) => { job.part = part }) },
      onProgress: (received) => {
        latestReceived = received
        if (Date.now() - lastProgress < 250) return
        lastProgress = Date.now()
        change((job) => { job.received = received; job.phase = 'downloading'; job.heartbeat = Date.now() })
      },
      onHeaders: (totalBytes) => change((job) => { job.totalBytes = totalBytes }),
      validating: () => { check(); change((job) => { job.phase = 'validating'; job.received = latestReceived }) },
      onSaved: (value) => change((job) => {
        job.state = 'finalizing'; job.result = { ok: true, value }; job.stamp = stamp(value.path) ?? undefined
      }),
    }
    // A page closing or an RPC timing out does not own the transfer's lifetime.
    const heartbeat = setInterval(() => {
      try { check(); change((job) => { job.heartbeat = Date.now(); job.received = latestReceived }) }
      catch { controller.abort() }
    }, 500)
    const done = Promise.resolve().then(async () => {
      let result: Result
      try { result = await execute(control) }
      catch { result = { ok: false, error: { code: 'download-failed', message: '下载未完成，请重试。' } } }
      // The archive and its manifest must describe one stable remote version.
      // If files changed during transfer, keep the ZIP but do not reuse it for a later intent.
      let settledRevision: string | null = null
      if (result.ok) {
        try { settledRevision = await verifyRevision() } catch { /* unknown revision is never reusable */ }
      }
      change((job) => {
        job.received = latestReceived
        job.revision = settledRevision === revision ? revision : null
        if (result.ok) {
          job.state = 'succeeded'; job.result = result; job.stamp = resultStamp(result) ?? undefined
        } else if (job.state === 'cancelling' || controller.signal.aborted) {
          job.state = 'cancelled'; job.result = { ok: false, error: { code: 'cancelled', message: '下载已取消。' } }
        } else { job.state = 'failed'; job.result = result }
      })
    }).catch(() => { controller.abort() })
      .finally(() => { clearInterval(heartbeat); workers.delete(initial.id) })
    workers.set(initial.id, { controller, done })
    return view(initial)
  }
  const cancel = (scope: string, id?: string, intent?: string): DownloadJob | null => {
    const file = fileOf(scope)
    const result = withPrivateLock(file, () => {
      const job = recover(file)
      if (!job || (id ? job.id !== id : !intent || !job.intents.includes(intent))) {
        if (id || !intent) return null
        // Cancel can arrive while start is still reading the remote manifest.
        // Serialize this tombstone with start so a late request cannot launch a transfer.
        writePrivateJson(cancellationFile(scope, intent), { cancelled: true })
        return view(cancelledIntent(scope, intent)!)
      }
      if (job.state === 'running') { job.state = 'cancelling'; writePrivateJson(file, job) }
      return view(job)
    })
    if (result?.state === 'cancelling') workers.get(result.id)?.controller.abort()
    return result
  }
  return { get, start, cancel, async close() {
    const current = [...workers.values()]
    for (const worker of current) worker.controller.abort()
    await Promise.all(current.map((worker) => worker.done))
  } }
}
