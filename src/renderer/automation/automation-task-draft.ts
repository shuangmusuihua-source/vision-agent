import type { SdkSessionInfo } from '../../shared/types'
import type { CronTask, CronTaskRegistration, CronTaskTarget } from '../../shared/cron-types'
import { MAX_CRON_LINKED_URLS, normalizeCronLinkedUrls } from '../../shared/cron-linked-urls'

export type FrequencyMode = 'daily' | 'weekly' | 'hourly' | 'thirty' | 'custom'
export type TargetMode = 'none' | 'session' | 'workspace' | 'directory'

export type AutomationTaskDraft = {
  name: string
  prompt: string
  frequencyMode: FrequencyMode
  hour: number
  weekday: number
  customScheduleText: string
  customCron: string
  customCronSource: string
  customScheduleError: string | null
  resolvingSchedule: boolean
  targetMode: TargetMode
  selectedSessionId: string
  selectedWorkspacePath: string
  selectedDirectoryPath: string
  linkedUrlInputs: string[]
  allowNetwork: boolean
  notifyOnCompletion: boolean
}

export type AutomationDraftAction =
  | { type: 'set'; field: keyof AutomationTaskDraft; value: AutomationTaskDraft[keyof AutomationTaskDraft] }
  | { type: 'syncDefaults'; sessionId: string; workspacePath: string }
  | { type: 'scheduleStart' }
  | { type: 'scheduleResolved'; input: string; cronExpression: string }
  | { type: 'scheduleError'; message: string }
  | { type: 'addUrl' }
  | { type: 'updateUrl'; index: number; value: string }
  | { type: 'removeUrl'; index: number }
  | { type: 'reset'; sessionId: string; workspacePath: string }

export const WEEKDAYS = [
  { value: 1, label: '周一' },
  { value: 2, label: '周二' },
  { value: 3, label: '周三' },
  { value: 4, label: '周四' },
  { value: 5, label: '周五' },
  { value: 6, label: '周六' },
  { value: 0, label: '周日' },
]

export function createAutomationTaskDraft(
  sessionId = '',
  workspacePath = '',
): AutomationTaskDraft {
  return {
    name: '',
    prompt: '',
    frequencyMode: 'daily',
    hour: 9,
    weekday: 1,
    customScheduleText: '',
    customCron: '',
    customCronSource: '',
    customScheduleError: null,
    resolvingSchedule: false,
    targetMode: 'none',
    selectedSessionId: sessionId,
    selectedWorkspacePath: workspacePath,
    selectedDirectoryPath: '',
    linkedUrlInputs: [''],
    allowNetwork: false,
    notifyOnCompletion: true,
  }
}

export function automationTaskDraftReducer(
  draft: AutomationTaskDraft,
  action: AutomationDraftAction,
): AutomationTaskDraft {
  switch (action.type) {
    case 'set':
      return { ...draft, [action.field]: action.value }
    case 'syncDefaults':
      return {
        ...draft,
        selectedSessionId: draft.selectedSessionId || action.sessionId,
        selectedWorkspacePath: draft.selectedWorkspacePath || action.workspacePath,
      }
    case 'scheduleStart':
      return { ...draft, resolvingSchedule: true, customScheduleError: null }
    case 'scheduleResolved':
      return {
        ...draft,
        resolvingSchedule: false,
        customScheduleError: null,
        customCron: action.cronExpression,
        customCronSource: action.input,
      }
    case 'scheduleError':
      return { ...draft, resolvingSchedule: false, customScheduleError: action.message }
    case 'addUrl':
      return draft.linkedUrlInputs.length >= MAX_CRON_LINKED_URLS
        ? draft
        : { ...draft, linkedUrlInputs: [...draft.linkedUrlInputs, ''] }
    case 'updateUrl':
      return {
        ...draft,
        linkedUrlInputs: draft.linkedUrlInputs.map((value, index) => (
          index === action.index ? action.value : value
        )),
      }
    case 'removeUrl': {
      const next = draft.linkedUrlInputs.filter((_, index) => index !== action.index)
      return { ...draft, linkedUrlInputs: next.length > 0 ? next : [''] }
    }
    case 'reset':
      return createAutomationTaskDraft(action.sessionId, action.workspacePath)
  }
}

export function fileName(path: string): string {
  return path.split('/').filter(Boolean).pop() || path
}

export function formatHour(hour: number): string {
  if (hour < 12) return `上午 ${hour}:00`
  if (hour === 12) return '下午 12:00'
  return `下午 ${hour - 12}:00`
}

function formatClock(hour: number, minute: number): string {
  const suffix = String(minute).padStart(2, '0')
  if (hour < 12) return `上午 ${hour}:${suffix}`
  if (hour === 12) return `下午 12:${suffix}`
  return `下午 ${hour - 12}:${suffix}`
}

