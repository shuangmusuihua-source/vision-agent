import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft,
  Bell,
  BellOff,
  CalendarClock,
  CheckCircle2,
  Clock3,
  FileClock,
  Folder,
  Globe2,
  Loader2,
  Play,
  Plus,
  Power,
  PowerOff,
  RefreshCw,
  Square,
  Trash2,
  WifiOff,
  Workflow,
  XCircle,
} from 'lucide-react'
import type { SdkSessionInfo } from '../../../shared/types'
import type { CronTask, CronTaskRegistration, CronTaskTarget } from '../../lib/ipc'
import './AutomationPanel.css'

const AssistantMarkdown = lazy(() => import('../chat/AssistantMarkdown'))

type FrequencyMode = 'daily' | 'weekly' | 'hourly' | 'thirty' | 'custom'
type TargetMode = 'none' | 'session' | 'workspace' | 'directory'

interface AutomationPanelProps {
  workspacePaths: string[]
  sessions: SdkSessionInfo[]
  activeSessionId: string | null
  activeWorkspacePath: string | null
  focusTaskId?: string | null
  onFocusTaskConsumed?: () => void
}

const WEEKDAYS = [
  { value: 1, label: '周一' },
  { value: 2, label: '周二' },
  { value: 3, label: '周三' },
  { value: 4, label: '周四' },
  { value: 5, label: '周五' },
  { value: 6, label: '周六' },
  { value: 0, label: '周日' },
]

function fileName(path: string): string {
  return path.split('/').filter(Boolean).pop() || path
}

function formatHour(hour: number): string {
  if (hour < 12) return `上午 ${hour}:00`
  if (hour === 12) return '下午 12:00'
  return `下午 ${hour - 12}:00`
}

function formatClock(hour: number, minute: number): string {
  const suffix = `${String(minute).padStart(2, '0')}`
  if (hour < 12) return `上午 ${hour}:${suffix}`
  if (hour === 12) return `下午 12:${suffix}`
  return `下午 ${hour - 12}:${suffix}`
}

