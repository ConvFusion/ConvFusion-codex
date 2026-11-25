import React from 'react'
import type { AssignedGpuHost } from './gpu-host-types.js'
import type { Translate } from './i18n/index.js'
import type { SettingsSend } from './settings.js'

type HostsState =
  | { status: 'loading' | 'signed-out' | 'unsupported' | 'error' }
  | { status: 'ready'; hosts: AssignedGpuHost[] }

export function GpuHostsPanel({ send, t }: { send: SettingsSend; t: Translate }): JSX.Element {
  const [state, setState] = React.useState<HostsState>({ status: 'loading' })
  const [revision, setRevision] = React.useState(0)

  React.useEffect(() => {
    const controller = new AbortController()
    void send('account/gpu-hosts', {}, controller.signal).then((result) => {
      if (controller.signal.aborted) return
      if (result.ok) {
        setState({ status: 'ready', hosts: result.value as AssignedGpuHost[] })
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
    if (loading) return
    setState({ status: 'loading' })
    setRevision((last) => last + 1)
  }
  const status = state.status === 'ready'
    ? state.hosts.length ? t('gpu.assigned', { count: state.hosts.length }) : t('gpu.empty')
    : t(`gpu.${state.status}`)

  return <section className="gpu-panel" aria-labelledby="gpu-hosts-title">
    <div className="gpu-panel-header">
      <h2 id="gpu-hosts-title">{t('gpu.title')}</h2>
      <button type="button" aria-disabled={loading || undefined} onClick={refresh}>{t('gpu.refresh')}</button>
    </div>
    <p role="status">{status}</p>
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
          <dt>{t('gpu.sshUser')}</dt><dd><code>{host.sshUsername}</code></dd>
          <dt>{t('gpu.sshPort')}</dt><dd>{host.sshPort}</dd>
        </dl>
      </li>)}
    </ul>}
  </section>
}
