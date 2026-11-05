/** User-facing call status, separate from the agent's assessment of the advice. */
export function decisionAssistSummary(value: Record<string, unknown>): string {
  if (value.status === 'used') {
    const title = value.cached === true
      ? '【DCRM 缓存建议】本次复用已有结果，未发起新的模型推理。'
      : value.shared_request === true
        ? '【DCRM 共享请求】本次取得同一进行中请求的结果，未重复发起模型推理。'
        : '【已调用 DCRM】已取得本次决策模型的建议。'
    return `${title}\n推荐：${String(value.predicted_label ?? '')} · ${String(value.predicted_text ?? '')}\n采纳情况：待主 Agent 判断。继续处理前，请在聊天区用醒目的“DCRM 决策辅助”标识说明采纳、部分采纳或不采纳及依据，并在本轮任务总结中回顾其实际作用。`
  }
  const skipped: Record<string, string> = {
    disabled: '【DCRM 已关闭】本次未请求决策服务，按常规流程继续。',
    not_logged_in: '【DCRM 未调用】尚未登录 ConvFusion，本次按常规流程继续。',
    no_research_workspace: '【DCRM 未调用】当前没有研究工作区，本次按常规流程继续。',
    invalid_input: '【DCRM 未调用】决策问题或候选项无效，本次按常规流程继续。',
    settings_changed: '【DCRM 建议未使用】等待期间开关、账号或服务器设置发生变化，已丢弃返回结果。',
    service_unavailable: '【DCRM 暂不可用】本次未取得可用建议，已回退到常规流程。',
  }
  return skipped[String(value.reason)] ?? '【DCRM 未使用】本次没有可用的决策建议，按常规流程继续。'
}

/** Included in both native hooks and explicit context refreshes. */
export function decisionAssistGuidance(enabled: boolean): string {
  const preference = enabled
    ? 'DCRM decision assistance is enabled at this refresh. You must consult research_decision_assist when selecting the next research action, assessing evidence sufficiency or claim consistency, or deciding research direction, including read-only/chat-only analysis. Briefly announce the consultation in chat. Workspace write permission is not a prerequisite; respect an explicit network prohibition and the tool\'s auth/service gates.'
    : 'DCRM decision assistance is disabled at this refresh. Continue the normal workflow without consulting it, unless the user explicitly asks to test the disabled behavior.'
  return `## Decision assistance visibility\n\n${preference}\n\nThe consultation reads existing state and returns advice without creating or changing workspace files. Report the call and adoption assessment in chat. When workspace changes are permitted, save useful research outcomes with the normal tools as appropriate; when they are prohibited, keep outputs in chat. Neither saving nor permission to save is a condition for the model consultation.\n\nMake the involvement prominent: use a standalone bold DCRM decision-assistance label in progress commentary, in the user's language (for Chinese: **DCRM 决策辅助**). After a used result, state the recommendation, then say whether you adopt, partially adopt or reject it and give a short evidence-based reason before continuing. In the final task summary, always include a clearly labeled DCRM participation summary: which decision it advised, its recommendation, how it was used and the concrete consequence. If it was disabled, skipped, unavailable or there was no relevant decision point, say so rather than claiming participation. If several consultations occurred, summarize the actual overall role. Distinguish a new request from cached or shared results. A skipped result never supports a claim that DCRM was used. Do not claim the suggestion changed the decision without actually assessing it. Settings can change after this context refresh; the tool result is authoritative. These are concise decision summaries, not private reasoning transcripts.`
}
