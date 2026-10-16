#!/usr/bin/env node
/** Exercise the actual installed entrypoint, outside the source dependency tree. */
import assert from 'node:assert/strict'
import { mkdtempSync, cpSync, rmSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
const source = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const temp = mkdtempSync(join(tmpdir(), 'convfusion-installed-'))
try {
  const installed = join(temp, 'plugin'); mkdirSync(installed)
  for (const name of ['lib', 'skills', 'assets', 'hooks', '.codex-plugin', 'package.json', 'convfusion.env.example.json', '.mcp.json']) cpSync(join(source, name), join(installed, name), { recursive: true })
  const workspace = join(temp, 'task'); mkdirSync(workspace)
  const call = (id, name, args = {}) => ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: { workspace_root: workspace, ...args } } })
  const requests = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    call(3, 'research_methods'), call(4, 'research_workspace', { action: 'init', topic: 'Standalone install verification' }),
    call(5, 'research_context'),
    { jsonrpc: '2.0', id: 6, method: 'resources/read', params: { uri: 'ui://convfusion/workbench-v1.html' } },
    { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'research_ui', arguments: {} } },
  ]
  const result = spawnSync(process.execPath, ['lib/codex-mcp.mjs'], { cwd: installed, input: requests.map((x) => JSON.stringify(x)).join('\n') + '\n', encoding: 'utf8', env: { ...process.env, CONVFUSION_CODEX_HOME: join(temp, 'home') }, timeout: 20000, maxBuffer: 4 * 1024 * 1024 })
  assert.equal(result.status, 0, result.stderr)
  const responses = new Map(result.stdout.trim().split('\n').map((line) => { const msg = JSON.parse(line); return [msg.id, msg] }))
  assert.equal(responses.size, requests.length)
  assert.equal(responses.get(2).result.tools.length, 22)
  assert.equal(responses.get(3).result.structuredContent.methods.length, 58)
  assert.equal(responses.get(4).result.isError, false)
  assert.equal(responses.get(5).result.isError, false)
  assert.ok(responses.get(6).result.contents[0].text.includes('<title>ConvFusion</title>'))
  assert.equal(responses.get(7).result.isError, false)
  assert.equal(responses.get(7).result.structuredContent.uiScope, 'global')
  assert.equal(responses.get(7).result.structuredContent.workspaceRoot, null)
  const hook = spawnSync(process.execPath, ['lib/codex-hooks.mjs'], { cwd: installed, input: JSON.stringify({ hook_event_name: 'SessionStart', session_id: 'installed', cwd: workspace }), encoding: 'utf8', env: { ...process.env, CONVFUSION_CODEX_HOME: join(temp, 'home') }, timeout: 20000 })
  assert.equal(hook.status, 0, hook.stderr)
  assert.match(JSON.parse(hook.stdout).hookSpecificOutput.additionalContext, /Standalone install verification/)
  console.log('Clean package passed: actual STDIO entrypoint, 22 tools, 58 methods/operations, initialization, context and UI resource without node_modules.')
} finally { rmSync(temp, { recursive: true, force: true }) }
