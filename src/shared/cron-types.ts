export type CronTaskStatus = 'active' | 'paused'
export type CronTaskRunStatus = 'success' | 'error' | 'cancelled'
export type CronTaskTargetType = 'session' | 'workspace' | 'directory'

export interface CronTaskTarget {
  type: CronTaskTargetType
  workspacePath?: string | null
  workspaceName?: string | null
  sessionId?: string | null
  sessionTitle?: string | null
  directoryPath?: string | null
}

export interface CronTaskRun {
  id: string
  startedAt: number
  finishedAt: number
  status: CronTaskRunStatus
  result: string
  error?: string | null
}

export interface CronTaskRegistration {
  name?: string
  cronExpression: string
  prompt: string
  target?: CronTaskTarget | null
  allowNetwork?: boolean
  notifyOnCompletion?: boolean
}

export interface CronScheduleParseRequest {
  input: string
  timezone?: string
  now?: number
}

export interface CronScheduleParseResponse {
  success: boolean
  cronExpression?: string
  normalizedText?: string
  source?: 'rule' | 'model'
  error?: string
}

export interface CronTask {
  id: string
  name: string
  cronExpression: string
  prompt: string
  createdAt: number
  lastRunAt: number | null
  lastResult: string | null
  status: CronTaskStatus
  target?: CronTaskTarget | null
  allowNetwork?: boolean
  notifyOnCompletion?: boolean
  lastStatus?: CronTaskRunStatus | null
  lastError?: string | null
  lastStartedAt?: number | null
  lastFinishedAt?: number | null
  runCount?: number
  resultHistory?: CronTaskRun[]
  isRunning?: boolean
}

export interface CronTaskCompletedEvent {
  taskId: string
  result: string
  task?: CronTask
  run?: CronTaskRun
}
