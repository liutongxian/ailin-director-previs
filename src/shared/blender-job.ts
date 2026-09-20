export type BlenderJobStatus = 'queued' | 'running' | 'complete' | 'failed' | 'cancelled'

export interface BlenderJobSnapshot {
  id: string
  shotId: string
  status: BlenderJobStatus
  outputRelativePath: string
  progress: { frame: number; total: number }
  createdAt: string
  startedAt?: string
  completedAt?: string
  error?: string
  logTail: string
}
