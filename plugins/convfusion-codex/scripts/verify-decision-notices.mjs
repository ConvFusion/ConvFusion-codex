import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'

const temp = await mkdtemp(join(tmpdir(), 'convfusion-decision-notices-'))
const home = join(temp, 'home')
const root = join(temp, 'project')
const workspace = join(root, 'workspace')
process.env.CONVFUSION_CODEX_HOME = home
const originalFetch = globalThis.fetch
let networkCalls = 0
let unavailable = false
globalThis.fetch = async (_url, init) => {
  networkCalls++
  if (unavailable) return new Response('{}', { status: 503 })
  const body = JSON.parse(init.body)
  return new Response(JSON.stringify({ status: 'used', decision_type: body.decision_type,
    predicted_label: 'A', predicted_text: 'Run an ablation',
    probabilities: body.candidate_options.map((row, i) => ({ ...row, probability: i ? 0.1 : 0.9 })),
    top3_labels: ['A', 'B'], model: 'offline-DCRM', input_tokens: 100, input_hash: 'a'.repeat(64),
    probability_kind: 'candidate_normalized_uncalibrated' }))
}
let closeUiHost
try {
  await mkdir(home)
  await mkdir(workspace, { recursive: true })
  await writeFile(join(workspace, 'project.md'), '---\ntopic: Offline display verification\n---\n# Display verification\n')
  await writeFile(join(workspace, 'research-state.md'), '# Research State\n\n## Evidence\nA baseline is missing.\n')
  const config = { serverUrl: 'https://business.invalid', convfusionProdApiKey: 'cf_live_offline_display_only', decisionAssistEnabled: true }
  const save = () => writeFile(join(home, 'config.json'), JSON.stringify(config))
  await save()
  const mcp = await import('./convfusion-mcp.mjs')
  closeUiHost = mcp.closeUiHost
  const notifications = []
  const sink = value => notifications.push(value)
  const args = { workspace_root: root, decision_type: 'C1_next_action_selection', decision_question: 'What next?',
    candidate_options: [{ label: 'A', text: 'Run an ablation' }, { label: 'B', text: 'Write results' }] }
  const call = (token, overrides = {}) => mcp.handleRequest({ id: 1, method: 'tools/call', params: {
    name: 'research_decision_assist', arguments: { ...args, ...overrides },
    ...(token === undefined ? {} : { _meta: { progressToken: token } }),
  } }, sink)

  const result = (await call('fresh-token')).result
  assert.equal(networkCalls, 1)
  assert.equal(result.structuredContent.status, 'used')
  assert.match(result.content[0].text, /【已调用 DCRM】/)
  assert.match(result.content[0].text, /采纳情况：待主 Agent 判断/)
  assert.equal(result.content.length, 2, 'readable notice accompanies the unchanged structured result')
  assert.equal(JSON.parse(result.content[1].text).predicted_label, 'A')
  assert.equal(notifications.length, 2)
  assert.equal(notifications[0].method, 'notifications/progress')
  assert.equal(notifications[0].params.progressToken, 'fresh-token')
  assert.match(notifications[0].params.message, /【正在调用 DCRM】/)
  assert.equal(notifications[0].params.progress, 1)
  assert.equal(notifications[1].params.progress, 2)
  assert.equal(notifications[1].params.total, 2)
  assert.match(notifications[1].params.message, /【已调用 DCRM】/)

  notifications.length = 0
  const cached = (await call('cached-token')).result
  assert.equal(cached.structuredContent.cached, true)
  assert.equal(networkCalls, 1)
  assert.match(cached.content[0].text, /缓存建议.*未发起新的模型推理/)
  assert.equal(notifications.length, 1)
  assert.doesNotMatch(notifications[0].params.message, /正在调用/)

  config.decisionAssistEnabled = false
  await save()
  notifications.length = 0
  const disabled = (await call(0)).result
  assert.equal(disabled.structuredContent.reason, 'disabled')
  assert.match(disabled.content[0].text, /【DCRM 已关闭】.*未请求决策服务/)
  assert.equal(networkCalls, 1)
  assert.equal(notifications[0].params.progressToken, 0, 'integer progress token zero is valid')
  const context = await mcp.handleRequest({ id: 2, method: 'tools/call', params: { name: 'research_context', arguments: { workspace_root: root } } })
  assert.match(context.result.structuredContent.context, /DCRM decision assistance is disabled at this refresh/)
  notifications.length = 0
  await call(undefined)
  await call({ invalid: 'token' })
  assert.equal(notifications.length, 0, 'never send unsolicited progress without a valid request token')

  config.decisionAssistEnabled = true
  await save()
  unavailable = true
  notifications.length = 0
  const failed = (await call('failure-token', { decision_question: 'A different choice' })).result
  assert.equal(failed.structuredContent.reason, 'service_unavailable')
  assert.match(failed.content[0].text, /【DCRM 暂不可用】/)
  assert.equal(notifications.length, 2)
  assert.doesNotMatch(notifications[1].params.message, /已调用 DCRM|未请求决策服务/)
  assert.ok(notifications.every(n => !JSON.stringify(n).includes('cf_live_offline_display_only')), 'notices never include credentials')
  const { handleLifecycle } = await import('../lib/codex/lifecycle.js')
  const started = handleLifecycle({ hook_event_name: 'SessionStart', cwd: root, session_id: 'display-check' })
  assert.match(started.hookSpecificOutput.additionalContext, /DCRM decision assistance is enabled at this refresh/)
  config.decisionAssistEnabled = false
  await save()
  const refreshed = handleLifecycle({ hook_event_name: 'PreToolUse', cwd: root, session_id: 'display-check' })
  assert.match(refreshed.hookSpecificOutput.additionalContext, /DCRM decision assistance is disabled at this refresh/)
  // Exercise the distributed STDIO entrypoint, not just a callback in this process.
  config.decisionAssistEnabled = true
  await save()
  const preload = join(temp, 'offline-fetch.mjs')
  await writeFile(preload, `globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body)
    await new Promise(resolve => setTimeout(resolve, 50))
    return new Response(JSON.stringify({ status:'used', decision_type:body.decision_type,
      predicted_label:'A', predicted_text:'Run an ablation',
      probabilities:body.candidate_options.map((row,i)=>({...row,probability:i?0.1:0.9})),
      top3_labels:['A','B'],model:'offline-DCRM',input_tokens:100,input_hash:'a'.repeat(64),
      probability_kind:'candidate_normalized_uncalibrated' }))
  }`)
  const child = spawnSync(process.execPath, ['--import', preload, new URL('../lib/codex-mcp.mjs', import.meta.url).pathname], {
    env: { ...process.env, CONVFUSION_CODEX_HOME: home }, encoding: 'utf8', timeout: 5000,
    input: JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: {
      name: 'research_decision_assist', arguments: { ...args, decision_question: 'Packaged request' },
      _meta: { progressToken: 'packaged-token' },
    } }) + '\n',
  })
  assert.equal(child.status, 0, child.stderr)
  const lines = child.stdout.trim().split('\n').map(line => JSON.parse(line))
  assert.equal(lines.length, 3)
  assert.deepEqual(lines.map(line => line.method ?? line.id), ['notifications/progress', 'notifications/progress', 7])
  assert.match(lines[0].params.message, /正在调用 DCRM/)
  assert.match(lines[1].params.message, /已调用 DCRM/)
  assert.equal(lines[2].result.structuredContent.status, 'used')
  assert.match(lines[2].result.content[0].text, /待主 Agent 判断/)
  assert.ok(!child.stdout.includes(config.convfusionProdApiKey))
  console.log('Decision notices passed: fresh/cached/disabled/failure text, token-scoped and packaged STDIO progress, structured results, live context preference and pending adoption.')
} finally {
  globalThis.fetch = originalFetch
  await closeUiHost?.()
  await rm(temp, { recursive: true, force: true })
}
