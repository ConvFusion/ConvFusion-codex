/** Standalone and MCP Apps frontend. All business operations use the shared RPC service. */
import React from 'react'
import { createRoot } from 'react-dom/client'
import { App } from '@modelcontextprotocol/ext-apps'
import { CommunityTab, ConvFusionProjectSettings, copyText, type SettingsSend } from './settings.js'
import { ResearchProgressPanel } from './progress-panel.js'
import { dictionaries, type Translate } from './i18n/index.js'
import logo from '../../assets/favicon.svg'

type Session = { workspaceRoot: string | null; sessionId: string | null; title: string; version: string; uiScope: 'global' | 'workspace'; uiSession: string; url?: string }
let session: Session | undefined
let app: App | undefined
const inHost = window.parent !== window
const token = inHost ? '' : window.location.hash.slice(1) || window.sessionStorage.getItem('convfusion.session') || ''
if (token) { window.sessionStorage.setItem('convfusion.session', token); window.history.replaceState(null, '', window.location.pathname) }
let boot: (value: Session) => void
const ready = new Promise<Session>((resolve) => { boot = resolve })
const transport: SettingsSend = async (endpoint, payload, signal) => {
  if (app) {
    if (!session) await ready
    const result = await app.callServerTool({ name: 'research_ui_action', arguments: { ...(session!.workspaceRoot ? { workspace_root: session!.workspaceRoot } : {}), ui_session: session!.uiSession, endpoint, payload: payload ?? {} } })
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

function Workbench({ initial }: { initial: Session }): JSX.Element {
  const [current, setCurrent] = React.useState(initial)
  const [tab, setTab] = React.useState<'community' | 'progress' | 'methods'>('community')
  const [language, setLanguage] = React.useState<'zh' | 'en'>('zh')
  const [syncDraft, setSyncDraft] = React.useState<string | null>(null)
  const [sending, setSending] = React.useState(false)
  const [sendError, setSendError] = React.useState('')
  React.useEffect(() => {
    // Supply directory selection as app data for the next turn, without sending a chat message.
    void app?.updateModelContext({ structuredContent: { plugin: 'ConvFusion', workspace_root: current.workspaceRoot, scope: current.uiScope } }).catch(() => {})
  }, [current.workspaceRoot, current.uiScope])
  const t: Translate = React.useCallback((key, params) => {
    if (key === 'progress.turn.unavailable') return language === 'zh' ? '所选研究还没有回合报告。审核并信任 Hooks 后，完成一轮研究即可查看；当前研究状态始终可读。' : 'No turn report for this research yet. Trust the hooks and complete a research turn; current workspace state is always available.'
    const template = ((dictionaries[language] as Record<string, string>)[key] ?? key).replaceAll('DSH 设置', '插件设置').replaceAll('DSH settings', 'plugin settings').replaceAll('DSH', 'Codex').replaceAll('Harness', 'Codex')
    return template.replace(/\{(\w+)\}/g, (match, name: string) => params && name in params ? String(params[name]) : match)
  }, [language])
  const zh = language === 'zh'
  const bridge = current.sessionId ? {
    sessionId: current.sessionId, draftEmpty: false,
    syncCommand: (zip: string) => `$convfusion-research 同步研究资料 ${JSON.stringify(zip)}`,
    ...(app && current.uiScope === 'workspace' ? { prepareSync: (text: string) => { setSyncDraft(text); setSendError('') } } : {}),
  } : undefined
  const selectWorkspace = (value: Session) => { session = value; setCurrent(value); setSyncDraft(null) }
  const sendSync = async () => {
    if (!app || !syncDraft?.trim()) return
    setSending(true); setSendError('')
    try {
      const result = await app.sendMessage({ role: 'user', content: [{ type: 'text', text: syncDraft }] })
      if (result.isError) throw new Error(zh ? 'Codex 未接受请求，请复制后发送。' : 'Codex rejected the request. Copy it to the chat instead.')
      setSyncDraft(null)
    } catch (error) { setSendError(error instanceof Error ? error.message : String(error)) }
    finally { setSending(false) }
  }
  return <>
    <header className="header"><img src={logo} alt="" /><div><h1>ConvFusion</h1><small>{current.title} · {current.version}</small></div>
      <select aria-label="Language" value={language} onChange={(e) => setLanguage(e.target.value as 'zh' | 'en')}><option value="zh">简体中文</option><option value="en">English</option></select>
    </header>
    {current.uiScope === 'global' && <WorkspacePicker current={current} onSelect={selectWorkspace} zh={zh} />}
    <nav aria-label={zh ? '功能' : 'Features'}>
      <button aria-current={tab === 'community' ? 'page' : undefined} onClick={() => setTab('community')}>{zh ? '研究网络' : 'Research network'}</button>
      <button aria-current={tab === 'progress' ? 'page' : undefined} onClick={() => setTab('progress')}>{zh ? '研究进展' : 'Research progress'}</button>
      <button aria-current={tab === 'methods' ? 'page' : undefined} onClick={() => setTab('methods')}>{zh ? '研究方法' : 'Research methods'}</button>
    </nav>
    <main key={current.workspaceRoot ?? 'global'}>
      {tab === 'community' && <CommunityTab send={transport} initial={null} t={t} session={bridge} />}
      {tab === 'progress' && <><ContinuationSettings zh={zh} />{current.sessionId ? <ResearchProgressPanel sessionId={current.sessionId} t={t} send={transport} /> : <p role="status">{zh ? '选择研究项目目录后查看进展。' : 'Select a research project directory to view progress.'}</p>}</>}
      {tab === 'methods' && <><MethodsExport zh={zh} enabled={Boolean(current.workspaceRoot)} /><ConvFusionProjectSettings scope={scope} send={transport} t={t} session={bridge} /></>}
    </main>
    {syncDraft !== null && <dialog ref={(node) => { if (node && !node.open) node.showModal() }} onCancel={() => setSyncDraft(null)} aria-label={zh ? '同步请求' : 'Sync request'} className="sync-request">
      <h2>{zh ? '同步请求' : 'Sync request'}</h2>
      <textarea aria-label={zh ? '可编辑的同步请求' : 'Editable sync request'} rows={5} value={syncDraft} onChange={(e) => setSyncDraft(e.target.value)} disabled={sending} />
      <p>{zh ? '发送后先检查差异，确认后再写入研究资料。' : 'The agent compares files first and asks for confirmation before merging.'}</p>
      <button onClick={() => setSyncDraft(null)} disabled={sending}>{zh ? '取消' : 'Cancel'}</button>
      <button onClick={() => { void copyText(syncDraft) }}>{zh ? '复制请求' : 'Copy request'}</button>
      <button onClick={() => { void sendSync() }} disabled={sending || !syncDraft.trim()}>{zh ? '发送给 Codex' : 'Send to Codex'}</button>
      {sendError && <p role="alert">{sendError}</p>}
    </dialog>}
  </>
}

function ContinuationSettings({ zh }: { zh: boolean }): JSX.Element {
  const [policy, setPolicy] = React.useState<{ enabled: boolean; maxRounds: number } | null>(null)
  const [error, setError] = React.useState('')
  React.useEffect(() => { void transport('codex/continuation', {}).then((res) => {
    if (res.ok) setPolicy(res.value as typeof policy)
  }).catch((err) => setError(String(err.message))) }, [])
  const save = async (field: string, value: boolean | number) => {
    try {
      const result = await transport('codex/settings', { field, value })
      if (!result.ok) throw new Error(result.error?.message ?? 'Save failed')
      setPolicy((old) => old && { ...old, [field === 'autoContinue' ? 'enabled' : 'maxRounds']: value }); setError('')
    } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
  }
  return <section className="runtime-settings">
    <label><input type="checkbox" disabled={!policy} checked={policy?.enabled ?? false} onChange={(e) => { void save('autoContinue', e.target.checked) }} />{zh ? '方向明确时自动推进' : 'Continue automatically when the next step is clear'}</label>
    <label>{zh ? '连续推进上限' : 'Continuation limit'} <input aria-label={zh ? '连续推进上限' : 'Continuation limit'} type="number" min={0} max={100} value={policy?.maxRounds ?? 3} disabled={!policy} onChange={(e) => { const value = Number(e.target.value); if (Number.isInteger(value) && value >= 0 && value <= 100) void save('autoContinueMaxRounds', value) }} /></label>
    {error && <p role="alert">{error}</p>}
  </section>
}

function MethodsExport({ zh, enabled }: { zh: boolean; enabled: boolean }): JSX.Element {
  const [message, setMessage] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const run = async (full: boolean) => {
    setBusy(true)
    try {
      const result = await transport('codex/export-methods', { full })
      if (!result.ok) throw new Error(result.error?.message ?? 'Export failed')
      setMessage(String((result.value as { path: string }).path))
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)) }
    finally { setBusy(false) }
  }
  return <section className="runtime-settings">
    <button disabled={!enabled || busy} onClick={() => { void run(false) }}>{zh ? '导出研究方法' : 'Export methods'}</button>
    <button disabled={!enabled || busy} onClick={() => { void run(true) }}>{zh ? '导出完整正文' : 'Export full text'}</button>
    {message && <p role="status">{message}</p>}
  </section>
}

