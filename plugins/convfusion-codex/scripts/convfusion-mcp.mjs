#!/usr/bin/env node

import { readFileSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createCodexUiHost, UI_URI, UI_MIME } from './codex-ui-server.mjs'
import { defineResearchTools } from '../lib/research/research-tools.js'
import { researchWorkspaceOf } from '../lib/research/workspace.js'
import { ensureWorkspaceLayout, inspectWorkspace } from '../lib/research/workspace-layout.js'
import { loadProjectFile, saveProjectFile } from '../lib/research/project.js'
import {
  ensureResearchState,
  loadResearchState,
  listStateProposals,
} from '../lib/research/research-state.js'
import { listEvidence } from '../lib/research/evidence.js'
import { listClaims, listDecisions } from '../lib/research/claims.js'
import {
  approvePlan,
  archivePlan,
  completePlan,
  createPlan,
  isPlanWriteError,
  loadPlanLibrary,
  markPlanExecuting,
  reviewPlan,
  setPlanStatus,
} from '../lib/research/plan-library.js'

const packageInfo = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
if (typeof packageInfo.name !== 'string' || typeof packageInfo.version !== 'string') {
  throw new Error('package.json must define string name and version fields')
}
const SERVER_INFO = Object.freeze({ name: packageInfo.name, version: packageInfo.version })

const uiHost = createCodexUiHost()

function objectSchema(properties, required = []) {
  return { type: 'object', properties, required, additionalProperties: false }
}

function workspaceProperty() {
  return {
    type: 'string',
    description:
      'Absolute path of the current Codex task workspace. Pass the task cwd, not the plugin installation directory. ConvFusion stores its data in the workspace/ child when using the current layout.',
  }
}

function sessionRoot(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('workspace_root is required')
  if (!isAbsolute(value)) throw new Error('workspace_root must be an absolute path')
  return resolve(value)
}

function researchRoot(value) {
  return researchWorkspaceOf(sessionRoot(value))
}

function concisePlan(doc) {
  return {
    id: doc.id,
    name: doc.name,
    status: doc.status,
    version: doc.version,
    sourceSkill: doc.sourceSkill,
    paper: doc.paper,
    path: doc.relPath,
  }
}

const workspaceTool = {
  name: 'research_workspace',
  description:
    'Initialize or inspect a ConvFusion research workspace. `status` is read-only. `init` creates the minimal workspace layout, project.md, and research-state.md; only call init when the user asked to start or initialize a research project.',
  parameters: {
    workspace_root: workspaceProperty(),
    action: { type: 'string', enum: ['status', 'init'] },
    topic: { type: 'string', description: 'Required for init: the research topic.' },
    domain: { type: 'string' },
    goal: { type: 'string' },
    questions: { type: 'array', items: { type: 'string' } },
  },
  async execute(args) {
    const root = researchRoot(args.workspace_root)
    const action = args.action ?? 'status'
    if (action === 'init') {
      const topic = typeof args.topic === 'string' ? args.topic.trim() : ''
      if (!topic) return { ok: false, error: 'topic is required for init' }
      const createdDirectories = ensureWorkspaceLayout(root)
      const project = saveProjectFile(root, {
        topic,
        ...(args.domain ? { domain: String(args.domain) } : {}),
        ...(args.goal ? { goal: String(args.goal) } : {}),
        ...(Array.isArray(args.questions) ? { questions: args.questions.map(String) } : {}),
      })
      const state = ensureResearchState(root)
      if (state && typeof state === 'object' && 'error' in state) return { ok: false, error: state.error }
      return { ok: true, action, workspace: root, createdDirectories, project, stateVersion: state.version }
    }
    if (action !== 'status') return { ok: false, error: `Unknown action "${action}".` }
    const project = loadProjectFile(root)
    const state = loadResearchState(root)
    const inspection = inspectWorkspace(root)
    return {
      ok: true,
      action,
      workspace: root,
      isResearch: inspection.isResearch,
      project,
      state: state
        ? { version: state.version, dimensions: state.dimensions, maturity: state.maturity }
        : null,
      counts: {
        evidence: listEvidence(root).length,
        claims: listClaims(root).length,
        decisions: listDecisions(root).length,
        plans: loadPlanLibrary(root).counts.total,
        pendingStateProposals: listStateProposals(root).length,
      },
      layout: inspection.entries,
      unexpectedTopLevel: inspection.unexpectedTopLevel,
      unexpectedOutputDirs: inspection.unexpectedOutputDirs,
    }
  },
}

