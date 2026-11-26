import React from 'react'
import type { GpuWorkspaceSummary } from './gpu-host-types.js'
import type { Translate } from './i18n/index.js'
import { copyText, type SettingsSend } from './settings.js'

type HostsState =
  | { status: 'loading' | 'signed-out' | 'unsupported' | 'error' }
  | { status: 'ready'; hosts: GpuWorkspaceSummary[] }

export function GpuHostsPanel({ send, t }: { send: SettingsSend; t: Translate }): JSX.Element {
  const [state, setState] = React.useState<HostsState>({ status: 'loading' })
  const [revision, setRevision] = React.useState(0)
  const [actionHost, setActionHost] = React.useState<string | null>(null)
  const [actionError, setActionError] = React.useState('')
  const [connection, setConnection] = React.useState<{ hostId: string; command: string } | null>(null)
  const [openGuides, setOpenGuides] = React.useState<Record<string, boolean>>({})
  const [copiedHost, setCopiedHost] = React.useState<string | null>(null)
  const copyTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  React.useEffect(() => () => {
    if (copyTimer.current) clearTimeout(copyTimer.current)
  }, [])

  React.useEffect(() => {
    const controller = new AbortController()
    void send('gpu/workspaces', {}, controller.signal).then((result) => {
      if (controller.signal.aborted) return
      if (result.ok) {
        setState({ status: 'ready', hosts: result.value as GpuWorkspaceSummary[] })
      } else {
        const code = result.error?.code
        setState({ status: code === 'not-configured' || code === 'invalid-key' ? 'signed-out'
          : code === 'gpu-hosts-unavailable' ? 'unsupported' : 'error' })
      }
    }).catch(() => {
      if (!controller.signal.aborted) setState({ status: 'error' })
    })
    return () => controller.abort()
  }, [send, revision])

  const loading = state.status === 'loading'
  const refresh = () => {
    if (loading || actionHost) return
    setConnection(null)
    setOpenGuides({})
    setActionError('')
    setState({ status: 'loading' })
    setRevision((last) => last + 1)
  }
  const workspaceAction = async (host: GpuWorkspaceSummary, request: boolean) => {
    if (loading || actionHost) return
    setActionHost(host.id)
    setActionError('')
    setConnection(null)
    try {
      const result = await send(request ? 'gpu/workspace-request' : 'gpu/workspace-connection', { hostId: host.id })
      if (!result.ok) {
        setActionError(result.error?.message || t('gpu.workspace.actionError'))
      } else if (request) {
        setState({ status: 'loading' })
        setRevision((last) => last + 1)
      } else {
        setConnection({ hostId: host.id, command: (result.value as { command: string }).command })
      }
    } catch {
      setActionError(t('gpu.workspace.actionError'))
    } finally {
      setActionHost(null)
    }
  }
  const toggleConnection = (host: GpuWorkspaceSummary) => {
    if (connection?.hostId === host.id) {
      setConnection(null)
      return
    }
    void workspaceAction(host, false)
  }
  const toggleGuide = (hostId: string) => {
    setOpenGuides((current) => ({ ...current, [hostId]: !current[hostId] }))
  }
  const copyPrompt = async (hostId: string, prompt: string) => {
    if (!await copyText(prompt)) return
    setCopiedHost(hostId)
    if (copyTimer.current) clearTimeout(copyTimer.current)
    copyTimer.current = setTimeout(() => setCopiedHost((current) => (current === hostId ? null : current)), 1800)
  }
  const status = state.status === 'ready'
    ? state.hosts.length ? t('gpu.assigned', { count: state.hosts.length }) : t('gpu.empty')
    : t(`gpu.${state.status}`)

  return <section className="gpu-panel" aria-labelledby="gpu-hosts-title">
    <div className="gpu-panel-header">
      <h2 id="gpu-hosts-title">{t('gpu.title')}</h2>
      <button type="button" aria-disabled={loading || Boolean(actionHost) || undefined} onClick={refresh}>{t('gpu.refresh')}</button>
    </div>
    <p role="status">{status}</p>
    {actionError && <p role="alert">{actionError}</p>}
    {state.status === 'ready' && state.hosts.length > 0 && <ul className="gpu-host-list">
      {state.hosts.map((host) => {
        const networkReady = host.networkAccess === 'existing' || host.networkAccess === 'accepted'
        const networkTone = networkReady ? 'success' : host.networkAccess === 'account-mismatch' ? 'error' : 'warn'
        const missingKey = host.workspaceStatus === 'ready' && !host.localIdentity
        const workspaceTone = missingKey ? 'warn'
          : host.workspaceStatus === 'ready' ? 'success'
            : host.workspaceStatus === 'requested' ? 'warn' : 'neutral'
        const workspaceBadgeKey = missingKey ? 'gpu.workspaceBadge.keyMissing' : `gpu.workspaceBadge.${host.workspaceStatus}`
        const canUseWorkspace = host.workspaceStatus === 'ready' && host.localIdentity && networkReady
        const command = connection?.hostId === host.id ? connection.command : null
        const guideOpen = Boolean(openGuides[host.id])
        const guideId = `gpu-codex-guide-${host.id}`
        const gpuSpec = (host.gpuModel || host.gpuCount !== null)
          ? `${host.gpuModel ?? ''}${host.gpuCount !== null ? (host.gpuModel ? ` × ${host.gpuCount}` : String(host.gpuCount)) : ''}`
          : null

        return <li className="preferences-card gpu-host-card" key={host.id}>
          <header className="gpu-host-header">
            <div className="gpu-host-identity">
              <h3>{host.name}</h3>
              {gpuSpec && <p className="gpu-host-gpu">
                <svg className="gpu-host-gpu-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <rect x="3.5" y="3.5" width="9" height="9" rx="1.75" stroke="currentColor" strokeWidth="1.35" />
                  <rect x="6" y="6" width="4" height="4" rx="0.75" fill="currentColor" opacity="0.22" stroke="currentColor" strokeWidth="1.1" />
                  <path d="M6 1.75V3.5M10 1.75V3.5M6 12.5v1.75M10 12.5v1.75M1.75 6H3.5M1.75 10H3.5M12.5 6h1.75M12.5 10h1.75" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
                </svg>
                <span>{gpuSpec}</span>
              </p>}
            </div>
            <div className="gpu-host-badges">
              <span className="gpu-host-pill" data-tone={networkTone} title={t(`gpu.network.${host.networkAccess}`)}>
                {t(`gpu.networkBadge.${host.networkAccess}`)}
              </span>
              <span className="gpu-host-pill" data-tone={workspaceTone} title={t(missingKey ? 'gpu.workspace.keyMissing' : `gpu.workspace.${host.workspaceStatus}`)}>
                {t(workspaceBadgeKey)}
              </span>
            </div>
          </header>

          <dl className="gpu-host-meta">
            <div className="gpu-host-meta-item">
              <dt>Tailscale IP</dt>
              <dd><code>{host.tailscaleIp}</code></dd>
            </div>
            {host.tailscaleDnsName && <div className="gpu-host-meta-item">
              <dt>MagicDNS</dt>
              <dd><code>{host.tailscaleDnsName}</code></dd>
            </div>}
            {host.workspaceStatus === 'unsupported' && <>
              <div className="gpu-host-meta-item">
                <dt>{t('gpu.sshUser')}</dt>
                <dd><code>{host.sshUsername}</code></dd>
              </div>
              <div className="gpu-host-meta-item">
                <dt>{t('gpu.sshPort')}</dt>
                <dd><code>{host.sshPort}</code></dd>
              </div>
            </>}
          </dl>

          {!networkReady && <p className="gpu-host-notice" data-tone={networkTone}>{t(`gpu.network.${host.networkAccess}`)}</p>}
          {missingKey && <p className="gpu-host-warning">{t('gpu.workspace.keyMissing')}</p>}
          {(host.workspaceStatus === 'requested' || host.workspaceStatus === 'unsupported') && (
            <p className="gpu-host-status">{t(`gpu.workspace.${host.workspaceStatus}`)}</p>
          )}

          {host.workspaceStatus === 'unrequested' && <div className="gpu-host-footer">
            <div className="gpu-host-action-bar">
              <div className="plugin-update-actions">
                <button type="button" aria-disabled={Boolean(actionHost) || undefined}
                  onClick={() => { void workspaceAction(host, true) }}>{t('gpu.workspace.request')}</button>
              </div>
              <p className="gpu-host-status">{t('gpu.workspace.unrequested')}</p>
            </div>
          </div>}

          {canUseWorkspace && <div className="gpu-host-footer">
            <div className="gpu-host-action-bar">
              <button type="button" className="gpu-host-codex-toggle"
                aria-expanded={guideOpen} aria-controls={guideId}
                onClick={() => toggleGuide(host.id)}>
                <span>{t('gpu.workspace.codexTitle')}</span>
                <span className="gpu-host-tag gpu-host-tag-recommended">{t('gpu.workspace.recommended')}</span>
                <svg className="gpu-host-chevron" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path d="M4.25 6.25 8 10l3.75-3.75" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              <button type="button" className="gpu-host-ssh-toggle"
                aria-disabled={Boolean(actionHost) || undefined} aria-expanded={command !== null}
                onClick={() => toggleConnection(host)}>
                <span className="gpu-host-ssh-label">
                  {t(command === null ? 'gpu.workspace.connect' : 'gpu.workspace.hideConnection')}
                </span>
                <span className="gpu-host-tag gpu-host-tag-discouraged">{t('gpu.workspace.notRecommended')}</span>
              </button>
            </div>
            {guideOpen && (() => {
              const examplePrompt = t('gpu.workspace.codexExample', { host: host.name })
              const copied = copiedHost === host.id
              return <div id={guideId} className="gpu-host-codex-panel">
                <p>{t('gpu.workspace.codexHint')}</p>
                <div className="gpu-host-prompt-box">
                  <div className="gpu-host-prompt-head">
                    <span className="gpu-host-prompt-label">
                      <svg className="gpu-host-prompt-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                        <path d="M2.75 4.25A2 2 0 0 1 4.75 2.25h6.5a2 2 0 0 1 2 2v4.75a2 2 0 0 1-2 2H6.6l-2.45 2.05a.45.45 0 0 1-.74-.35v-1.7h-.66a2 2 0 0 1-2-2V4.25Z" stroke="currentColor" strokeWidth="1.35" strokeLinejoin="round" />
                      </svg>
                      {t('gpu.workspace.codexExampleLabel')}
                    </span>
                    <button type="button" className="gpu-host-prompt-copy" data-copied={copied || undefined}
                      onClick={() => { void copyPrompt(host.id, examplePrompt) }}>
                      {t(copied ? 'gpu.workspace.copied' : 'gpu.workspace.copyExample')}
                    </button>
                  </div>
                  <blockquote className="gpu-host-codex-example">{examplePrompt}</blockquote>
                </div>
              </div>
            })()}
            {command !== null && <p className="gpu-host-ssh-command" role="status"><code>{command}</code></p>}
          </div>}
        </li>
      })}
    </ul>}
  </section>
}
