/** Standalone and MCP Apps frontend. All business operations use the shared RPC service. */
import React from 'react'
import { createRoot } from 'react-dom/client'
import { App } from '@modelcontextprotocol/ext-apps'
import { CommunityTab, ConvFusionProjectSettings, copyText, type SettingsSend } from './settings.js'
import { ResearchProgressPanel } from './progress-panel.js'
import { GpuHostsPanel } from './gpu-hosts-panel.js'
import { WorkbenchSettings, type UpdateCheckResult, type WorkbenchLanguage } from './workbench-settings.js'
import { dictionaries, type Translate } from './i18n/index.js'
import logo from '../../assets/favicon.svg'

type Session = { workspaceRoot: string | null; sessionId: string | null; title: string; version: string; autoCheckUpdates?: boolean; uiScope: 'global' | 'workspace'; uiSession: string; downloadTasks?: boolean; pickDownloadFolder?: boolean; uploadTasks?: boolean; url?: string; isResearchWorkspace: boolean; initialTab?: 'community' | 'progress'; progressOnly?: boolean }
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
    const result = await app.callServerTool({ name: 'research_ui_action', arguments: { ...(session!.workspaceRoot ? { workspace_root: session!.workspaceRoot } : {}), ui_session: session!.uiSession, endpoint, payload: payload ?? {} } }, { signal })
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
function translate(language: WorkbenchLanguage, ...[key, params]: Parameters<Translate>): string {
  if (key === 'progress.turn.unavailable') return language === 'zh' ? '所选研究还没有回合报告。审核并信任 Hooks 后，完成一轮研究即可查看；当前研究状态始终可读。' : 'No turn report for this research yet. Trust the hooks and complete a research turn; current workspace state is always available.'
  const template = ((dictionaries[language] as Record<string, string>)[key] ?? key).replaceAll('DSH 设置', '插件设置').replaceAll('DSH settings', 'plugin settings').replaceAll('DSH', 'Codex').replaceAll('Harness', 'Codex')
  return template.replace(/\{(\w+)\}/g, (match, name: string) => params && name in params ? String(params[name]) : match)
}
function WorkspaceProgress({ workspace, language }: { workspace: Session; language: WorkbenchLanguage }): JSX.Element {
  const t: Translate = React.useCallback((key, params) => translate(language, key, params), [language])
  if (workspace.isResearchWorkspace && workspace.sessionId) {
    return <main aria-label={t('progress.name')}>
      <ResearchProgressPanel sessionId={workspace.sessionId} t={t} send={transport} />
    </main>
  }
  const reason = workspace.workspaceRoot ? 'progress.workspace.setupRequired' : 'progress.workspace.unresolved'
  return <main className="progress-unavailable" aria-label={t('progress.name')}>
    <div className="progress-unavailable-content" data-unresolved={!workspace.workspaceRoot} role="status">
      <div className="progress-unavailable-icon" aria-hidden="true">
        <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M8 20a5 5 0 0 1 5-5h11l6 6h19a5 5 0 0 1 5 5v17a6 6 0 0 1-6 6H14a6 6 0 0 1-6-6Z" />
          <circle cx="48" cy="46" r="12" className="progress-unavailable-badge" />
          {workspace.workspaceRoot
            ? <path d="M48 41v5m0 5h.01" />
            : <path d="m44.5 42.5 7 7m0-7-7 7" />}
        </svg>
      </div>
      <h1>{t(`${reason}.title`)}</h1>
      <p className="progress-unavailable-instruction">{t(reason)}</p>
      <p className="progress-unavailable-detail">{t(`${reason}.detail`)}</p>
    </div>
  </main>
}

