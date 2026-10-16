#!/usr/bin/env node
/** Exercise installed hook JSON contracts across separate processes and the real MCP UI adapter. */
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, rmSync, realpathSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { ensureWorkspaceLayout } from '../lib/research/workspace-layout.js'
import { saveProjectFile } from '../lib/research/project.js'
import { ensureResearchState } from '../lib/research/research-state.js'
import { createPlan, listPlanVersions } from '../lib/research/plan-library.js'
import { createClaim } from '../lib/research/claims.js'
import { createCodexUiHost } from './codex-ui-server.mjs'

const plugin = resolve(new URL('..', import.meta.url).pathname)
const temp = realpathSync(mkdtempSync(join(tmpdir(), 'cf-codex-lifecycle-')))
const home = join(temp, 'home')
const root = join(temp, 'task'); mkdirSync(root)
const ws = join(root, 'workspace')
const env = { ...process.env, CONVFUSION_CODEX_HOME: home }
let sid = 'research-session'
const invoke = (event, fields = {}, cwd = root) => {
  const result = spawnSync(process.execPath, [join(plugin, 'lib/codex-hooks.mjs')], {
    input: JSON.stringify({ hook_event_name: event, cwd, session_id: sid, ...fields }),
    env, encoding: 'utf8', timeout: 20000, maxBuffer: 1024 * 1024,
  })
  assert.equal(result.status, 0, result.stderr)
  return JSON.parse(result.stdout)
}
const tree = (path) => readdirSync(path, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap((row) => {
  const p = join(path, row.name)
  return row.isDirectory() ? tree(p) : [[p, readFileSync(p, 'utf8')]]
})
try {
  const manifest = JSON.parse(readFileSync(join(plugin, '.codex-plugin/plugin.json'), 'utf8'))
  const hooks = JSON.parse(readFileSync(join(plugin, manifest.hooks), 'utf8')).hooks
  for (const event of ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'Stop', 'Interrupt']) assert.ok(hooks[event]?.length)
  assert.deepEqual(invoke('SessionStart'), {}, 'ordinary directories never initialize research')
  assert.deepEqual(readdirSync(root), [])
  // Start intent is remembered even if the research is initialized later in the same turn.
  invoke('UserPromptSubmit', { prompt: 'Create and continue this research', turn_id: 'kickoff' })
  ensureWorkspaceLayout(ws); saveProjectFile(ws, { topic: 'Lifecycle research' }); ensureResearchState(ws)
  createPlan(ws, { id: 'experiment-design', name: 'Experiment design', objective: 'Original objective' })
  const host = createCodexUiHost({ home })
  assert.match(invoke('SessionStart').hookSpecificOutput.additionalContext, /Lifecycle research/)
  assert.match(invoke('PreToolUse', { tool_name: 'apply_patch' }).hookSpecificOutput.additionalContext, /Write paper materials and data in English/)
  assert.equal(listPlanVersions(ws, 'experiment-design').length, 1)
  const unchanged = JSON.stringify(tree(ws))
  invoke('UserPromptSubmit', { prompt: '本轮只做检查，不做任何修改。', turn_id: 'readonly' })
  invoke('PreToolUse', { tool_name: 'Bash' })
  assert.deepEqual(invoke('Stop', { turn_id: 'readonly' }), {})
  assert.equal(JSON.stringify(tree(ws)), unchanged, 'read-only audit never alters research files')
  invoke('UserPromptSubmit', { prompt: 'Continue research', permission_mode: 'plan', turn_id: 'planning' })
  assert.deepEqual(invoke('Stop', { permission_mode: 'plan', turn_id: 'planning' }), {})
  assert.equal(JSON.stringify(tree(ws)), unchanged, 'Plan mode never writes research files or continues')
  invoke('UserPromptSubmit', { prompt: '导出研究方法', turn_id: 'export-only' })
  assert.deepEqual(invoke('Stop', { turn_id: 'export-only' }), {}, 'an export request never authorizes advancing the research')

  invoke('UserPromptSubmit', { prompt: 'Continue the authorized research', turn_id: 'one' })
  const planPath = join(ws, 'plans/experiment-design.md')
  writeFileSync(planPath, readFileSync(planPath, 'utf8').replace('Original objective', 'Native edit'))
  createClaim(ws, { statement: 'A new research claim' })
  const first = invoke('Stop', { turn_id: 'one' })
  assert.equal(first.decision, 'block')
  assert.match(first.reason, /continuation 1\/3/)
  assert.deepEqual(invoke('Stop', { turn_id: 'one' }), first, 'duplicate Stop is idempotent')
  assert.deepEqual(invoke('Stop', { turn_id: 'one', stop_hook_active: true }), {}, 'same-turn Stop continuation cannot loop')
  assert.equal(listPlanVersions(ws, 'experiment-design').length, 2, 'native edits are archived at the native lifecycle boundary')
  let previous = first
  for (let round = 2; round <= 3; round++) {
    invoke('UserPromptSubmit', { prompt: previous.reason, turn_id: String(round) })
    createClaim(ws, { statement: `Progress in continuation ${round}` })
    previous = invoke('Stop', { turn_id: String(round), stop_hook_active: true })
    assert.match(previous.reason, new RegExp(`continuation ${round}/3`))
  }
  invoke('UserPromptSubmit', { prompt: previous.reason, turn_id: 'budget' })
  createClaim(ws, { statement: 'Even new assets do not reset the continuation budget' })
  assert.deepEqual(invoke('Stop', { turn_id: 'budget', stop_hook_active: true }), {})
  const info = host.bootstrap(root)
  const progress = await host.dispatch(root, 'progress/workspace', { sessionId: info.sessionId })
  assert.equal(progress.ok, true)
  assert.ok(progress.value.lastTurn?.changes.changed, 'workbench reads reports created by another hook process')
  assert.equal(progress.value.lastTurn.changes.counts.find((row) => row.key === 'claims')?.to, 4)
  assert.ok((await host.dispatch(root, 'work/mine', {})).value.items.some((row) => row.path === root), 'long-lived MCP refreshes the hook-discovered registry')

  invoke('UserPromptSubmit', { prompt: 'Continue', turn_id: 'interrupt' })
  invoke('Interrupt', { turn_id: 'interrupt' })
  createClaim(ws, { statement: 'Interrupted work' })
  assert.deepEqual(invoke('Stop', { turn_id: 'interrupt' }), {})
  saveProjectFile(ws, { topic: 'Lifecycle research', questions: ['[blocking] Choose the research direction'] })
  invoke('UserPromptSubmit', { prompt: 'Continue research', turn_id: 'blocked' })
  assert.deepEqual(invoke('Stop', { turn_id: 'blocked' }), {}, 'explicit blocking questions stop native continuation')
  saveProjectFile(ws, { topic: 'Lifecycle research', questions: [] })
  invoke('UserPromptSubmit', { prompt: 'Continue research', turn_id: 'stale-one' })
  const stale = invoke('Stop', { turn_id: 'stale-one' })
  assert.equal(stale.decision, 'block')
  invoke('UserPromptSubmit', { prompt: stale.reason, turn_id: 'stale-two' })
  assert.deepEqual(invoke('Stop', { turn_id: 'stale-two', stop_hook_active: true }), {}, 'two rounds without assets stop native continuation')
  writeFileSync(join(home, 'config.json'), JSON.stringify({ autoContinue: false }))
  invoke('UserPromptSubmit', { prompt: 'Continue', turn_id: 'disabled' })
  createClaim(ws, { statement: 'Continuation disabled in settings' })
  assert.deepEqual(invoke('Stop', { turn_id: 'disabled' }), {})

  const other = join(temp, 'other'); mkdirSync(other)
  ensureWorkspaceLayout(join(other, 'workspace')); saveProjectFile(join(other, 'workspace'), { topic: 'Other project' }); ensureResearchState(join(other, 'workspace'))
  sid = 'another-session'
  assert.match(invoke('UserPromptSubmit', { prompt: 'Inspect only', turn_id: 'other' }, other).hookSpecificOutput.additionalContext, /Other project/)
  invoke('Stop', { turn_id: 'other' }, other)
  const ownReport = await host.dispatch(root, 'progress/workspace', { sessionId: info.sessionId })
  assert.equal(ownReport.value.lastTurn.changes.counts.find((row) => row.key === 'claims')?.to, 6, 'another project cannot replace this project report')
  assert.deepEqual(invoke('SessionStart', {}, plugin), {}, 'plugin installation is never a research target')
  for (const file of readdirSync(join(home, 'sessions'))) assert.equal(statSync(join(home, 'sessions', file)).mode & 0o777, 0o600)
  await host.close()
  console.log('Codex lifecycle passed: installed hook contracts, dynamic context, native Plan snapshots, real turn deltas, read-only/Plan protection, bounded continuation, interruption, settings, cross-process registry and project isolation.')
} finally { rmSync(temp, { recursive: true, force: true }) }