export function formatTime(timestamp?: number | null): string {
  if (!timestamp) return '尚未运行'
  return new Date(timestamp).toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function cronToNaturalLanguage(cron: string): string {
  const parts = cron.trim().split(/\s+/)
  if (parts.length !== 5) return cron
  const [minute, hour, dayOfMonth, month, weekday] = parts
  if (minute.startsWith('*/') && hour === '*') return `每 ${minute.slice(2)} 分钟`
  if (minute === '0' && hour.startsWith('*/')) return `每 ${hour.slice(2)} 小时`
  if (minute === '0' && hour === '*') return '每小时'
  const parsedHour = Number.parseInt(hour, 10)
  const parsedMinute = Number.parseInt(minute, 10)
  const time = Number.isNaN(parsedHour) || Number.isNaN(parsedMinute)
    ? cron
    : formatClock(parsedHour, parsedMinute)
  if (dayOfMonth !== '*' && month === '*') return `每月 ${dayOfMonth} 日 ${time}`
  if (weekday === '1-5') return `每个工作日 ${time}`
  if (weekday === '6,0' || weekday === '0,6') return `每个周末 ${time}`
  if (weekday !== '*') {
    const day = weekday
      .split(',')
      .map((value) => WEEKDAYS.find((item) => item.value === Number.parseInt(value, 10))?.label || `周${value}`)
      .join('、')
    return `每${day} ${time}`
  }
  return `每天 ${time}`
}

export function targetLabel(target?: CronTaskTarget | null): string {
  if (!target) return '未关联目标'
  if (target.type === 'session') return target.sessionTitle || target.sessionId || '工作区会话'
  if (target.type === 'workspace') {
    return target.workspaceName || (target.workspacePath ? fileName(target.workspacePath) : '工作区目录')
  }
  if (target.type === 'directory') return target.directoryPath ? fileName(target.directoryPath) : '自选目录'
  return '未关联目标'
}

export function targetDetail(target?: CronTaskTarget | null): string {
  if (!target) return '任务会在默认授权目录中运行'
  if (target.type === 'session') {
    const workspace = target.workspacePath ? ` · ${fileName(target.workspacePath)}` : ''
    return `会话${workspace}`
  }
  if (target.type === 'workspace') return target.workspacePath || '工作区目录'
  if (target.type === 'directory') return target.directoryPath || '自选目录'
  return ''
}

export function runStatusLabel(status: CronTask['lastStatus'] | undefined): string {
  if (status === 'success') return '成功'
  if (status === 'cancelled') return '已停止'
  if (status === 'error') return '失败'
  return '运行中'
}

export function resolvedCustomCron(draft: AutomationTaskDraft): string {
  return draft.customCronSource === draft.customScheduleText.trim() ? draft.customCron : ''
}

export function draftCronExpression(draft: AutomationTaskDraft): string {
  if (draft.frequencyMode === 'daily') return `0 ${draft.hour} * * *`
  if (draft.frequencyMode === 'weekly') return `0 ${draft.hour} * * ${draft.weekday}`
  if (draft.frequencyMode === 'hourly') return '0 * * * *'
  if (draft.frequencyMode === 'thirty') return '*/30 * * * *'
  return resolvedCustomCron(draft).trim()
}

export type AutomationDraftDerived = {
  cronExpression: string
  scheduleLabel: string
  schedulePreviewLabel: string
  linkedUrls: string[]
  linkedUrlError: string | null
  canCreate: boolean
}

export function deriveAutomationTaskDraft(draft: AutomationTaskDraft): AutomationDraftDerived {
  const cronExpression = draftCronExpression(draft)
  const scheduleLabel = cronToNaturalLanguage(cronExpression)
  let linkedUrls: string[] = []
  let linkedUrlError: string | null = null
  try {
    linkedUrls = normalizeCronLinkedUrls(draft.linkedUrlInputs)
  } catch (error) {
    linkedUrlError = error instanceof Error ? error.message : '关联网址格式不正确'
  }
  const schedulePreviewLabel = draft.frequencyMode === 'custom'
    ? resolvedCustomCron(draft)
      ? scheduleLabel
      : draft.customScheduleText.trim()
        ? '等待解析执行频率'
        : '描述执行频率'
    : scheduleLabel
  return {
    cronExpression,
    scheduleLabel,
    schedulePreviewLabel,
    linkedUrls,
    linkedUrlError,
    canCreate: Boolean(
      draft.prompt.trim() &&
      (draft.frequencyMode === 'custom' ? draft.customScheduleText.trim() : cronExpression.trim()) &&
      !linkedUrlError &&
      !draft.resolvingSchedule
    ),
  }
}

export function buildAutomationTarget(
  draft: AutomationTaskDraft,
  sessions: SdkSessionInfo[],
  activeWorkspacePath: string | null,
): CronTaskTarget | null {
  if (draft.targetMode === 'none') return null
  if (draft.targetMode === 'session') {
    const session = sessions.find((item) => item.id === draft.selectedSessionId)
    if (!session) return null
    const workspacePath = session.workspacePath || session.cwd || activeWorkspacePath || null
    return {
      type: 'session',
      sessionId: session.id,
      sessionTitle: session.title || '未命名会话',
      workspacePath,
      workspaceName: workspacePath ? fileName(workspacePath) : null,
    }
  }
  if (draft.targetMode === 'workspace') {
    if (!draft.selectedWorkspacePath) return null
    return {
      type: 'workspace',
      workspacePath: draft.selectedWorkspacePath,
      workspaceName: fileName(draft.selectedWorkspacePath),
    }
  }
  if (!draft.selectedDirectoryPath) return null
  return {
    type: 'directory',
    directoryPath: draft.selectedDirectoryPath,
    workspaceName: fileName(draft.selectedDirectoryPath),
  }
}

export function buildAutomationRegistration(
  draft: AutomationTaskDraft,
  sessions: SdkSessionInfo[],
  activeWorkspacePath: string | null,
  cronExpressionOverride?: string,
): CronTaskRegistration {
  const derived = deriveAutomationTaskDraft(draft)
  if (derived.linkedUrlError) throw new Error(derived.linkedUrlError)
  const cronExpression = (cronExpressionOverride || derived.cronExpression).trim()
  if (!draft.prompt.trim()) throw new Error('请输入任务提示词')
  if (!cronExpression) throw new Error('请设置执行频率')
  return {
    name: draft.name,
    prompt: draft.prompt,
    cronExpression,
    target: buildAutomationTarget(draft, sessions, activeWorkspacePath),
    linkedUrls: derived.linkedUrls,
    allowNetwork: draft.allowNetwork || derived.linkedUrls.length > 0,
    notifyOnCompletion: draft.notifyOnCompletion,
  }
}
