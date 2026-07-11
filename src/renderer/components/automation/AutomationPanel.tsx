import { lazy, Suspense, useCallback, useEffect, useMemo, useReducer, useState } from 'react'
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
  Link2,
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
  X,
  XCircle,
} from 'lucide-react'
import type { SdkSessionInfo } from '../../../shared/types'
import type { CronTask } from '../../lib/ipc'
import { MAX_CRON_LINKED_URLS } from '../../../shared/cron-linked-urls'
import {
  automationTaskDraftReducer,
  buildAutomationRegistration,
  createAutomationTaskDraft,
  cronToNaturalLanguage,
  deriveAutomationTaskDraft,
  fileName,
  formatHour,
  formatTime,
  resolvedCustomCron,
  runStatusLabel,
  targetDetail,
  targetLabel,
  WEEKDAYS,
  type AutomationTaskDraft,
  type FrequencyMode,
  type TargetMode,
} from '../../automation/automation-task-draft'
import './AutomationPanel.css'

const AssistantMarkdown = lazy(() => import('../chat/AssistantMarkdown'))

interface AutomationPanelProps {
  workspacePaths: string[]
  sessions: SdkSessionInfo[]
  activeSessionId: string | null
  activeWorkspacePath: string | null
  focusTaskId?: string | null
  onFocusTaskConsumed?: () => void
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
  const [draft, dispatchDraft] = useReducer(
    automationTaskDraftReducer,
    undefined,
    () => createAutomationTaskDraft(defaultSessionId, defaultWorkspace),
  )
  const setDraftField = useCallback(<K extends keyof AutomationTaskDraft,>(
    field: K,
    value: AutomationTaskDraft[K],
  ) => {
    dispatchDraft({ type: 'set', field, value })
  }, [])
  const {
    name,
    prompt,
    frequencyMode,
    hour,
    weekday,
    customScheduleText,
    customCron,
    customCronSource,
    customScheduleError,
    resolvingSchedule,
    targetMode,
    selectedSessionId,
    selectedWorkspacePath,
    selectedDirectoryPath,
    linkedUrlInputs,
    allowNetwork,
    notifyOnCompletion,
  } = draft
  const derivedDraft = useMemo(() => deriveAutomationTaskDraft(draft), [draft])
  const resolvedCustomCronValue = resolvedCustomCron(draft)
  const {
    cronExpression,
    schedulePreviewLabel,
    canCreate,
  } = derivedDraft
  const linkedUrlValidation = {
    urls: derivedDraft.linkedUrls,
    error: derivedDraft.linkedUrlError,
  }

  useEffect(() => {
    dispatchDraft({
      type: 'syncDefaults',
      sessionId: defaultSessionId,
      workspacePath: defaultWorkspace,
    })
  }, [defaultSessionId, defaultWorkspace])

  useEffect(() => {
    if (!focusTaskId) return
    setShowCreateForm(false)
    setSelectedTaskId(focusTaskId)
    onFocusTaskConsumed?.()
  }, [focusTaskId, onFocusTaskConsumed])

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

  const handleSelectDirectory = useCallback(async () => {
    const result = await window.api.agent.selectFolder()
    if (!result.canceled && result.filePaths[0]) {
      setDraftField('selectedDirectoryPath', result.filePaths[0])
    }
  }, [setDraftField])

  const resolveCustomSchedule = useCallback(async (): Promise<string | null> => {
    const input = customScheduleText.trim()
    if (!input) {
      dispatchDraft({ type: 'scheduleError', message: '请先描述执行频率' })
      return null
    }
    if (customCronSource === input && customCron) return customCron

    dispatchDraft({ type: 'scheduleStart' })
    try {
      const result = await window.api.cron.resolveSchedule({
        input,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        now: Date.now(),
      })
      if (!result.success || !result.cronExpression) {
        throw new Error(result.error || '无法解析执行频率')
      }
      dispatchDraft({ type: 'scheduleResolved', input, cronExpression: result.cronExpression })
      return result.cronExpression
    } catch (err) {
      const message = (err as Error).message || '无法解析执行频率'
      dispatchDraft({ type: 'scheduleError', message })
      return null
    }
  }, [customCron, customCronSource, customScheduleText])

  const handleCreate = useCallback(async () => {
    if (derivedDraft.linkedUrlError) return
    let nextCronExpression = cronExpression.trim()
    if (frequencyMode === 'custom') {
      const resolved = await resolveCustomSchedule()
      if (!resolved) return
      nextCronExpression = resolved
    }
    setCreating(true)
    try {
      const registration = buildAutomationRegistration(
        draft,
        editorSessions,
        activeWorkspacePath,
        nextCronExpression,
      )
      const result = await window.api.cron.register(registration)
      if (!result.success) throw new Error(result.error || '创建自动化失败')
      dispatchDraft({ type: 'reset', sessionId: defaultSessionId, workspacePath: defaultWorkspace })
      await refreshTasks()
      setShowCreateForm(false)
    } catch (err) {
      setError((err as Error).message || '创建自动化失败')
    } finally {
      setCreating(false)
    }
  }, [activeWorkspacePath, cronExpression, defaultSessionId, defaultWorkspace, derivedDraft.linkedUrlError, draft, editorSessions, frequencyMode, refreshTasks, resolveCustomSchedule])

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

