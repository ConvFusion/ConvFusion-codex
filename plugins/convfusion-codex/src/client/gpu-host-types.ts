export interface AssignedGpuHost {
  id: string
  name: string
  tailscaleIp: string
  tailscaleDnsName: string | null
  sshPort: number
  sshUsername: string
  gpuModel: string | null
  gpuCount: number | null
  networkAccess: 'existing' | 'pending' | 'accepted' | 'account-mismatch' | 'unavailable' | 'preparing'
  workspace?: {
    id: string
    status: 'requested' | 'ready'
    keyFingerprint: string
    sshPort: number | null
    hostPublicKey: string | null
  } | null
}

export interface GpuWorkspaceSummary {
  id: string
  name: string
  gpuModel: string | null
  gpuCount: number | null
  tailscaleIp: string
  tailscaleDnsName: string | null
  sshUsername: string
  sshPort: number
  networkAccess: AssignedGpuHost['networkAccess']
  workspaceStatus: 'unsupported' | 'unrequested' | 'requested' | 'ready'
  localIdentity: boolean
}
