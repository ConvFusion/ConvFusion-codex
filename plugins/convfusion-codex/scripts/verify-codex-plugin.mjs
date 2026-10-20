#!/usr/bin/env node

import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm, realpath } from 'node:fs/promises'
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
  assert.equal(selected.isError, true, "global workbench cannot select a directory manually")
  assert.equal((await uiCall({ endpoint: "codex/bootstrap" })).structuredContent.value.workspaceRoot, null)
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
  const proposal = await call('research_state_propose', { action: 'propose', apply: false, changes: { Problem: 'Reviewed research direction' }, rationale: 'Explicit pending review.' })
  assert.equal(proposal.isError, false)
  assert.equal(await readFile(join(temp, 'workspace/research-state.md'), 'utf8'), stateBefore)
  const applied = await call('research_state_propose', { action: 'propose', changes: { Problem: 'State follows the adopted direction' }, rationale: 'DSH default application semantics.' })
  assert.equal(applied.isError, false)
  assert.ok(applied.structuredContent.applied?.version)
  assert.notEqual(await readFile(join(temp, 'workspace/research-state.md'), 'utf8'), stateBefore)
  assert.match((await call('research_context')).structuredContent.context, /Verify the Codex adapter/)
  assert.match((await call('research_context')).structuredContent.context, /Write paper materials and data in English/)
  assert.ok(!(await call('research_context')).structuredContent.context.includes('native skill list'))

  const plan = await call('research_plan', { action: 'create', id: 'adapter-plan', name: 'Adapter plan', objective: 'Original objective' })
  assert.equal(plan.isError, false)
  const planPath = join(temp, 'workspace/plans/adapter-plan.md')
  const originalPlan = await readFile(planPath, 'utf8')
  const historyBefore = await call('research_plan', { action: 'history', id: 'adapter-plan' })
  assert.equal(historyBefore.structuredContent.versions.length, 1, 'creation archives a baseline before native edits')
  await writeFile(planPath, originalPlan.replace('Original objective', 'Native edit'))
  assert.equal((await call('research_plan', { action: 'handoff', id: 'adapter-plan' })).isError, true, 'draft cannot execute without review')
  const revised = await call('research_plan', { action: 'revise', id: 'adapter-plan', body: originalPlan.replace('Original objective', 'Reviewed revision'), note: 'Revision after native edit' })
  assert.equal(revised.isError, false)
  const versions = (await call('research_plan', { action: 'history', id: 'adapter-plan' })).structuredContent.versions
  assert.equal(versions.length, 3)
  assert.match((await call('research_plan', { action: 'read_version', id: 'adapter-plan', version: versions[1].version })).structuredContent.content, /Native edit/)
  assert.equal((await call('research_plan', { action: 'read_version', id: 'adapter-plan', version: '../../project' })).isError, true)
  await call('research_plan', { action: 'review', id: 'adapter-plan' })
  await call('research_plan', { action: 'approve', id: 'adapter-plan' })
  assert.match((await call('research_plan', { action: 'handoff', id: 'adapter-plan' })).structuredContent.text, /Execute the research plan/)
  const custom = await uiCall({ endpoint: 'customization/save', payload: { skillId: 'literature-search', section: 'Research Method', text: 'Customized export marker' } })
  assert.equal(custom.isError, false)
  const exported = await call('research_methods', { action: 'export' })
  assert.equal(exported.isError, false)
  assert.equal(exported.structuredContent.skillCount, 57)
  assert.match(await readFile(exported.structuredContent.path, 'utf8'), /Customized export marker/)
  const fullExport = await call('research_methods', { action: 'export', full: true })
  assert.match(await readFile(fullExport.structuredContent.path, 'utf8'), /Source Prompts/)
  assert.equal(fullExport.structuredContent.markdown, undefined, 'export returns an artifact path instead of flooding model context')

  console.log(`Codex adapter verification passed (${names.length} MCP tools).`)
} finally {
  await closeUiHost()
  await rm(temp, { recursive: true, force: true })
}