  return (
    <div className="automation-panel">
      <header className="automation-hero">
        <div>
          <p>创建周期任务，按需关联会话、工作区、目录或网址，并记录每次运行结果。</p>
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
            <input value={name} onChange={(event) => setDraftField('name', event.target.value)} placeholder="例如：每周整理市场动态" />
          </label>
          <label className="automation-field">
            <span>执行频率</span>
            <select value={frequencyMode} onChange={(event) => setDraftField('frequencyMode', event.target.value as FrequencyMode)}>
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
              <select value={hour} onChange={(event) => setDraftField('hour', Number.parseInt(event.target.value, 10))}>
                {Array.from({ length: 24 }, (_, index) => (
                  <option key={index} value={index}>{formatHour(index)}</option>
                ))}
              </select>
            </label>
          )}

          {frequencyMode === 'weekly' && (
            <label className="automation-field">
              <span>星期</span>
              <select value={weekday} onChange={(event) => setDraftField('weekday', Number.parseInt(event.target.value, 10))}>
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
                    setDraftField('customScheduleText', event.target.value)
                    setDraftField('customScheduleError', null)
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
              ) : resolvedCustomCronValue ? (
                <em className="automation-schedule-result">
                  已解析为 {cronToNaturalLanguage(resolvedCustomCronValue)} · {resolvedCustomCronValue}
                </em>
              ) : (
                <em className="automation-schedule-hint">用自然语言描述重复频率，系统会转换为 Cron。</em>
              )}
            </div>
          )}

          <label className="automation-field">
            <span>关联目标（可选）</span>
            <select value={targetMode} onChange={(event) => setDraftField('targetMode', event.target.value as TargetMode)}>
              <option value="none">不关联</option>
              <option value="session" disabled={editorSessions.length === 0}>工作区会话</option>
              <option value="workspace" disabled={workspacePaths.length === 0}>工作区目录</option>
              <option value="directory">自选目录</option>
            </select>
          </label>

          {targetMode === 'session' && (
            <label className="automation-field automation-field-wide">
              <span>会话</span>
              <select value={selectedSessionId} onChange={(event) => setDraftField('selectedSessionId', event.target.value)}>
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
              <select value={selectedWorkspacePath} onChange={(event) => setDraftField('selectedWorkspacePath', event.target.value)}>
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

          <div className="automation-field automation-field-wide automation-url-field">
            <div className="automation-url-field-head">
              <span>关联网址（可选）</span>
              <button
                className="automation-add-url-button"
                type="button"
                onClick={() => dispatchDraft({ type: 'addUrl' })}
                disabled={linkedUrlInputs.length >= MAX_CRON_LINKED_URLS}
              >
                <Plus size={13} />
                添加网址
                <em>{linkedUrlValidation.urls.length}/{MAX_CRON_LINKED_URLS}</em>
              </button>
            </div>
            <div className="automation-url-list">
              {linkedUrlInputs.map((url, index) => (
                <div className="automation-url-row" key={index}>
                  <Link2 size={15} aria-hidden="true" />
                  <input
                    type="url"
                    inputMode="url"
                    value={url}
                    onChange={(event) => dispatchDraft({ type: 'updateUrl', index, value: event.target.value })}
                    placeholder="https://example.com/report"
                    aria-label={`关联网址 ${index + 1}`}
                    aria-invalid={Boolean(linkedUrlValidation.error)}
                  />
                  {(linkedUrlInputs.length > 1 || url) && (
                    <button
                      className="automation-remove-url-button"
                      type="button"
                      onClick={() => dispatchDraft({ type: 'removeUrl', index })}
                      title={`移除网址 ${index + 1}`}
                      aria-label={`移除网址 ${index + 1}`}
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
              ))}
            </div>
            {linkedUrlValidation.error ? (
              <em className="automation-schedule-error">{linkedUrlValidation.error}</em>
            ) : (
              <em className="automation-schedule-hint">最多 3 个；未填写协议时默认使用 https://。关联网址后会自动允许联网。</em>
            )}
          </div>
        </div>

        <label className="automation-field automation-prompt-field">
          <span>任务提示词</span>
          <textarea
            value={prompt}
            onChange={(event) => setDraftField('prompt', event.target.value)}
            placeholder="例如：阅读关联目录中新增资料，整理三条值得关注的变化，并写入 research-digest.md"
          />
        </label>

        <div className="automation-builder-footer">
          <div className="automation-option-row">
            <button
              className={`automation-toggle ${allowNetwork || linkedUrlValidation.urls.length > 0 ? 'automation-toggle-active' : ''}`}
              onClick={() => setDraftField('allowNetwork', !allowNetwork)}
              type="button"
              disabled={linkedUrlValidation.urls.length > 0}
              title={linkedUrlValidation.urls.length > 0 ? '关联网址需要联网能力' : undefined}
            >
              {allowNetwork || linkedUrlValidation.urls.length > 0 ? <Globe2 size={16} /> : <WifiOff size={16} />}
              {linkedUrlValidation.urls.length > 0 ? '网址需要联网' : allowNetwork ? '允许联网' : '不联网'}
            </button>
            <button
              className={`automation-toggle ${notifyOnCompletion ? 'automation-toggle-active' : ''}`}
              onClick={() => setDraftField('notifyOnCompletion', !notifyOnCompletion)}
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
                  <div><dt>网址</dt><dd>{selectedTask.linkedUrls?.length ? `${selectedTask.linkedUrls.length} 个` : '未关联'}</dd></div>
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

              {selectedTask.linkedUrls && selectedTask.linkedUrls.length > 0 && (
                <section className="automation-detail-card automation-detail-card-wide">
                  <h4>关联网址</h4>
                  <div className="automation-linked-url-list">
                    {selectedTask.linkedUrls.map((url) => (
                      <div className="automation-linked-url" key={url} title={url}>
                        <Link2 size={14} />
                        <span>{url}</span>
                      </div>
                    ))}
                  </div>
                </section>
              )}

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
                    <div><dt>网址</dt><dd>{task.linkedUrls?.length ? `${task.linkedUrls.length} 个` : '未关联'}</dd></div>
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
