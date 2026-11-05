import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDecisionAssistant, decisionState } from '../lib/research/decision-assist.js'
import { createCodexUiHost } from './codex-ui-server.mjs'

const temp = await mkdtemp(join(tmpdir(), 'convfusion-decisions-'))
const root = join(temp, 'workspace')
const env = { CONVFUSION_ENV: 'production' }
const home = join(temp, 'home')
const host = createCodexUiHost({ home, env })
const config = { serverUrl: 'https://convfusion.invalid', convfusionProdApiKey: 'cf_live_offline_test', decisionAssistEnabled: true }
const args = { decision_type: 'C1_next_action_selection', decision_question: 'What next?',
  candidate_options: [{ label: 'test', text: 'Run an ablation' }, { label: 'write', text: 'Write results' }] }
const calls = []
const fetchImpl = async (url, init) => {
  calls.push(url)
  assert.equal(init.headers.authorization, `Bearer ${config.convfusionProdApiKey}`)
  assert.ok(url.endsWith('/api/v1/decision-model/assist'))
  const body = JSON.parse(init.body)
  assert.equal(body.research_state.method, '')
  assert.deepEqual(body.research_state.evidence, ['A baseline is missing.'])
  return new Response(JSON.stringify({ status: 'used', decision_type: body.decision_type,
    predicted_label: 'test', predicted_text: 'Run an ablation',
    probabilities: body.candidate_options.map((o, i) => ({ ...o, probability: i ? 0.2 : 0.8 })),
    top3_labels: ['test', 'write'], model: 'dcrm-offline', input_tokens: 100,
    input_hash: createHash('sha256').update(JSON.stringify(body)).digest('hex'),
    probability_kind: 'candidate_normalized_uncalibrated' }), { status: 200 })
}
try {
  await mkdir(root)
  await writeFile(join(root, 'project.md'), '---\ntopic: Offline research\n---\n# Offline research\n')
  await writeFile(join(root, 'research-state.md'), '# Research State\n\n## Research Questions\nDoes this work?\n\n## Evidence\nA baseline is missing.\n')
  const assist = createDecisionAssistant(() => config, env, { fetchImpl })
  config.decisionAssistEnabled = false
  assert.equal((await assist(root, args)).reason, 'disabled')
  config.decisionAssistEnabled = true
  const savedKey = config.convfusionProdApiKey
  config.convfusionProdApiKey = ''
  assert.equal((await assist(root, args)).reason, 'not_logged_in')
  config.convfusionProdApiKey = savedKey
  assert.equal((await assist(temp, args)).reason, 'no_research_workspace')
  assert.equal((await assist(root, { ...args, candidate_options: [args.candidate_options[0], args.candidate_options[0]] })).reason, 'invalid_input')
  assert.equal(calls.length, 0, 'disabled, unauthenticated and invalid calls never leave the client')
  let requesting = 0
  const onRequest = () => { requesting++ }
  const [used, concurrent] = await Promise.all([assist(root, args, onRequest), assist(root, args, onRequest)])
  assert.equal(used.status, 'used'); assert.equal(concurrent.predicted_label, 'test')
  assert.equal(concurrent.shared_request, true)
  assert.equal(requesting, 1, 'only a fresh network request emits a requesting event')
  assert.equal(calls.length, 1, 'coalesce identical in-flight consultations')
  assert.equal((await assist(root, args, onRequest)).cached, true)
  assert.equal(requesting, 1, 'cached advice never emits a fresh requesting event')
  assert.equal(calls.length, 1)
  const records = await readdir(join(root, 'research/decision-assists'))
  assert.equal(records.length, 1)
  const record = await readFile(join(root, used.record), 'utf8')
  assert.ok(!record.includes(savedKey)); assert.match(record, /research-state.md/)
  assert.deepEqual(await readdir(join(root, 'research')), ['decision-assists'], 'advice never creates evidence or final decisions')
  await writeFile(join(root, 'research-state.md'), (await readFile(join(root, 'research-state.md'), 'utf8')) + '\n## Claims\nAn unverified claim.\n')
  await assist(root, args)
  assert.equal(calls.length, 2, 'new state invalidates cache')
  config.convfusionProdApiKey = 'cf_live_other_offline_user'
  await assist(root, args)
  assert.equal(calls.length, 3, 'account switch never shares cached advice')
  for (const status of [401, 403, 404, 429, 503]) {
    const failing = createDecisionAssistant(() => config, env, { fetchImpl: async () => new Response('{}', { status }) })
    assert.equal((await failing(root, args)).reason, 'service_unavailable')
  }
  const malformed = createDecisionAssistant(() => config, env, { fetchImpl: async () => new Response('{}') })
  assert.equal((await malformed(root, args)).status, 'skipped')
  let aborted
  const stalled = createDecisionAssistant(() => config, env, { timeoutMs: 20, fetchImpl: async (_url, init) => {
    aborted = init.signal
    return { ok: true, status: 200, json: () => new Promise(() => {}), arrayBuffer: async () => new ArrayBuffer(0) }
  } })
  assert.equal((await stalled(root, args)).reason, 'service_unavailable')
  assert.equal(aborted.aborted, true, 'a stalled response body is aborted within the deadline')
  let finish
  const changing = createDecisionAssistant(() => config, env, { fetchImpl: (...values) => new Promise(resolve => { finish = async () => resolve(await fetchImpl(...values)) }) })
  const waiting = changing(root, args)
  config.decisionAssistEnabled = false
  await finish()
  assert.equal((await waiting).reason, 'settings_changed', 'disable while waiting discards the result')
  const initial = await host.dispatch(undefined, 'account/state')
  assert.equal(initial.value.decisionAssistEnabled, true)
  assert.equal((await host.dispatch(undefined, 'account/decision-assist', { enabled: 'false' })).ok, false)
  assert.equal((await host.dispatch(undefined, 'account/decision-assist', { enabled: false })).value.decisionAssistEnabled, false)
  const restarted = createCodexUiHost({ home, env })
  assert.equal(restarted.getConfig().decisionAssistEnabled, false, 'user choice survives restart')
  await restarted.close()
  await writeFile(join(root, 'research-state.md'), '# Research State\n\n## Evidence\n' + '证'.repeat(700))
  assert.deepEqual(decisionState(root).truncated_fields, ['evidence'])
  assert.equal(decisionState(root).research_state.evidence[0].length, 500)
  console.log('Decision assistance passed: zero-call gates, projection, ranking, caching, account isolation, fallback/deadline, advisory records and persistent switch.')
} finally {
  await host.close()
  await rm(temp, { recursive: true, force: true })
}