function Workbench({ initial }: { initial: Session }): JSX.Element {
  const current = initial
  const progressWorkspaceId = current.isResearchWorkspace ? current.sessionId : null
  const [tab, setTab] = React.useState<'community' | 'progress' | 'methods' | 'gpu' | 'settings'>(progressWorkspaceId ? current.initialTab ?? 'progress' : 'community')
  const [language, setLanguage] = React.useState<WorkbenchLanguage>('zh')
  const [syncDraft, setSyncDraft] = React.useState<string | null>(null)
  const [sending, setSending] = React.useState(false)
  const [sendError, setSendError] = React.useState('')
  const [autoCheckUpdates, setAutoCheckUpdates] = React.useState(current.autoCheckUpdates !== false)
  const [availableVersion, setAvailableVersion] = React.useState<string | null>(null)
  const [updateCheck, setUpdateCheck] = React.useState<UpdateCheckResult>(null)
  const checkForUpdates = React.useCallback(async (manual: boolean, signal?: AbortSignal) => {
    if (manual) setUpdateCheck({ status: 'checking' })
    try {
      const result = await transport('version/check', { manual }, signal)
      if (signal?.aborted) return
      const version = result.ok ? result.value as { latest?: unknown; outdated?: boolean } : null
      if (typeof version?.latest !== 'string') {
        if (manual) setUpdateCheck({ status: 'unavailable' })
        return
      }
      setAvailableVersion(version.outdated ? version.latest : null)
      if (manual) setUpdateCheck(version.outdated
        ? { status: 'available', version: version.latest }
        : { status: 'current' })
    } catch {
      if (manual) setUpdateCheck({ status: 'unavailable' })
    }
  }, [])
  React.useEffect(() => {
    if (!autoCheckUpdates) return
    const controller = new AbortController()
    void checkForUpdates(false, controller.signal)
    return () => controller.abort()
  }, [autoCheckUpdates, checkForUpdates])
  const changeAutoCheckUpdates = async (enabled: boolean) => {
    const result = await transport('codex/settings', { field: 'autoCheckUpdates', value: enabled })
    if (!result.ok) throw new Error(result.error?.message)
    setAutoCheckUpdates(enabled)
  }
  React.useEffect(() => {
    // Supply the task workspace as app data for the next turn, without sending a chat message.
    void app?.updateModelContext({ structuredContent: { plugin: 'ConvFusion', workspace_root: current.workspaceRoot, scope: current.uiScope } }).catch(() => {})
  }, [current.workspaceRoot, current.uiScope])
  const t: Translate = React.useCallback((key, params) => translate(language, key, params), [language])
  const zh = language === 'zh'
  React.useEffect(() => { document.documentElement.lang = zh ? 'zh-CN' : 'en' }, [zh])
  const bridge = {
    sessionId: current.sessionId ?? '', draftEmpty: false, downloadTasks: current.downloadTasks === true, uploadTasks: current.uploadTasks === true,
    pickDownloadFolder: current.pickDownloadFolder === true,
    syncCommand: (zip: string) => `$convfusion-research 同步研究资料 ${JSON.stringify(zip)}`,
    ...(app && current.uiScope === 'workspace' ? { prepareSync: (text: string) => { setSyncDraft(text); setSendError('') } } : {}),
  }
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
    <header className="header"><img src={logo} alt="" /><div><h1>ConvFusion</h1><small>{current.title} · {current.version}（{__CLIENT_BUILD__}）</small></div>
    </header>
    <div role="status" className="plugin-update-notice">
      {availableVersion && <p><strong>{t('workbench.updates.available', { version: availableVersion })}</strong> {t('workbench.updates.instructions')}</p>}
    </div>
    <nav className="workbench-nav" aria-label={zh ? '功能' : 'Features'}>
      <button aria-current={tab === 'community' ? 'page' : undefined} onClick={() => setTab('community')}>{zh ? '研究网络' : 'Research network'}</button>
      {progressWorkspaceId && <button aria-current={tab === 'progress' ? 'page' : undefined} onClick={() => setTab('progress')}>{zh ? '研究进展' : 'Research progress'}</button>}
      <button aria-current={tab === 'methods' ? 'page' : undefined} onClick={() => setTab('methods')}>{zh ? '研究方法' : 'Research methods'}</button>
      <button aria-current={tab === 'gpu' ? 'page' : undefined} onClick={() => setTab('gpu')}>{t('gpu.title')}</button>
      <button aria-current={tab === 'settings' ? 'page' : undefined} onClick={() => setTab('settings')}>{t('workbench.settings.title')}</button>
    </nav>
    <main key={current.workspaceRoot ?? 'global'}>
      {tab === 'community' && <CommunityTab send={transport} initial={null} t={t} session={bridge} view="network" />}
      {tab === 'progress' && progressWorkspaceId && <ResearchProgressPanel sessionId={progressWorkspaceId} t={t} send={transport} />}
      {tab === 'methods' && <><MethodsExport zh={zh} enabled={Boolean(current.workspaceRoot)} /><ConvFusionProjectSettings send={transport} t={t} session={bridge} view="methods" /></>}
      {tab === 'gpu' && <GpuHostsPanel send={transport} t={t} />}
      {tab === 'settings' && <WorkbenchSettings send={transport} t={t} language={language} onLanguageChange={setLanguage}
        updates={{ version: current.version, automatic: autoCheckUpdates, result: updateCheck, onChange: changeAutoCheckUpdates, onCheck: () => { void checkForUpdates(true) } }} />}
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
  return <section className="method-actions">
    <button disabled={!enabled || busy} onClick={() => { void run(false) }}>{zh ? '导出研究方法' : 'Export methods'}</button>
    <button disabled={!enabled || busy} onClick={() => { void run(true) }}>{zh ? '导出完整正文' : 'Export full text'}</button>
    {message && <p role="status">{message}</p>}
  </section>
}

