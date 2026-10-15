/** Standalone and MCP Apps frontend. All business operations use the shared RPC service. */
import React from 'react'
import { createRoot } from 'react-dom/client'
import { App } from '@modelcontextprotocol/ext-apps'
import { CommunityTab, ConvFusionProjectSettings, type SettingsSend } from './settings.js'
import { ResearchProgressPanel } from './progress-panel.js'
import { dictionaries, type Translate } from './i18n/index.js'
import logo from '../../assets/favicon.svg'

type Session = { workspaceRoot: string; sessionId: string; title: string; version: string; url?: string }
let session: Session | undefined
let app: App | undefined
const token = window.location.hash.slice(1) || window.sessionStorage.getItem('convfusion.session') || ''
if (token) { window.sessionStorage.setItem('convfusion.session', token); window.history.replaceState(null, '', window.location.pathname) }
const inHost = window.parent !== window
let boot: (value: Session) => void
const ready = new Promise<Session>((resolve) => { boot = resolve })
const transport: SettingsSend = async (endpoint, payload, signal) => {
  if (app) {
    if (!session) await ready
    const result = await app.callServerTool({ name: 'research_ui_action', arguments: { workspace_root: session!.workspaceRoot, endpoint, payload: payload ?? {} } })
    const value = result.structuredContent
    if (value && typeof value.ok === 'boolean') return value as unknown as Awaited<ReturnType<SettingsSend>>
    throw new Error('界面未收到服务返回的数据')
  }
  const response = await fetch('/rpc', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ workspaceRoot: session?.workspaceRoot, endpoint, payload }), signal,
  })
  if (!response.ok) throw new Error('连接已失效，请在 Codex 中重新打开 ConvFusion 界面。')
  return response.json()
}
const scopeState = { status: 'ready' as const }
const scope = {
  getSnapshot: () => scopeState,
  subscribe: (_listener: () => void) => () => {},
  async set(field: string, value: unknown) { const result = await transport('codex/settings', { field, value }); if (!result.ok) throw new Error(result.error?.message ?? '保存失败') },
  async unset(field: string) { await scope.set(field, '') },
}

function Workbench({ current }: { current: Session }): JSX.Element {
  const [tab, setTab] = React.useState<'community' | 'progress' | 'methods'>('community')
  const [language, setLanguage] = React.useState<'zh' | 'en'>('zh')
  const t: Translate = React.useCallback((key, params) => {
    const template = ((dictionaries[language] as Record<string, string>)[key] ?? key).replaceAll('DSH 设置', '插件设置').replaceAll('DSH settings', 'plugin settings').replaceAll('DSH', 'Codex').replaceAll('Harness', 'Codex')
    return template.replace(/\{(\w+)\}/g, (match, name: string) => params && name in params ? String(params[name]) : match)
  }, [language])
  const zh = language === 'zh'
  return <>
    <header className="header"><img src={logo} alt="" /><div><h1>ConvFusion</h1><small>{current.title} · {current.version}</small></div>
      <select aria-label="Language" value={language} onChange={(e) => setLanguage(e.target.value as 'zh' | 'en')}><option value="zh">简体中文</option><option value="en">English</option></select>
    </header>
    <nav aria-label={zh ? '功能' : 'Features'}>
      <button aria-current={tab === 'community' ? 'page' : undefined} onClick={() => setTab('community')}>{zh ? '研究网络' : 'Research network'}</button>
      <button aria-current={tab === 'progress' ? 'page' : undefined} onClick={() => setTab('progress')}>{zh ? '研究进展' : 'Research progress'}</button>
      <button aria-current={tab === 'methods' ? 'page' : undefined} onClick={() => setTab('methods')}>{zh ? '研究方法' : 'Research methods'}</button>
    </nav>
    <main key={current.workspaceRoot}>
      {tab === 'community' && <CommunityTab send={transport} initial={null} t={t} session={{ sessionId: current.sessionId, draftEmpty: false, syncCommand: (zip) => `$convfusion-research 同步研究资料 ${JSON.stringify(zip)}` }} />}
      {tab === 'progress' && <ResearchProgressPanel sessionId={current.sessionId} t={t} send={transport} showTurnReport={false} />}
      {tab === 'methods' && <ConvFusionProjectSettings scope={scope} send={transport} t={t} session={{ sessionId: current.sessionId, draftEmpty: false, syncCommand: (zip) => `$convfusion-research 同步研究资料 ${JSON.stringify(zip)}` }} />}
    </main>
  </>
}

const root = createRoot(document.getElementById('root')!)
root.render(<p className="loading" role="status">正在连接研究工作区…</p>)
async function start(): Promise<void> {
  if (inHost) {
    app = new App({ name: 'ConvFusion', version: '1.0.0' }, {}, { autoResize: true })
    app.ontoolresult = (result) => {
      const info = result.structuredContent as Session | undefined
      if (info?.workspaceRoot && info?.sessionId) { session = info; boot(info); root.render(<Workbench current={info} />) }
    }
    app.onhostcontextchanged = (context) => {
      if (context.theme) document.documentElement.dataset.theme = context.theme
    }
    await app.connect()
    await ready
  } else {
    const result = await transport('codex/bootstrap', {})
    if (!result.ok) throw new Error(result.error?.message ?? '无法读取工作区')
    session = result.value as Session
    boot(session)
    root.render(<Workbench current={session} />)
  }
}
void start().catch((error) => root.render(<div className="loading" role="alert"><h2>无法打开 ConvFusion</h2><p>{String(error.message)}</p><p>请使用 Codex 工具返回的本地界面链接重新打开。</p></div>))
