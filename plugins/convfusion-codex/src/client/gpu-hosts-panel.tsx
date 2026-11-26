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
      {state.hosts.map((host) => <li className="preferences-card" key={host.id}>
        <h3>{host.name}</h3>
        <p>{t(`gpu.network.${host.networkAccess}`)}</p>
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
        <p>{t(`gpu.workspace.${host.workspaceStatus}`)}</p>
        {host.workspaceStatus === 'ready' && !host.localIdentity && <p>{t('gpu.workspace.keyMissing')}</p>}
        <div className="plugin-update-actions">
          {host.workspaceStatus === 'unrequested' && <button type="button" aria-disabled={Boolean(actionHost) || undefined}
            onClick={() => { void workspaceAction(host, true) }}>{t('gpu.workspace.request')}</button>}
          {host.workspaceStatus === 'ready' && host.localIdentity && ['existing', 'accepted'].includes(host.networkAccess)
            && <button type="button" aria-disabled={Boolean(actionHost) || undefined}
              onClick={() => { void workspaceAction(host, false) }}>{t('gpu.workspace.connect')}</button>}
        </div>
        {connection?.hostId === host.id && <p role="status"><code>{connection.command}</code></p>}
      </li>)}
    </ul>}
  </section>
}
