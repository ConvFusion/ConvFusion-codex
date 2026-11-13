import { createHash, randomUUID } from 'node:crypto'
import { readFile, realpath } from 'node:fs/promises'
import type { Config } from '../config.js'
import { safeJoin } from '../research/workspace-sync.js'
import { planUploadBatches } from '../research/upload-selection.js'
import {
  ServerError, stageWorkspaceFiles, workspaceUploadRequest,
  type ServerRequestOptions, type UploadManifestFile, type WorkspaceUploadStatus,
} from '../server-client.js'

export interface UploadProgress {
  doneFiles: number
  totalFiles: number
  sentBytes: number
  totalBytes: number
  running: boolean
}

export interface UploadControl {
  config: Config
  signal: AbortSignal
  progress: UploadProgress
  cancelRemote?: (() => Promise<WorkspaceUploadStatus>) | undefined
  finishing: boolean
}

export async function transferWorkspace(
  base: string, key: string, projectId: string, root: string, paths: readonly string[],
  options: ServerRequestOptions, control: UploadControl, timeoutForBytes: (bytes: number) => number,
  state?: { content: unknown; baseVersion: number | null },
) {
  const signal = control.signal
  const uniquePaths = [...new Set(paths)]
  const { batches, skipped } = planUploadBatches(root, uniquePaths)
  if (batches.flat().length + skipped.length !== uniquePaths.length) {
    throw new Error('选中的文件已被移除，请重新选择后上传。')
  }

  if (skipped.length) {
    throw new Error(`有 ${skipped.length} 个文件超过单文件上传上限。请取消选中这些文件后再上传。`)
  }
  const canonicalRoot = await realpath(root)
  const read = async (path: string): Promise<Uint8Array> => {
    signal.throwIfAborted()
    const absolute = safeJoin(root, path)
    if (!absolute) throw new Error('所选文件路径无效，请重新扫描工作区。')
    const canonical = await realpath(absolute)
    if (canonical !== safeJoin(canonicalRoot, path)) {
      throw new Error('选中的文件已变为符号链接，请重新选择。')
    }
    return await readFile(canonical, { signal })
  }

  const manifest: UploadManifestFile[] = []
  for (const batch of batches) {
    for (const path of batch) {
      const bytes = await read(path)
      manifest.push({ path, size: bytes.length, sha256: `sha256:${createHash('sha256').update(bytes).digest('hex')}` })
    }
  }
  signal.throwIfAborted()
  const id = randomUUID()
  const request = (method: 'GET' | 'POST' | 'DELETE', suffix: string, body?: unknown, timeoutMs?: number) =>
    workspaceUploadRequest(base, key, projectId, method, suffix, body,
      { ...options, ...(timeoutMs === undefined ? {} : { timeoutMs }) })
  const retry = async <T>(send: () => Promise<T>): Promise<T> => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await send()
      } catch (error) {
        if (!(error instanceof ServerError && error.code === 'unreachable') || attempt === 2) throw error
      }
    }
  }
  const body = {
    id, files: manifest,
    ...(state ? { state: state.content, base_version: state.baseVersion } : {}),
  }

  let job: WorkspaceUploadStatus
  try {
    job = await retry(() => request('POST', '', body, 60_000))
  } catch (error) {
    if (error instanceof ServerError && error.serverCode === 'UPLOAD_IN_PROGRESS') {
      const active = await request('GET', '/active')
      if (active?.id) control.cancelRemote = () => request('DELETE', `/${active.id}`)
    } else if (error instanceof ServerError && error.code === 'unreachable') {
      // Resolve a lost start acknowledgement with the same id.
      control.cancelRemote = () => request('DELETE', `/${id}`)
    }
    throw error
  }
  const resource = `/${job.id}`
  control.cancelRemote = () => request('DELETE', resource)
  signal.throwIfAborted()
  if (job.status === 'cancelled') throw new Error('上传任务已取消或过期，请重新开始。')

  if (job.status === 'pending') {
    const indexes = new Map(manifest.map((file, index) => [file.path, index]))
    const received = new Set(job.received)
    const needed = new Set(job.needed)
    const progress = control.progress
    progress.totalFiles = needed.size
    progress.totalBytes = job.needed.reduce((bytes, index) => bytes + manifest[index]!.size, 0)
    progress.doneFiles = received.size
    progress.sentBytes = job.received.reduce((bytes, index) => bytes + manifest[index]!.size, 0)
    for (const batch of batches) {
      signal.throwIfAborted()
      const pending = batch.map((path) => indexes.get(path)!).filter((index) => needed.has(index) && !received.has(index))
      if (!pending.length) continue
      const files: Array<{ index: number; path: string; bytes: Uint8Array }> = []
      for (const index of pending) {
        const { path } = manifest[index]!
        files.push({ index, path, bytes: await read(path) })
      }
      const bytes = files.reduce((total, file) => total + file.bytes.length, 0)
      let remaining = files
      await retry(async () => {
        signal.throwIfAborted()
        if (!remaining.length) return
        try {
          await stageWorkspaceFiles(base, key, projectId, job.id, remaining, {
            ...options, timeoutMs: timeoutForBytes(bytes), signal,
          })
        } catch (error) {
          if (error instanceof ServerError && error.code === 'unreachable') {
            const status = await request('GET', resource)
            const verified = new Set(status.received)
            remaining = remaining.filter((file) => !verified.has(file.index))
            if (!remaining.length) return
          }
          throw error
        }
      })
      progress.doneFiles += files.length
      progress.sentBytes += bytes
    }
    signal.throwIfAborted()
    control.finishing = true
    try {
      job = await retry(() => request('POST', `${resource}/complete`, undefined, 120_000))
    } catch (error) {
      if (error instanceof ServerError && error.code === 'unreachable') {
        job = await request('GET', resource)
        if (job.status !== 'completed') throw error
      } else throw error
    }
  }
  if (job.status !== 'completed' || !job.receipt) throw new Error('服务器尚未确认完整上传。')
  control.cancelRemote = undefined
  return { receipt: job.receipt, skipped, manifest }
}