function WorkspacePicker({ current, onSelect, zh }: { current: Session; onSelect: (value: Session) => void; zh: boolean }): JSX.Element {
  const [items, setItems] = React.useState<Array<{ id: string; title: string; path: string }>>([])
  const [path, setPath] = React.useState(current.workspaceRoot ?? '')
  const [error, setError] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  React.useEffect(() => {
    let active = true
    void transport('codex/workspaces', {}).then((result) => {
      if (!active) return
      if (result.ok) setItems(result.value as typeof items)
      else setError(result.error?.message ?? '无法读取项目目录')
    }).catch((error) => { if (active) setError(String(error.message)) })
    return () => { active = false }
  }, [current.workspaceRoot])
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError('')
    try {
      const result = await transport('codex/select-workspace', { path: path.trim() })
      if (!result.ok) throw new Error(result.error?.message ?? '无法打开项目目录')
      const next = result.value as Session
      onSelect(next); setPath(next.workspaceRoot ?? '')
    } catch (error) { setError(error instanceof Error ? error.message : String(error)) }
    finally { setBusy(false) }
  }
  return <section className="workspace-picker" aria-label={zh ? '研究项目目录' : 'Research project directory'}>
    <label htmlFor="workspace-path">{zh ? '研究项目目录' : 'Research project directory'}</label>
    <form onSubmit={(event) => { void submit(event) }}>
      <input id="workspace-path" list="workspace-history" value={path} onChange={(event) => setPath(event.target.value)} placeholder={zh ? '输入项目文件夹的绝对路径' : 'Absolute path to the project folder'} required disabled={busy} spellCheck={false} />
      <datalist id="workspace-history">{items.map((item) => <option key={item.id} value={item.path}>{item.title}</option>)}</datalist>
      <button type="submit" disabled={busy || !path.trim()}>{busy ? (zh ? '正在打开…' : 'Opening…') : (zh ? '打开目录' : 'Open directory')}</button>
    </form>
    <small>{current.workspaceRoot ?? (zh ? '尚未选择目录；可以先登录账号或查看研究方法。' : 'No directory selected. You can sign in or explore research methods first.')}</small>
    <p className="workspace-hint">{zh ? '打开目录只读取现有研究，不会新建或初始化研究项目。' : 'Opening a directory reads existing research without creating or initializing a project.'}</p>
    {error && <p role="alert">{error}</p>}
  </section>
}

const root = createRoot(document.getElementById('root')!)
root.render(<p className="loading" role="status">正在连接研究工作区…</p>)
async function start(): Promise<void> {
  if (inHost) {
    app = new App({ name: 'ConvFusion', version: '1.0.0' }, {}, { autoResize: true })
    app.ontoolresult = (result) => {
      const info = result.structuredContent as Session | undefined
      if (info?.uiSession && info?.uiScope) { session = info; boot(info); root.render(<Workbench key={info.uiSession} initial={info} />) }
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
    root.render(<Workbench initial={session} />)
  }
}
void start().catch((error) => root.render(<div className="loading" role="alert"><h2>无法打开 ConvFusion</h2><p>{String(error.message)}</p><p>请使用 Codex 工具返回的本地界面链接重新打开。</p></div>))
