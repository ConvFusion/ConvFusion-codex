/** Private adapter state shared by short-lived hooks and the long-lived MCP process. */
import { createHash, randomBytes } from 'node:crypto'
import { existsSync, readFileSync, mkdirSync, writeFileSync, renameSync, chmodSync, realpathSync, statSync, openSync, closeSync, unlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join } from 'node:path'

export function codexHome(env: NodeJS.ProcessEnv = process.env): string {
  return env.CONVFUSION_CODEX_HOME || join(env.CODEX_HOME || join(homedir(), '.codex'), 'convfusion')
}
export function stateKey(value: string): string { return createHash('sha256').update(value).digest('hex').slice(0, 24) }
export function readPrivateJson<T>(path: string, fallback: T): T {
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) as T : fallback
}
export function writePrivateJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const temp = `${path}.${randomBytes(8).toString('hex')}.tmp`
  writeFileSync(temp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' })
  renameSync(temp, path)
  chmodSync(path, 0o600)
}
export function withPrivateLock<T>(path: string, work: () => T): T {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const lock = `${path}.lock`
  let fd: number | undefined
  for (let attempt = 0; attempt < 40; attempt++) {
    try { fd = openSync(lock, 'wx', 0o600); writeFileSync(fd, String(process.pid)); break }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      // Recover a lock abandoned by a crashed hook, without stealing a live process's lock.
      try {
        const owner = Number(readFileSync(lock, 'utf8'))
        if (Number.isInteger(owner) && owner > 0) {
          try { process.kill(owner, 0) }
          catch (probe) { if ((probe as NodeJS.ErrnoException).code === 'ESRCH') { unlinkSync(lock); continue } }
        }
      } catch { /* another process may have released it already */ }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25)
    }
  }
  if (fd === undefined) throw new Error('ConvFusion adapter state is busy; retry the operation.')
  try { return work() } finally { closeSync(fd); unlinkSync(lock) }
}
export interface CodexWorkspace { id: string; path: string; title: string; updatedAt: string }
export function readCodexWorkspaces(home: string): CodexWorkspace[] {
  const rows = readPrivateJson<unknown>(join(home, 'workspaces.json'), [])
  return Array.isArray(rows) ? rows.filter((row): row is CodexWorkspace => {
    try { return typeof row?.path === 'string' && isAbsolute(row.path) && typeof row.id === 'string' && statSync(row.path).isDirectory() }
    catch { return false }
  }) : []
}
export function registerCodexWorkspace(home: string, root: string): CodexWorkspace {
  const path = realpathSync(root)
  const row = { id: stateKey(path), path, title: basename(path), updatedAt: new Date().toISOString() }
  withPrivateLock(join(home, 'workspaces.json'), () => {
    const rows = readCodexWorkspaces(home).filter((old) => old.id !== row.id)
    writePrivateJson(join(home, 'workspaces.json'), [row, ...rows])
  })
  return row
}