const planTool = {
  name: 'research_plan',
  description:
    'Create, list, and move research Plan assets through their validated lifecycle. A plan is data, not a workflow engine. Do not mark a draft reviewed/ready unless the user actually reviewed or approved it; auto-execute plans are the explicit exception encoded in the plan.',
  parameters: {
    workspace_root: workspaceProperty(),
    action: {
      type: 'string',
      enum: ['list', 'create', 'set_status', 'review', 'approve', 'executing', 'complete', 'archive'],
    },
    id: { type: 'string' },
    name: { type: 'string' },
    type: { type: 'string' },
    status: { type: 'string' },
    source_skill: { type: 'string' },
    source_skill_version: { type: 'string' },
    paper: { type: 'string' },
    research_context: { type: 'string' },
    review_policy: { type: 'string', enum: ['review-required', 'auto-execute'] },
    objective: { type: 'string' },
    strategy: { type: 'string' },
    expected_evidence: { type: 'string' },
    completion_criteria: { type: 'string' },
  },
  async execute(args) {
    const root = researchRoot(args.workspace_root)
    const action = args.action ?? 'list'
    if (action === 'list') {
      const library = loadPlanLibrary(root)
      return { ok: true, counts: library.counts, plans: library.entries.map((entry) => concisePlan(entry.document)) }
    }
    let result
    if (action === 'create') {
      result = createPlan(root, {
        name: String(args.name ?? ''),
        ...(args.id ? { id: String(args.id) } : {}),
        ...(args.type ? { type: String(args.type) } : {}),
        ...(args.status ? { status: String(args.status) } : {}),
        ...(args.source_skill ? { sourceSkill: String(args.source_skill) } : {}),
        ...(args.source_skill_version ? { sourceSkillVersion: String(args.source_skill_version) } : {}),
        ...(args.paper ? { paper: String(args.paper) } : {}),
        ...(args.research_context ? { researchContext: String(args.research_context) } : {}),
        ...(args.review_policy ? { reviewPolicy: String(args.review_policy) } : {}),
        ...(args.objective ? { objective: String(args.objective) } : {}),
        ...(args.strategy ? { strategy: String(args.strategy) } : {}),
        ...(args.expected_evidence ? { expectedEvidence: String(args.expected_evidence) } : {}),
        ...(args.completion_criteria ? { completionCriteria: String(args.completion_criteria) } : {}),
      })
    } else {
      const id = String(args.id ?? '')
      if (!id) return { ok: false, error: 'id is required for this action' }
      if (action === 'set_status') result = setPlanStatus(root, id, String(args.status ?? ''))
      else if (action === 'review') result = reviewPlan(root, id)
      else if (action === 'approve') result = approvePlan(root, id)
      else if (action === 'executing') result = markPlanExecuting(root, id)
      else if (action === 'complete') result = completePlan(root, id)
      else if (action === 'archive') result = archivePlan(root, id)
      else return { ok: false, error: `Unknown action "${action}".` }
    }
    if (isPlanWriteError(result)) return { ok: false, error: result.error }
    return { ok: true, action, plan: concisePlan(result) }
  },
}

const nativeTools = defineResearchTools(
  (agent) => {
    if (typeof agent?.id !== 'string') throw new Error('workspace_root was not supplied')
    return agent.id
  },
  {
    apiKey: () => uiHost.getConfig().openalexApiKey || process.env.OPENALEX_API_KEY || '',
    mailto: () => process.env.OPENALEX_MAILTO,
    fetchImpl: globalThis.fetch,
  },
  { fetchImpl: globalThis.fetch },
)

const codexTools = [
  {
    name: 'research_context',
    description: 'Read the current research context, process guidance, stage, gaps and recommended methods before research work. Does not initialize a workspace.',
    parameters: { input: { type: 'string', description: 'Current research request for relevant method selection.' } },
    execute: (args) => ({ ok: true, context: uiHost.context(args.workspace_root, args.input ?? '') }),
  },
  {
    name: 'research_methods',
    description: 'List the current bundled methods, or read one effective method with the user customizations applied. Use this instead of bypassing the customization layer.',
    parameters: { id: { type: 'string', description: 'Method id; omit to list all methods and operations.' } },
    execute: (args) => ({ ok: true, methods: uiHost.methods(args.id) }),
  },
  {
    name: 'research_sync',
    description: 'Read-only preparation for synchronizing a downloaded research ZIP: verify the archive header, compare research identities, and return facts and the sync workflow. Never extracts or replaces research files automatically.',
    parameters: { zip: { type: 'string', description: 'Downloaded research ZIP path, absolute or relative to the task workspace.' } },
    execute: (args) => uiHost.prepareSync(args.workspace_root, args.zip ?? ''),
  },
  {
    name: 'research_ui',
    description: 'Open the ConvFusion workbench for research progress, method customization and ConvFusion.com accounts, research publishing, finding mentors/students and file exchange. Returns an MCP Apps UI and a local browser URL. Network publishing, paid actions and file selection are confirmed by the user in the UI.',
    parameters: {},
    _meta: { ui: { resourceUri: UI_URI }, 'openai/outputTemplate': UI_URI, 'openai/ui': { entrypoints: [{ type: 'thread' }] } },
    execute: async (args) => ({ ok: true, ...await uiHost.open(args.workspace_root) }),
  },
  {
    name: 'research_ui_action',
    description: 'UI-only transport for the ConvFusion workbench. Credentials and paid actions are entered and confirmed by the human in the UI.',
    parameters: { endpoint: { type: 'string' }, payload: { type: 'object', additionalProperties: true } },
    _meta: { ui: { visibility: ['app'] } },
    execute: (args) => uiHost.dispatch(args.workspace_root, args.endpoint, args.payload),
  },
]
const taskTools = new Set([workspaceTool, planTool, ...codexTools])
const definitions = [workspaceTool, planTool, ...nativeTools, ...codexTools]
const byName = new Map(definitions.map((tool) => [tool.name, tool]))

