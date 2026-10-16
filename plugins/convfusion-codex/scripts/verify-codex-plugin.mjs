#!/usr/bin/env node

import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const temp = await mkdtemp(join(tmpdir(), 'convfusion-codex-'))
process.env.CONVFUSION_CODEX_HOME = join(temp, 'plugin-home')
const { handleRequest, closeUiHost } = await import('./convfusion-mcp.mjs')
const packageInfo = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))

try {
  const initialized = await handleRequest({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2025-06-18' },
  })
  assert.equal(initialized.result.serverInfo.name, 'convfusion-codex')
  assert.equal(initialized.result.serverInfo.version, packageInfo.version)

  const listed = await handleRequest({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
  const names = listed.result.tools.map((tool) => tool.name)
  assert.equal(names.length, 22)
  for (const expected of [
    'research_action_construction',
    'research_diagram',
    'research_schematic',
    'research_ir',
    'research_context',
    'research_methods',
    'research_sync',
    'research_ui',
    'research_ui_action',
    'research_workspace',
    'research_plan',
    'research_project',
    'research_evidence',
    'research_claim',
    'research_decision',
    'research_state_read',
    'research_state_propose',
    'research_paper',
    'research_output',
    'research_literature_search',
    'research_paper_download',
    'research_paper_latex',
  ]) assert.ok(names.includes(expected), `missing tool: ${expected}`)

  const call = async (name, arguments_ = {}) => (await handleRequest({ jsonrpc: '2.0', id: 20, method: 'tools/call', params: { name, arguments: { workspace_root: temp, ...arguments_ } } })).result
  const missing = await handleRequest({ jsonrpc: '2.0', id: 21, method: 'tools/call', params: { name: 'research_context', arguments: {} } })
  assert.equal(missing.result.isError, true)
  const methods = await call('research_methods')
  assert.equal(methods.structuredContent.methods.length, 58)
  assert.equal(methods.structuredContent.methods.filter((m) => m.kind === 'method').length, 57)
  assert.equal((await call('research_methods', { id: 'sync' })).isError, false)
  const resources = await handleRequest({ jsonrpc: '2.0', id: 22, method: 'resources/list' })
  const resource = await handleRequest({ jsonrpc: '2.0', id: 23, method: 'resources/read', params: { uri: resources.result.resources[0].uri } })
  assert.equal(resource.result.contents[0].mimeType, 'text/html;profile=mcp-app')
  assert.ok(resource.result.contents[0].text.includes('<!doctype html>'))
  assert.deepEqual(listed.result.tools.find((t) => t.name === 'research_ui_action')._meta.ui.visibility, ['app'])
  const uiTool = listed.result.tools.find((t) => t.name === 'research_ui')
  assert.deepEqual(uiTool._meta['openai/ui'].entrypoints, [{ type: 'global' }, { type: 'thread' }])
  assert.deepEqual(uiTool.inputSchema.required, [], 'sidebar and panel entrypoints must accept {}')
  assert.match(uiTool.icons[0].src, /^data:image\/svg\+xml;base64,/)
  for (const tool of listed.result.tools.filter((tool) => !['research_ui', 'research_ui_action'].includes(tool.name))) {
    assert.ok(tool.inputSchema.required.includes('workspace_root'), `${tool.name} must retain explicit workspace routing`)
  }
  const global = (await handleRequest({ jsonrpc: '2.0', id: 24, method: 'tools/call', params: { name: 'research_ui', arguments: {} } })).result
  assert.equal(global.isError, false)
  assert.equal(global.structuredContent.uiScope, 'global')
  assert.equal(global.structuredContent.workspaceRoot, null, 'global launch must not use process cwd')
  const uiCall = async (payload) => (await handleRequest({ jsonrpc: '2.0', id: 25, method: 'tools/call', params: { name: 'research_ui_action', arguments: { ui_session: global.structuredContent.uiSession, ...payload } } })).result
  const selected = await uiCall({ endpoint: 'codex/select-workspace', payload: { path: temp } })
  assert.equal(selected.isError, false)
  assert.equal(selected.structuredContent.value.workspaceRoot, await realpath(temp))
  const badSession = await uiCall({ ui_session: 'unregistered', endpoint: 'state' })
  assert.equal(badSession.isError, true)

  const init = await handleRequest({
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: {
      name: 'research_workspace',
      arguments: {
        workspace_root: temp,
        action: 'init',
        topic: 'Verify the Codex adapter',
        domain: 'software engineering',
      },
    },
  })
  assert.equal(init.result.isError, false)
  assert.equal(init.result.structuredContent.workspace, join(temp, 'workspace'))
  assert.match(await readFile(join(temp, 'workspace', 'project.md'), 'utf8'), /Verify the Codex adapter/)

  const claim = await handleRequest({
    jsonrpc: '2.0',
    id: 4,
    method: 'tools/call',
    params: {
      name: 'research_claim',
      arguments: {
        workspace_root: temp,
        action: 'create',
        statement: 'The Codex MCP adapter preserves deterministic claim IDs.',
      },
    },
  })
  assert.equal(claim.result.isError, false)
  assert.equal(claim.result.structuredContent.claim.id, 'C001')

  const evidence = await handleRequest({
    jsonrpc: '2.0',
    id: 5,
    method: 'tools/call',
    params: {
      name: 'research_evidence',
      arguments: {
        workspace_root: temp,
        action: 'create',
        name: 'Adapter verification',
        source_kind: 'implementation',
        claim: 'The adapter initialized and wrote a claim.',
        result: 'project.md and C001.md exist in the generated workspace.',
        raw_artifacts: ['workspace/project.md', 'workspace/research/claims/C001.md'],
        supports: ['C001'],
      },
    },
  })
  assert.equal(evidence.result.isError, false)
  assert.equal(evidence.result.structuredContent.evidence.id, 'E001')

  const status = await handleRequest({
    jsonrpc: '2.0',
    id: 6,
    method: 'tools/call',
    params: { name: 'research_workspace', arguments: { workspace_root: temp, action: 'status' } },
  })
  assert.deepEqual(status.result.structuredContent.counts, {
    evidence: 1,
    claims: 1,
    decisions: 0,
    plans: 0,
    pendingStateProposals: 0,
  })

  const stateBefore = await readFile(join(temp, 'workspace/research-state.md'), 'utf8')
  const proposal = await call('research_state_propose', { action: 'propose', changes: { Problem: 'Reviewed research direction' }, rationale: 'Codex preserves explicit review.' })
  assert.equal(proposal.isError, false)
  assert.equal(await readFile(join(temp, 'workspace/research-state.md'), 'utf8'), stateBefore)
  assert.match((await call('research_context')).structuredContent.context, /Verify the Codex adapter/)

  console.log(`Codex adapter verification passed (${names.length} MCP tools).`)
} finally {
  await closeUiHost()
  await rm(temp, { recursive: true, force: true })
}
