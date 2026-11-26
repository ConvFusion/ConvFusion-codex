import React from 'react'
import type { GpuWorkspaceSummary } from './gpu-host-types.js'
import type { Translate } from './i18n/index.js'
import type { SettingsSend } from './settings.js'

type HostsState =
  | { status: 'loading' | 'signed-out' | 'unsupported' | 'error' }
  | { status: 'ready'; hosts: GpuWorkspaceSummary[] }

export function GpuHostsPanel({ send, t }: { send: SettingsSend; t: Translate }): JSX.Element {
  const [state, setState] = React.useState<HostsState>({ status: 'loading' })
  const [revision, setRevision] = React.useState(0)
  const [actionHost, setActionHost] = React.useState<string | null>(null)
  const [actionError, setActionError] = React.useState('')
  const [connection, setConnection] = React.useState<{ hostId: string; command: string } | null>(null)

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
        const canUseWorkspace = host.workspaceStatus === 'ready' && host.localIdentity
          && (host.networkAccess === 'existing' || host.networkAccess === 'accepted')
        const command = connection?.hostId === host.id ? connection.command : null
        return <li className="preferences-card" key={host.id}>
          <h3>{host.name}</h3>
          <p className="gpu-host-status">{t(`gpu.network.${host.networkAccess}`)}</p>
          <dl>
            {(host.gpuModel || host.gpuCount !== null) && <>
              <dt>GPU</dt>
              <dd>{host.gpuModel}{host.gpuCount !== null && (host.gpuModel ? ` × ${host.gpuCount}` : host.gpuCount)}</dd>
            </>}
            <dt>Tailscale IP</dt><dd><code>{host.tailscaleIp}</code></dd>
            {host.tailscaleDnsName && <><dt>MagicDNS</dt><dd><code>{host.tailscaleDnsName}</code></dd></>}
            {host.workspaceStatus === 'unsupported' && <>
              <dt>{t('gpu.sshUser')}</dt><dd><code>{host.sshUsername}</code></dd>
              <dt>{t('gpu.sshPort')}</dt><dd>{host.sshPort}</dd>
            </>}
          </dl>
          <p className="gpu-host-status">{t(`gpu.workspace.${host.workspaceStatus}`)}</p>
          {host.workspaceStatus === 'ready' && !host.localIdentity && <p className="gpu-host-warning">{t('gpu.workspace.keyMissing')}</p>}
          {host.workspaceStatus === 'unrequested' && <div className="plugin-update-actions">
            <button type="button" aria-disabled={Boolean(actionHost) || undefined}
              onClick={() => { void workspaceAction(host, true) }}>{t('gpu.workspace.request')}</button>
          </div>}
          {canUseWorkspace && <div className="gpu-host-actions">
            <details className="gpu-host-codex-guide">
              <summary className="gpu-host-codex-summary">
                <span className="gpu-host-codex-heading">
                  <span className="gpu-host-codex-title">{t('gpu.workspace.codexTitle')}</span>
                  <span className="gpu-host-tag gpu-host-tag-recommended">{t('gpu.workspace.recommended')}</span>
                </span>
                <svg className="gpu-host-chevron" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path d="M4.25 6.25 8 10l3.75-3.75" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </summary>
              <div className="gpu-host-codex-body">
                <p>{t('gpu.workspace.codexHint')}</p>
                <p className="gpu-host-codex-example">{t('gpu.workspace.codexExample', { host: host.name })}</p>
              </div>
            </details>
            <div className="gpu-host-ssh-section">
              <button type="button" className="gpu-host-ssh-toggle"
                aria-disabled={Boolean(actionHost) || undefined} aria-expanded={command !== null}
                onClick={() => toggleConnection(host)}>
                <span className="gpu-host-ssh-label">
                  {t(command === null ? 'gpu.workspace.connect' : 'gpu.workspace.hideConnection')}
                </span>
                <span className="gpu-host-tag gpu-host-tag-discouraged">{t('gpu.workspace.notRecommended')}</span>
              </button>
              {command !== null && <p className="gpu-host-ssh-command" role="status"><code>{command}</code></p>}
            </div>
          </div>}
        </li>
      })}
    </ul>}
  </section>
}