function advertisedTool(tool) {
  return {
    name: tool.name,
    description: tool.description,
    ...(tool._meta ? { _meta: tool._meta } : {}),
    inputSchema: objectSchema(
      { workspace_root: workspaceProperty(), ...(tool.parameters.type === 'object' ? tool.parameters.properties : tool.parameters) },
      ['workspace_root', ...(tool.parameters.type === 'object' ? tool.parameters.required ?? [] : [])],
    ),
  }
}

function jsonSafe(value) {
  return JSON.parse(JSON.stringify(value, (_key, item) => (typeof item === 'bigint' ? item.toString() : item)))
}

async function callTool(name, rawArgs) {
  const tool = byName.get(name)
  if (!tool) throw new Error(`Unknown tool: ${name}`)
  const args = rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs) ? { ...rawArgs } : {}
  const root = researchRoot(args.workspace_root)
  delete args.workspace_root
  const value = taskTools.has(tool)
    ? await tool.execute({ ...args, workspace_root: sessionRoot(rawArgs.workspace_root) })
    : await tool.execute(args, { agent: { id: root } })
  const structuredContent = jsonSafe(value)
  return {
    content: [{ type: 'text', text: JSON.stringify(structuredContent, null, 2) }],
    structuredContent,
    isError: structuredContent?.ok === false,
  }
}

export async function handleRequest(message) {
  const { id, method, params = {} } = message
  if (method === 'initialize') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: params.protocolVersion ?? '2025-06-18',
        capabilities: { tools: { listChanged: false }, resources: {} },
        serverInfo: SERVER_INFO,
        instructions:
          'ConvFusion stores research data under the current task workspace. Every tool requires workspace_root; pass the absolute Codex task cwd, never this plugin installation directory.',
      },
    }
  }
  if (method === 'resources/list') return { jsonrpc: '2.0', id, result: { resources: [{ uri: UI_URI, name: 'ConvFusion workbench', mimeType: UI_MIME }] } }
  if (method === 'resources/read') {
    if (params.uri !== UI_URI) return { jsonrpc: '2.0', id, error: { code: -32602, message: 'Unknown UI resource' } }
    return { jsonrpc: '2.0', id, result: { contents: [{ uri: UI_URI, mimeType: UI_MIME, text: uiHost.uiHtml(), _meta: { ui: { prefersBorder: true, csp: { connectDomains: [], resourceDomains: [] } } } }] } }
  }
  if (method === 'tools/list') {
    return { jsonrpc: '2.0', id, result: { tools: definitions.map(advertisedTool) } }
  }
  if (method === 'tools/call') {
    try {
      return { jsonrpc: '2.0', id, result: await callTool(params.name, params.arguments) }
    } catch (error) {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }],
          isError: true,
        },
      }
    }
  }
  if (method === 'ping') return { jsonrpc: '2.0', id, result: {} }
  if (id === undefined || id === null) return null
  return { jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } }
}

export async function closeUiHost() { await uiHost.close() }

export function serveStdio() {
  let buffer = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', (chunk) => {
    buffer += chunk
    while (true) {
      const newline = buffer.indexOf('\n')
      if (newline < 0) break
      const line = buffer.slice(0, newline).trim()
      buffer = buffer.slice(newline + 1)
      if (!line) continue
      let message
      try {
        message = JSON.parse(line)
      } catch (error) {
        process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: String(error) } })}\n`)
        continue
      }
      Promise.resolve(handleRequest(message))
        .then((response) => {
          if (response) process.stdout.write(`${JSON.stringify(response)}\n`)
        })
        .catch((error) => {
          process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: message.id ?? null, error: { code: -32603, message: String(error) } })}\n`)
        })
    }
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) serveStdio()