function formatTime(timestamp?: number | null): string {
  if (!timestamp) return '尚未运行'
  return new Date(timestamp).toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function cronToNaturalLanguage(cron: string): string {
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

function buildCron(mode: FrequencyMode, hour: number, weekday: number, customCron: string): string {
  if (mode === 'daily') return `0 ${hour} * * *`
  if (mode === 'weekly') return `0 ${hour} * * ${weekday}`
  if (mode === 'hourly') return '0 * * * *'
  if (mode === 'thirty') return '*/30 * * * *'
  return customCron.trim()
}

function targetLabel(target?: CronTaskTarget | null): string {
  if (!target) return '未关联目标'
  if (target.type === 'session') return target.sessionTitle || target.sessionId || '工作区会话'
  if (target.type === 'workspace') return target.workspaceName || (target.workspacePath ? fileName(target.workspacePath) : '工作区目录')
  if (target.type === 'directory') return target.directoryPath ? fileName(target.directoryPath) : '自选目录'
  return '未关联目标'
}

function targetDetail(target?: CronTaskTarget | null): string {
  if (!target) return '任务会在默认授权目录中运行'
  if (target.type === 'session') {
    const workspace = target.workspacePath ? ` · ${fileName(target.workspacePath)}` : ''
    return `会话${workspace}`
  }
  if (target.type === 'workspace') return target.workspacePath || '工作区目录'
  if (target.type === 'directory') return target.directoryPath || '自选目录'
  return ''
}

function runStatusLabel(status: CronTask['lastStatus'] | undefined): string {
  if (status === 'success') return '成功'
  if (status === 'cancelled') return '已停止'
  if (status === 'error') return '失败'
  return '运行中'
}

function AutomationPanel({
  workspacePaths,
  sessions,
  activeSessionId,
  activeWorkspacePath,
  focusTaskId,
  onFocusTaskConsumed,
}: AutomationPanelProps): React.ReactElement {
  const [tasks, setTasks] = useState<CronTask[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [runningTaskId, setRunningTaskId] = useState<string | null>(null)
  const [stoppingTaskId, setStoppingTaskId] = useState<string | null>(null)
  const [updatingStatusTaskId, setUpdatingStatusTaskId] = useState<string | null>(null)
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [showCreateForm, setShowCreateForm] = useState(false)

  const editorSessions = useMemo(
    () => sessions.filter((session) => session.context !== 'ask'),
    [sessions]
  )

  const defaultSessionId = activeSessionId || editorSessions[0]?.id || ''
  const defaultWorkspace = activeWorkspacePath || workspacePaths[0] || ''

  const [name, setName] = useState('')
  const [prompt, setPrompt] = useState('')
  const [frequencyMode, setFrequencyMode] = useState<FrequencyMode>('daily')
  const [hour, setHour] = useState(9)
  const [weekday, setWeekday] = useState(1)
  const [customScheduleText, setCustomScheduleText] = useState('')
  const [customCron, setCustomCron] = useState('')
  const [customCronSource, setCustomCronSource] = useState('')
  const [customScheduleError, setCustomScheduleError] = useState<string | null>(null)
  const [resolvingSchedule, setResolvingSchedule] = useState(false)
  const [targetMode, setTargetMode] = useState<TargetMode>('none')
  const [selectedSessionId, setSelectedSessionId] = useState(defaultSessionId)
  const [selectedWorkspacePath, setSelectedWorkspacePath] = useState(defaultWorkspace)
  const [selectedDirectoryPath, setSelectedDirectoryPath] = useState('')
  const [allowNetwork, setAllowNetwork] = useState(false)
  const [notifyOnCompletion, setNotifyOnCompletion] = useState(true)

  useEffect(() => {
    if (!selectedSessionId && defaultSessionId) setSelectedSessionId(defaultSessionId)
  }, [defaultSessionId, selectedSessionId])

  useEffect(() => {
    if (!selectedWorkspacePath && defaultWorkspace) setSelectedWorkspacePath(defaultWorkspace)
  }, [defaultWorkspace, selectedWorkspacePath])

  useEffect(() => {
    if (!focusTaskId) return
    setShowCreateForm(false)
    setSelectedTaskId(focusTaskId)
    onFocusTaskConsumed?.()
  }, [focusTaskId, onFocusTaskConsumed])

  const resolvedCustomCron = customCronSource === customScheduleText.trim() ? customCron : ''
  const cronExpression = useMemo(
    () => buildCron(frequencyMode, hour, weekday, resolvedCustomCron),
    [frequencyMode, hour, weekday, resolvedCustomCron]
  )

  const scheduleLabel = useMemo(() => cronToNaturalLanguage(cronExpression), [cronExpression])
  const schedulePreviewLabel = frequencyMode === 'custom'
    ? resolvedCustomCron
      ? scheduleLabel
      : customScheduleText.trim()
        ? '等待解析执行频率'
        : '描述执行频率'
    : scheduleLabel

  const refreshTasks = useCallback(async () => {
    setLoading(true)
    try {
      const next = await window.api.cron.list()
      setTasks(next)
      setError(null)
    } catch (err) {
      setError((err as Error).message || '加载自动化任务失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refreshTasks()
  }, [refreshTasks])

  useEffect(() => {
    return window.api.cron.onTaskCompleted((event) => {
      if (event.task) {
        setTasks((current) => current.map((task) => task.id === event.taskId ? event.task! : task))
      } else {
        void refreshTasks()
      }
    })
  }, [refreshTasks])

  const buildTarget = useCallback((): CronTaskTarget | null => {
    if (targetMode === 'none') return null
    if (targetMode === 'session') {
      const session = editorSessions.find((item) => item.id === selectedSessionId)
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
    if (targetMode === 'workspace') {
      if (!selectedWorkspacePath) return null
      return {
        type: 'workspace',
        workspacePath: selectedWorkspacePath,
        workspaceName: fileName(selectedWorkspacePath),
      }
    }
    if (!selectedDirectoryPath) return null
    return {
      type: 'directory',
      directoryPath: selectedDirectoryPath,
      workspaceName: fileName(selectedDirectoryPath),
    }
  }, [activeWorkspacePath, editorSessions, selectedDirectoryPath, selectedSessionId, selectedWorkspacePath, targetMode])

  const handleSelectDirectory = useCallback(async () => {
    const result = await window.api.agent.selectFolder()
    if (!result.canceled && result.filePaths[0]) {
      setSelectedDirectoryPath(result.filePaths[0])
    }
  }, [])

  const resolveCustomSchedule = useCallback(async (): Promise<string | null> => {
    const input = customScheduleText.trim()
    if (!input) {
      setCustomScheduleError('请先描述执行频率')
      return null
    }
    if (customCronSource === input && customCron) return customCron

    setResolvingSchedule(true)
    setCustomScheduleError(null)
    try {
      const result = await window.api.cron.resolveSchedule({
        input,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        now: Date.now(),
      })
      if (!result.success || !result.cronExpression) {
        throw new Error(result.error || '无法解析执行频率')
      }
      setCustomCron(result.cronExpression)
      setCustomCronSource(input)
      return result.cronExpression
    } catch (err) {
      const message = (err as Error).message || '无法解析执行频率'
      setCustomScheduleError(message)
      return null
    } finally {
      setResolvingSchedule(false)
    }
  }, [customCron, customCronSource, customScheduleText])

  const handleCreate = useCallback(async () => {
    const target = buildTarget()
    let nextCronExpression = cronExpression.trim()
    if (frequencyMode === 'custom') {
      const resolved = await resolveCustomSchedule()
      if (!resolved) return
      nextCronExpression = resolved
    }
    if (!prompt.trim() || !nextCronExpression) return
    setCreating(true)
    try {
      const registration: CronTaskRegistration = {
        name,
        prompt,
        cronExpression: nextCronExpression,
        target,
        allowNetwork,
        notifyOnCompletion,
      }
      const result = await window.api.cron.register(registration)
      if (!result.success) throw new Error(result.error || '创建自动化失败')
      setName('')
      setPrompt('')
      setCustomScheduleText('')
      setCustomCron('')
      setCustomCronSource('')
      setCustomScheduleError(null)
      setAllowNetwork(false)
      setNotifyOnCompletion(true)
      await refreshTasks()
      setShowCreateForm(false)
    } catch (err) {
      setError((err as Error).message || '创建自动化失败')
    } finally {
      setCreating(false)
    }
  }, [allowNetwork, buildTarget, cronExpression, frequencyMode, name, notifyOnCompletion, prompt, refreshTasks, resolveCustomSchedule])

  const handleRun = useCallback(async (taskId: string) => {
    setRunningTaskId(taskId)
    try {
      const result = await window.api.cron.execute(taskId)
      if (!result.success) throw new Error(result.error || '执行自动化失败')
      await refreshTasks()
    } catch (err) {
      setError((err as Error).message || '执行自动化失败')
    } finally {
      setRunningTaskId(null)
    }
  }, [refreshTasks])

  const handleStop = useCallback(async (taskId: string) => {
    setStoppingTaskId(taskId)
    try {
      const result = await window.api.cron.stop(taskId)
      if (!result.success) throw new Error(result.error || '停止自动化失败')
      await refreshTasks()
    } catch (err) {
      setError((err as Error).message || '停止自动化失败')
    } finally {
      setStoppingTaskId(null)
    }
  }, [refreshTasks])

  const handleToggleStatus = useCallback(async (task: CronTask) => {
    const nextStatus: CronTask['status'] = task.status === 'paused' ? 'active' : 'paused'
    setUpdatingStatusTaskId(task.id)
    try {
      const result = await window.api.cron.setStatus(task.id, nextStatus)
      if (!result.success || !result.task) throw new Error(result.error || '更新自动化状态失败')
      setTasks((current) => current.map((item) => item.id === task.id ? result.task! : item))
      setError(null)
    } catch (err) {
      setError((err as Error).message || '更新自动化状态失败')
    } finally {
      setUpdatingStatusTaskId(null)
    }
  }, [])

  const handleRemove = useCallback(async (taskId: string) => {
    const removed = await window.api.cron.remove(taskId)
    if (removed) {
      setTasks((current) => current.filter((task) => task.id !== taskId))
      setSelectedTaskId((current) => current === taskId ? null : current)
    }
  }, [])

  const selectedTask = useMemo(
    () => tasks.find((task) => task.id === selectedTaskId) || null,
    [selectedTaskId, tasks]
  )

  const canCreate = Boolean(
    prompt.trim() &&
    (frequencyMode === 'custom' ? customScheduleText.trim() : cronExpression.trim()) &&
    !resolvingSchedule
  )

  return (
    <div className="automation-panel">
      <header className="automation-hero">
        <div>
          <h1>自动化</h1>
          <p>创建周期任务，按需关联会话、工作区或目录，并记录每次运行结果。</p>
        </div>
        <div className="automation-hero-stats" aria-label="自动化任务统计">
          <span><strong>{tasks.length}</strong> 任务</span>
          <span><strong>{tasks.filter((task) => task.status === 'active').length}</strong> 启用</span>
          <span><strong>{tasks.filter((task) => task.isRunning).length}</strong> 运行</span>
        </div>
      </header>

      {error && <div className="automation-error">{error}</div>}

      {showCreateForm && (
      <section className="automation-builder" aria-label="创建自动化任务">
        <div className="automation-create-top">
          <button className="automation-back-button" onClick={() => setShowCreateForm(false)} type="button">
            <ArrowLeft size={15} />
            返回任务
          </button>
        </div>
        <div className="automation-section-title">
          <CalendarClock size={18} />
          <div>
            <h2>新建自动化</h2>
            <p>设置频率和提示词；关联目标可选。</p>
          </div>
        </div>

        <div className="automation-form-grid">
          <label className="automation-field">
            <span>任务名称</span>
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：每周整理市场动态" />
          </label>
          <label className="automation-field">
            <span>执行频率</span>
            <select value={frequencyMode} onChange={(event) => setFrequencyMode(event.target.value as FrequencyMode)}>
              <option value="daily">每天</option>
              <option value="weekly">每周</option>
              <option value="hourly">每小时</option>
              <option value="thirty">每 30 分钟</option>
              <option value="custom">自然语言自定义</option>
            </select>
          </label>

          {(frequencyMode === 'daily' || frequencyMode === 'weekly') && (
            <label className="automation-field">
              <span>执行时间</span>
              <select value={hour} onChange={(event) => setHour(Number.parseInt(event.target.value, 10))}>
                {Array.from({ length: 24 }, (_, index) => (
                  <option key={index} value={index}>{formatHour(index)}</option>
                ))}
              </select>
            </label>
          )}

          {frequencyMode === 'weekly' && (
            <label className="automation-field">
              <span>星期</span>
              <select value={weekday} onChange={(event) => setWeekday(Number.parseInt(event.target.value, 10))}>
                {WEEKDAYS.map((item) => (
                  <option key={item.value} value={item.value}>{item.label}</option>
                ))}
              </select>
            </label>
          )}

          {frequencyMode === 'custom' && (
            <div className="automation-field automation-field-wide">
              <span>自定义频率</span>
              <div className="automation-schedule-input-row">
                <input
                  value={customScheduleText}
                  onChange={(event) => {
                    setCustomScheduleText(event.target.value)
                    setCustomScheduleError(null)
                  }}
                  placeholder="例如：每个工作日上午九点"
                />
                <button
                  className="automation-resolve-button"
                  onClick={() => void resolveCustomSchedule()}
                  disabled={resolvingSchedule || !customScheduleText.trim()}
                  type="button"
                >
                  {resolvingSchedule ? <Loader2 size={15} className="automation-spin" /> : <RefreshCw size={15} />}
                  解析
                </button>
              </div>
              {customScheduleError ? (
                <em className="automation-schedule-error">{customScheduleError}</em>
              ) : resolvedCustomCron ? (
                <em className="automation-schedule-result">
                  已解析为 {cronToNaturalLanguage(resolvedCustomCron)} · {resolvedCustomCron}
                </em>
              ) : (
                <em className="automation-schedule-hint">用自然语言描述重复频率，系统会转换为 Cron。</em>
              )}
            </div>
          )}

          <label className="automation-field">
            <span>关联目标（可选）</span>
            <select value={targetMode} onChange={(event) => setTargetMode(event.target.value as TargetMode)}>
              <option value="none">不关联</option>
              <option value="session" disabled={editorSessions.length === 0}>工作区会话</option>
              <option value="workspace" disabled={workspacePaths.length === 0}>工作区目录</option>
              <option value="directory">自选目录</option>
            </select>
          </label>

          {targetMode === 'session' && (
            <label className="automation-field automation-field-wide">
              <span>会话</span>
              <select value={selectedSessionId} onChange={(event) => setSelectedSessionId(event.target.value)}>
                {editorSessions.map((session) => (
                  <option key={session.id} value={session.id}>
                    {session.title || '未命名会话'}{session.workspacePath ? ` · ${fileName(session.workspacePath)}` : ''}
                  </option>
                ))}
              </select>
            </label>
          )}

          {targetMode === 'workspace' && (
            <label className="automation-field automation-field-wide">
              <span>工作区</span>
              <select value={selectedWorkspacePath} onChange={(event) => setSelectedWorkspacePath(event.target.value)}>
                {workspacePaths.map((path) => (
                  <option key={path} value={path}>{fileName(path)}</option>
                ))}
              </select>
            </label>
          )}

          {targetMode === 'directory' && (
            <div className="automation-field automation-field-wide">
              <span>目录</span>
              <button className="automation-directory-button" onClick={handleSelectDirectory}>
                <Folder size={16} />
                {selectedDirectoryPath || '选择目录'}
              </button>
            </div>
          )}
        </div>

        <label className="automation-field automation-prompt-field">
          <span>任务提示词</span>
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="例如：阅读关联目录中新增资料，整理三条值得关注的变化，并写入 research-digest.md"
          />
        </label>

        <div className="automation-builder-footer">
          <div className="automation-option-row">
            <button
              className={`automation-toggle ${allowNetwork ? 'automation-toggle-active' : ''}`}
              onClick={() => setAllowNetwork((value) => !value)}
              type="button"
            >
              {allowNetwork ? <Globe2 size={16} /> : <WifiOff size={16} />}
              {allowNetwork ? '允许联网' : '不联网'}
            </button>
            <button
              className={`automation-toggle ${notifyOnCompletion ? 'automation-toggle-active' : ''}`}
              onClick={() => setNotifyOnCompletion((value) => !value)}
              type="button"
            >
              {notifyOnCompletion ? <Bell size={16} /> : <BellOff size={16} />}
              {notifyOnCompletion ? '应用内通知' : '不通知'}
            </button>
            <span className="automation-schedule-preview">
              <Clock3 size={15} />
              {schedulePreviewLabel}
            </span>
          </div>
          <button className="automation-create-button" onClick={handleCreate} disabled={!canCreate || creating}>
            {creating ? <Loader2 size={16} className="automation-spin" /> : <Plus size={16} />}
            创建任务
          </button>
        </div>
      </section>
      )}

      {!showCreateForm && (
      <section className="automation-list-section">
        {!selectedTask && (
          <div className="automation-section-title automation-section-title-inline">
            <FileClock size={18} />
            <div>
              <h2>自动化任务</h2>
              <p>点击任务查看设置和运行结果；新建入口在卡片末尾。</p>
            </div>
            <button className="automation-refresh-button" onClick={() => void refreshTasks()} title="刷新任务" aria-label="刷新任务">
              <RefreshCw size={16} />
            </button>
          </div>
        )}

        {selectedTask ? (
          <div className="automation-detail-view">
            <div className="automation-detail-header">
              <button className="automation-back-button" onClick={() => setSelectedTaskId(null)}>
                <ArrowLeft size={15} />
                返回列表
              </button>
              <div className="automation-detail-title">
                <div className="automation-task-icon">
                  <Workflow size={17} />
                </div>
                <div>
                  <h3>{selectedTask.name}</h3>
                  <span>{cronToNaturalLanguage(selectedTask.cronExpression)}</span>
                </div>
              </div>
              <div className="automation-task-actions">
                <button
                  onClick={() => void handleToggleStatus(selectedTask)}
                  disabled={updatingStatusTaskId === selectedTask.id}
                  title={selectedTask.status === 'paused' ? '启用任务' : '停用任务'}
                  aria-label={selectedTask.status === 'paused' ? '启用任务' : '停用任务'}
                >
                  {updatingStatusTaskId === selectedTask.id
                    ? <Loader2 className="automation-spin" size={15} />
                    : selectedTask.status === 'paused'
                      ? <Power size={15} />
                      : <PowerOff size={15} />}
                </button>
                {selectedTask.isRunning || runningTaskId === selectedTask.id ? (
                  <button
                    className="automation-task-stop-button"
                    onClick={() => void handleStop(selectedTask.id)}
                    disabled={stoppingTaskId === selectedTask.id}
                    title="停止任务"
                    aria-label="停止任务"
                  >
                    {stoppingTaskId === selectedTask.id ? <Loader2 className="automation-spin" size={15} /> : <Square size={14} />}
                  </button>
                ) : (
                  <button onClick={() => void handleRun(selectedTask.id)} title="立即运行" aria-label="立即运行">
                    <Play size={15} />
                  </button>
                )}
                <button onClick={() => void handleRemove(selectedTask.id)} title="删除任务" aria-label="删除任务">
                  <Trash2 size={15} />
                </button>
              </div>
            </div>

            <div className="automation-detail-grid">
              <section className="automation-detail-card">
                <h4>任务设置</h4>
                <dl className="automation-detail-meta">
                  <div><dt>频率</dt><dd>{cronToNaturalLanguage(selectedTask.cronExpression)}</dd></div>
                  <div><dt>Cron</dt><dd>{selectedTask.cronExpression}</dd></div>
                  <div><dt>目标</dt><dd>{targetLabel(selectedTask.target)}</dd></div>
                  <div><dt>位置</dt><dd title={targetDetail(selectedTask.target)}>{targetDetail(selectedTask.target)}</dd></div>
                  <div><dt>联网</dt><dd>{selectedTask.allowNetwork ? '允许' : '不联网'}</dd></div>
                  <div><dt>通知</dt><dd>{selectedTask.notifyOnCompletion === false ? '不通知' : '应用内通知'}</dd></div>
                  <div><dt>创建</dt><dd>{formatTime(selectedTask.createdAt)}</dd></div>
                  <div><dt>状态</dt><dd>{selectedTask.isRunning ? '正在运行' : selectedTask.status === 'paused' ? '已停用' : runStatusLabel(selectedTask.lastStatus)}</dd></div>
                  <div><dt>运行</dt><dd>{selectedTask.runCount || 0} 次</dd></div>
                </dl>
              </section>

              <section className="automation-detail-card">
                <h4>任务提示词</h4>
                <p className="automation-detail-prompt">{selectedTask.prompt}</p>
              </section>

              <section className="automation-detail-card automation-detail-card-wide">
                <h4>运行结果</h4>
                {selectedTask.resultHistory && selectedTask.resultHistory.length > 0 ? (
                  <div className="automation-run-list">
                    {selectedTask.resultHistory.map((run) => (
                      <article key={run.id} className={`automation-run-item automation-run-item-${run.status}`}>
                        <div className="automation-run-head">
                          {run.status === 'error'
                            ? <XCircle size={15} />
                            : run.status === 'cancelled'
                              ? <Square size={13} />
                              : <CheckCircle2 size={15} />}
                          <span>{formatTime(run.finishedAt)}</span>
                          <em>{runStatusLabel(run.status)}</em>
                        </div>
                        <div className="automation-run-markdown message-markdown">
                          <Suspense fallback={<span>{run.result || run.error || '没有返回文本结果。'}</span>}>
                            <AssistantMarkdown text={run.result || run.error || '没有返回文本结果。'} isStreaming={false} />
                          </Suspense>
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className="automation-empty automation-empty-compact">
                    尚无运行结果。可以点击右上角立即运行。
                  </div>
                )}
              </section>
            </div>
          </div>
        ) : loading ? (
          <div className="automation-empty">
            <Loader2 className="automation-spin" size={18} />
            正在加载自动化任务...
          </div>
        ) : (
          <div className="automation-task-grid">
            {tasks.map((task) => {
              const lastRun = task.resultHistory?.[0]
              const isRunning = Boolean(task.isRunning || runningTaskId === task.id)
              const isStopping = stoppingTaskId === task.id
              const isStatusUpdating = updatingStatusTaskId === task.id
              const isPaused = task.status === 'paused'
              const isError = task.lastStatus === 'error'
              return (
                <article
                  key={task.id}
                  className={`automation-task-card${isError ? ' automation-task-card-error' : ''}${isPaused ? ' automation-task-card-paused' : ''}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelectedTaskId(task.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      setSelectedTaskId(task.id)
                    }
                  }}
                >
                  <div className="automation-task-card-header">
                    <div className="automation-task-icon">
                      <Workflow size={16} />
                    </div>
                    <div className="automation-task-title-block">
                      <h3 title={task.name}>{task.name}</h3>
                      <span>{cronToNaturalLanguage(task.cronExpression)}</span>
                    </div>
                    <div className="automation-task-actions">
                      <button
                        onClick={(event) => {
                          event.stopPropagation()
                          void handleToggleStatus(task)
                        }}
                        disabled={isStatusUpdating}
                        title={isPaused ? '启用任务' : '停用任务'}
                        aria-label={isPaused ? '启用任务' : '停用任务'}
                      >
                        {isStatusUpdating
                          ? <Loader2 className="automation-spin" size={15} />
                          : isPaused
                            ? <Power size={15} />
                            : <PowerOff size={15} />}
                      </button>
                      {isRunning ? (
                        <button
                          className="automation-task-stop-button"
                          onClick={(event) => {
                            event.stopPropagation()
                            void handleStop(task.id)
                          }}
                          disabled={isStopping}
                          title="停止任务"
                          aria-label="停止任务"
                        >
                          {isStopping ? <Loader2 className="automation-spin" size={15} /> : <Square size={14} />}
                        </button>
                      ) : (
                        <button
                          onClick={(event) => {
                            event.stopPropagation()
                            void handleRun(task.id)
                          }}
                          title="立即运行"
                          aria-label="立即运行"
                        >
                          <Play size={15} />
                        </button>
                      )}
                      <button
                        onClick={(event) => {
                          event.stopPropagation()
                          void handleRemove(task.id)
                        }}
                        title="删除任务"
                        aria-label="删除任务"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>

                  <dl className="automation-card-meta">
                    <div><dt>目标</dt><dd>{targetLabel(task.target)}</dd></div>
                    <div><dt>配置</dt><dd>{task.allowNetwork ? '联网' : '不联网'} · {task.notifyOnCompletion === false ? '不通知' : '通知'}</dd></div>
                    <div><dt>最近</dt><dd>{isRunning ? '正在运行' : task.lastStatus ? formatTime(task.lastRunAt) : '尚未运行'}</dd></div>
                  </dl>

                  <div className="automation-task-footer">
                    <span>{isPaused ? '已停用' : isRunning ? '正在运行' : lastRun ? `最近${runStatusLabel(lastRun.status)}` : '等待首次运行'}</span>
                    <span>已运行 {task.runCount || 0} 次</span>
                  </div>
                </article>
              )
            })}
            <button
              className={`automation-new-task-card${tasks.length === 0 ? ' automation-new-task-card-empty' : ''}`}
              onClick={() => {
                setSelectedTaskId(null)
                setShowCreateForm(true)
              }}
              type="button"
            >
              <span className="automation-new-task-icon">
                <Plus size={18} />
              </span>
              <span className="automation-new-task-title">新建自动化</span>
              <span className="automation-new-task-copy">
                {tasks.length === 0
                  ? '还没有任务，可以先创建一个周期检查或资料整理任务。'
                  : '添加一个新的周期任务'}
              </span>
            </button>
          </div>
        )}
      </section>
      )}
    </div>
  )
}

export default AutomationPanel