const root = createRoot(document.getElementById('root')!)
function displayLanguage(locale = navigator.language): WorkbenchLanguage {
  return /^zh(?:-|$)/i.test(locale) ? 'zh' : 'en'
}
let panelLanguage = displayLanguage()
function showLoading(): void {
  document.documentElement.lang = panelLanguage === 'zh' ? 'zh-CN' : 'en'
  root.render(<p className="loading" role="status">{translate(panelLanguage, 'workbench.connection.loading')}</p>)
}
showLoading()
function showPage(info: Session): void {
  session = info
  boot(info)
  if (info.progressOnly) {
    document.documentElement.lang = panelLanguage === 'zh' ? 'zh-CN' : 'en'
    document.title = translate(panelLanguage, 'progress.name')
    root.render(<WorkspaceProgress key={info.uiSession} workspace={info} language={panelLanguage} />)
  } else {
    document.title = 'ConvFusion'
    root.render(<Workbench key={info.uiSession} initial={info} />)
  }
}
function applyHostLanguage(locale?: string): void {
  const language = displayLanguage(locale)
  if (panelLanguage === language) return
  panelLanguage = language
  if (!session) showLoading()
  else if (session.progressOnly) showPage(session)
}
async function start(): Promise<void> {
  if (inHost) {
    app = new App({ name: 'ConvFusion', version: '1.0.0' }, {}, { autoResize: true })
    app.ontoolresult = (result) => {
      const info = result.structuredContent as Session | undefined
      if (info?.uiSession && info?.uiScope) showPage(info)
    }
    app.onhostcontextchanged = (context) => {
      if (context.theme) document.documentElement.dataset.theme = context.theme
      applyHostLanguage(app?.getHostContext()?.locale)
    }
    await app.connect()
    applyHostLanguage(app.getHostContext()?.locale)
    await ready
  } else {
    const result = await transport('codex/bootstrap', {})
    if (!result.ok) throw new Error(result.error?.message)
    showPage(result.value as Session)
  }
}
void start().catch((error) => root.render(<div className="loading" role="alert">
  <h2>{translate(panelLanguage, 'workbench.connection.failed')}</h2>
  {error.message && <p>{String(error.message)}</p>}
  <p>{translate(panelLanguage, 'workbench.connection.retry')}</p>
</div>))
