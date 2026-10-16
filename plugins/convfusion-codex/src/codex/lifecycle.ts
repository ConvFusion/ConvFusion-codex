/** Native Codex lifecycle adapter. It observes assets and requests native continuation; no agent loop. */
import { isAbsolute, join, resolve, relative, sep } from 'node:path'
import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { codexResearchContext } from './context.js'
import { codexHome, stateKey, readPrivateJson, writePrivateJson, withPrivateLock, registerCodexWorkspace } from './storage.js'
import { createFileCustomizationStore } from '../research/skill-customization.js'
import { effectiveSkillContentById } from '../research/library.js'
import { isResearchWorkspace, researchWorkspaceOf } from '../research/workspace.js'
import { syncPlanHistoryDetailed } from '../research/plan-library.js'
import { captureProgress, diffProgress, buildTurnReport, type ProgressSnapshot, type TurnProgressReport } from '../research/progress.js'
import { DEFAULT_AUTO_CONTINUE, shouldAutoContinue } from '../research/advance.js'

export interface LifecycleInput {
  hook_event_name: string; cwd: string; session_id: string; turn_id?: string
  prompt?: string; permission_mode?: string; stop_hook_active?: boolean; tool_name?: string; tool_use_id?: string
}
interface SessionState {
  root: string; sessionId: string; readOnly: boolean; interrupted: boolean; canContinue: boolean
  baseline?: ProgressSnapshot; rounds: number; staleRounds: number; turn: number
  pendingContinuation?: string; lastStop?: string; lastOutput?: Record<string, unknown>
  observations: Array<{ event: string; tool?: string }>
}
export interface StoredTurnReport { sessionId: string; workspaceRoot: string; report: TurnProgressReport }
export function latestCodexTurn(home: string, root: string): StoredTurnReport | null {
  return readPrivateJson<StoredTurnReport | null>(join(home, 'reports', `${stateKey(realpathSync(root))}.json`), null)
}
export function isReadOnlyRequest(prompt: string): boolean {
  return /只(?:做)?(?:排查|核查|检查|总结|审查|读)|只(?:给|做)(?:方案|计划|建议)|不(?:要|做|进行)(?:任何)?(?:修改|改动|改|写入|修复)|先(?:别|不要)(?:改|修)|read[- ]only|(?:do not|don't) (?:modify|edit|write|change|fix|delete)|(?:audit|review|inspect) only|only (?:audit|review|inspect)|no changes|(?:^|\s)(?:stop|pause)(?:\s|$)|停止|暂停/i.test(prompt)
}
export function requestsResearchContinuation(prompt: string): boolean {
  // A one-off export/account/UI request must not become permission to advance the whole project.
  if (/导出.*方法|export.*methods|打开.*(?:界面|工作台)|open.*(?:workbench|interface)|登录|login|sign in|账号|account/i.test(prompt)) return false
  return /继续|推进|开展|执行|跑实验|实施|完成|(?:建立|创建|开始).*研究|\b(?:continue|proceed|execute|implement)\b|\b(?:start|create).*research|\brun.*experiment/i.test(prompt)
}
function contextOutput(event: string, text: string): Record<string, unknown> {
  return text ? { hookSpecificOutput: { hookEventName: event, additionalContext: text } } : {}
}
export function handleLifecycle(input: LifecycleInput, env: NodeJS.ProcessEnv = process.env): Record<string, unknown> {
  if (!input || typeof input.cwd !== 'string' || !isAbsolute(input.cwd) || typeof input.session_id !== 'string' || !input.session_id) return {}
  const root = realpathSync(input.cwd)
  const plugin = realpathSync(fileURLToPath(new URL('../..', import.meta.url)))
  const fromPlugin = relative(plugin, root)
  if (!fromPlugin || (fromPlugin !== '..' && !fromPlugin.startsWith(`..${sep}`) && !isAbsolute(fromPlugin))) return {}
  const ws = researchWorkspaceOf(root)
  const research = isResearchWorkspace(ws)
  const home = resolve(codexHome(env))
  registerCodexWorkspace(home, root)
  const store = createFileCustomizationStore(() => join(home, 'skill-customizations.json'))
  const skillContent = (id: string) => effectiveSkillContentById(id, store)
  const path = join(home, 'sessions', `${stateKey(`${root}\n${input.session_id}`)}.json`)
  return withPrivateLock(path, () => {
    const state = readPrivateJson<SessionState>(path, {
      root, sessionId: input.session_id, readOnly: true, interrupted: false, canContinue: false,
      rounds: 0, staleRounds: 0, turn: 0, observations: [],
    })
    const event = input.hook_event_name
    const planning = input.permission_mode === 'plan'
    state.observations = [...state.observations, { event, ...(input.tool_name ? { tool: input.tool_name } : {}) }].slice(-64)
    let output: Record<string, unknown> = {}
    if (event === 'UserPromptSubmit') {
      const continuation = Boolean(state.pendingContinuation && input.prompt === state.pendingContinuation)
      if (!continuation) {
        state.rounds = 0; state.staleRounds = 0; state.interrupted = false
        state.readOnly = isReadOnlyRequest(input.prompt ?? '') || planning
        state.canContinue = requestsResearchContinuation(input.prompt ?? '')
      }
      state.pendingContinuation = undefined
      state.lastStop = undefined; state.lastOutput = undefined
      state.baseline = research ? captureProgress(ws, skillContent) : undefined
      if (research && !state.readOnly && !planning) syncPlanHistoryDetailed(ws)
      output = contextOutput(event, codexResearchContext(root, input.prompt ?? '', store))
    } else if (event === 'SessionStart' || event === 'PreToolUse') {
      if (research && !state.baseline && event === 'PreToolUse') state.baseline = captureProgress(ws, skillContent)
      if (research && event === 'PreToolUse' && !state.readOnly && !planning && !state.interrupted) syncPlanHistoryDetailed(ws)
      output = contextOutput(event, codexResearchContext(root, '', store))
    } else if (event === 'Interrupt') {
      state.interrupted = true; state.pendingContinuation = undefined
    } else if (event === 'Stop' && research) {
      // Duplicate delivery must neither consume another continuation nor replace its baseline.
      const stopId = input.turn_id || 'current'
      if (state.lastStop === stopId) return input.stop_hook_active ? {} : state.lastOutput ?? {}
      const after = captureProgress(ws, skillContent)
      const before = state.baseline ?? after
      const diff = diffProgress(before, after)
      state.staleRounds = diff.changed ? 0 : state.staleRounds + 1
      const assessed = captureProgress(ws, skillContent, { staleRounds: state.staleRounds })
      const report = buildTurnReport(diff, ++state.turn, assessed.advance)
      writePrivateJson(join(home, 'reports', `${stateKey(root)}.json`), { sessionId: input.session_id, workspaceRoot: root, report })
      if (!state.readOnly && !planning && !state.interrupted) syncPlanHistoryDetailed(ws)
      const config = readPrivateJson<{ autoContinue?: boolean; autoContinueMaxRounds?: number }>(join(home, 'config.json'), {})
      const configuredMax = config.autoContinueMaxRounds
      const policy = {
        enabled: config.autoContinue ?? DEFAULT_AUTO_CONTINUE.enabled,
        maxRounds: typeof configuredMax === 'number' && Number.isFinite(configuredMax) && configuredMax >= 0 ? Math.floor(configuredMax) : DEFAULT_AUTO_CONTINUE.maxRounds,
      }
      const gate = shouldAutoContinue(assessed.advance, policy, state.rounds)
      if (gate.go && state.canContinue && !state.readOnly && !planning && !state.interrupted) {
        state.rounds++
        const reason = `ConvFusion research continuation ${state.rounds}/${policy.maxRounds}.\n\n${codexResearchContext(root, '', store)}\n\nContinue the user's authorized research: ${assessed.advance.nextStep ?? assessed.advance.basis}. Use native tools, preserve plan review policies, and stop for a blocking choice. Do not expand the user's scope or publish, purchase, or accept paid guidance without their authorization.`
        state.pendingContinuation = reason
        output = { decision: 'block', reason }
      }
      state.baseline = assessed
      state.lastStop = stopId; state.lastOutput = output
    }
    writePrivateJson(path, state)
    return output
  })
}

export async function serveLifecycle(): Promise<void> {
  try {
    let data = ''
    for await (const chunk of process.stdin) {
      data += chunk
      if (data.length > 4 * 1024 * 1024) throw new Error('Hook input too large')
    }
    process.stdout.write(JSON.stringify(handleLifecycle(JSON.parse(data))) + '\n')
  } catch {
    // Observation failures must not break the native agent; never echo prompts or credentials.
    process.stdout.write(JSON.stringify({ systemMessage: 'ConvFusion could not refresh research context; use research_context and check the local adapter state.' }) + '\n')
  }
}
