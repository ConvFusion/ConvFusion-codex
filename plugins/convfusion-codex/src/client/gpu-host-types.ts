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
}
