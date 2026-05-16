import { useState, useEffect, useCallback, useMemo } from 'react'
import { Clock, Play, Trash2, Plus, X, ChevronRight } from 'lucide-react'
import type { CronTask } from '../../lib/ipc'

interface CronPanelProps {
  collapsed: boolean
  onToggleCollapse: () => void
}

// --- Schedule builder types ---

type PresetKey = 'daily-morning' | 'daily-afternoon' | 'daily-evening' | 'every-30min' | 'every-hour' | 'weekly-mon'

interface PresetOption {
  key: PresetKey
  label: string
  defaultCron: string
  defaultDesc: string
  hasTimePicker: boolean
  period?: 'morning' | 'afternoon' | 'evening'
}

const PRESETS: PresetOption[] = [
  { key: 'daily-morning', label: '每天上午', defaultCron: '0 9 * * *', defaultDesc: '每天上午 9:00', hasTimePicker: true, period: 'morning' },
  { key: 'daily-afternoon', label: '每天下午', defaultCron: '0 14 * * *', defaultDesc: '每天下午 2:00', hasTimePicker: true, period: 'afternoon' },
  { key: 'daily-evening', label: '每天晚上', defaultCron: '0 20 * * *', defaultDesc: '每天晚上 8:00', hasTimePicker: true, period: 'evening' },
  { key: 'every-30min', label: '每30分钟', defaultCron: '*/30 * * * *', defaultDesc: '每30分钟', hasTimePicker: false },
  { key: 'every-hour', label: '每小时', defaultCron: '0 * * * *', defaultDesc: '每小时', hasTimePicker: false },
  { key: 'weekly-mon', label: '每周一早上', defaultCron: '0 9 * * 1', defaultDesc: '每周一上午 9:00', hasTimePicker: true, period: 'morning' },
]

type CustomFrequency = 'daily' | 'weekly' | 'custom-interval'

const WEEKDAY_OPTIONS = [
  { value: 1, label: '周一' },
  { value: 2, label: '周二' },
  { value: 3, label: '周三' },
  { value: 4, label: '周四' },
  { value: 5, label: '周五' },
  { value: 6, label: '周六' },
  { value: 0, label: '周日' },
]

function getHoursForPeriod(period?: 'morning' | 'afternoon' | 'evening'): number[] {
  if (period === 'morning') return [6, 7, 8, 9, 10, 11]
  if (period === 'afternoon') return [12, 13, 14, 15, 16, 17]
  if (period === 'evening') return [18, 19, 20, 21, 22]
  return Array.from({ length: 24 }, (_, i) => i)
}

function formatHour(h: number): string {
  if (h < 12) return `上午 ${h}:00`
  if (h === 12) return `下午 12:00`
  return `下午 ${h - 12}:00`
}

function buildCronFromCustom(freq: CustomFrequency, hour: number, weekday: number, intervalMin: number): string {
  if (freq === 'daily') return `0 ${hour} * * *`
  if (freq === 'weekly') return `0 ${hour} * * ${weekday}`
  return `*/${intervalMin} * * * *`
}

function buildDescFromCustom(freq: CustomFrequency, hour: number, weekday: number, intervalMin: number): string {
  if (freq === 'daily') return `每天 ${formatHour(hour)}`
  if (freq === 'weekly') {
    const day = WEEKDAY_OPTIONS.find(w => w.value === weekday)?.label || '周一'
    return `每${day} ${formatHour(hour)}`
  }
  return `每 ${intervalMin} 分钟`
}

function cronToNaturalLanguage(cron: string): string {
  const parts = cron.trim().split(/\s+/)
  if (parts.length !== 5) return cron

  const [min, hour, , , dow] = parts

  // Every N minutes
  if (min.startsWith('*/') && hour === '*') return `每 ${min.slice(2)} 分钟`
  // Every hour
  if (min === '0' && hour === '*') return '每小时'

  const h = parseInt(hour, 10)
  const timeStr = isNaN(h) ? cron : formatHour(h)

  // Weekly
  if (dow !== '*') {
    const d = parseInt(dow, 10)
    const day = WEEKDAY_OPTIONS.find(w => w.value === d)?.label || `周${dow}`
    return `每${day} ${timeStr}`
  }

  // Daily
  return `每天 ${timeStr}`
}

function CronPanel({ collapsed, onToggleCollapse }: CronPanelProps): React.ReactElement {
  const [tasks, setTasks] = useState<CronTask[]>([])
  const [showForm, setShowForm] = useState(false)
  const [formName, setFormName] = useState('')
  const [formPrompt, setFormPrompt] = useState('')
  const [running, setRunning] = useState<string | null>(null)

  // Schedule builder state
  const [mode, setMode] = useState<'preset' | 'custom'>('preset')
  const [selectedPreset, setSelectedPreset] = useState<PresetKey>('daily-morning')
  const [presetHour, setPresetHour] = useState(9)
  const [customFreq, setCustomFreq] = useState<CustomFrequency>('daily')
  const [customHour, setCustomHour] = useState(9)
  const [customWeekday, setCustomWeekday] = useState(1)
  const [customInterval, setCustomInterval] = useState(30)

  const selectedPresetOption = useMemo(() => PRESETS.find(p => p.key === selectedPreset)!, [selectedPreset])
  const presetHours = useMemo(() => getHoursForPeriod(selectedPresetOption.period), [selectedPresetOption])

  // Reset hour when preset changes
  useEffect(() => {
    const hours = getHoursForPeriod(selectedPresetOption.period)
    if (!hours.includes(presetHour)) setPresetHour(hours[0])
  }, [selectedPresetOption, presetHour])

  const { cronExpression, scheduleDesc } = useMemo(() => {
    let cron: string
    let desc: string
    if (mode === 'preset') {
      if (selectedPresetOption.hasTimePicker) {
        const [min] = selectedPresetOption.defaultCron.split(/\s+/)
        cron = `${min} ${presetHour} * * *${selectedPreset.key === 'weekly-mon' ? ' 1' : ''}`
        desc = selectedPreset.key === 'weekly-mon'
          ? `每周一 ${formatHour(presetHour)}`
          : `每天 ${formatHour(presetHour)}`
      } else {
        cron = selectedPresetOption.defaultCron
        desc = selectedPresetOption.defaultDesc
      }
    } else {
      cron = buildCronFromCustom(customFreq, customHour, customWeekday, customInterval)
      desc = buildDescFromCustom(customFreq, customHour, customWeekday, customInterval)
    }
    return { cronExpression: cron, scheduleDesc: desc }
  }, [mode, selectedPresetOption, presetHour, customFreq, customHour, customWeekday, customInterval])

  const refreshTasks = useCallback(() => {
    window.api.cron.list().then(setTasks).catch(() => setTasks([]))
  }, [])

  useEffect(() => { refreshTasks() }, [refreshTasks])

  useEffect(() => {
    const unsubscribe = window.api.cron.onTaskCompleted(() => { refreshTasks() })
    return unsubscribe
  }, [refreshTasks])

  const handleRegister = useCallback(async () => {
    if (!formPrompt.trim()) return
    await window.api.cron.register(cronExpression, formPrompt, formName || undefined)
    setFormName('')
    setFormPrompt('')
    setShowForm(false)
    refreshTasks()
  }, [cronExpression, formPrompt, formName, refreshTasks])

  const handleRemove = useCallback(async (taskId: string) => {
    await window.api.cron.remove(taskId)
    refreshTasks()
  }, [refreshTasks])

  const handleExecute = useCallback(async (taskId: string) => {
    setRunning(taskId)
    await window.api.cron.execute(taskId)
    setRunning(null)
    refreshTasks()
  }, [refreshTasks])

  if (collapsed) {
    return (
      <div className="cron-collapsed">
        <button className="sidebar-toggle" onClick={onToggleCollapse}>
          <ChevronRight size={16} />
        </button>
      </div>
    )
  }

  return (
    <div className="cron-panel">
      <div className="cron-header">
        <span className="cron-title">
          <Clock size={14} />
          定时任务
        </span>
        <div className="cron-header-actions">
          <button className="cron-action-btn" onClick={() => setShowForm(!showForm)} title="添加任务">
            {showForm ? <X size={14} /> : <Plus size={14} />}
          </button>
          <button className="sidebar-toggle" onClick={onToggleCollapse}>
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      {showForm && (
        <div className="cron-form">
          <input
            className="cron-input"
            type="text"
            placeholder="任务名称（可选）"
            value={formName}
            onChange={(e) => setFormName(e.target.value)}
          />

          {/* Mode tabs */}
          <div className="cron-mode-tabs">
            <button
              className={`cron-mode-tab ${mode === 'preset' ? 'active' : ''}`}
              onClick={() => setMode('preset')}
            >
              预设模板
            </button>
            <button
              className={`cron-mode-tab ${mode === 'custom' ? 'active' : ''}`}
              onClick={() => setMode('custom')}
            >
              自定义
            </button>
          </div>

          {mode === 'preset' ? (
            <>
              {/* Preset grid */}
              <div className="cron-preset-grid">
                {PRESETS.map(p => (
                  <button
                    key={p.key}
                    className={`cron-preset-btn ${selectedPreset === p.key ? 'active' : ''}`}
                    onClick={() => setSelectedPreset(p.key)}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              {/* Time picker for presets that support it */}
              {selectedPresetOption.hasTimePicker && (
                <div className="cron-time-picker">
                  {presetHours.map(h => (
                    <button
                      key={h}
                      className={`cron-time-btn ${presetHour === h ? 'active' : ''}`}
                      onClick={() => setPresetHour(h)}
                    >
                      {formatHour(h)}
                    </button>
                  ))}
                </div>
              )}
            </>
          ) : (
            <>
              {/* Custom frequency */}
              <select
                className="cron-select"
                value={customFreq}
                onChange={(e) => setCustomFreq(e.target.value as CustomFrequency)}
              >
                <option value="daily">每天</option>
                <option value="weekly">每周</option>
                <option value="custom-interval">自定义间隔</option>
              </select>

              {customFreq === 'weekly' && (
                <select
                  className="cron-select"
                  value={customWeekday}
                  onChange={(e) => setCustomWeekday(parseInt(e.target.value, 10))}
                >
                  {WEEKDAY_OPTIONS.map(w => (
                    <option key={w.value} value={w.value}>{w.label}</option>
                  ))}
                </select>
              )}

              {customFreq !== 'custom-interval' ? (
                <select
                  className="cron-select"
                  value={customHour}
                  onChange={(e) => setCustomHour(parseInt(e.target.value, 10))}
                >
                  {Array.from({ length: 24 }, (_, i) => i).map(h => (
                    <option key={h} value={h}>{formatHour(h)}</option>
                  ))}
                </select>
              ) : (
                <div className="cron-interval-row">
                  <span className="cron-interval-label">每</span>
                  <input
                    className="cron-input cron-interval-input"
                    type="number"
                    min={1}
                    max={1440}
                    value={customInterval}
                    onChange={(e) => setCustomInterval(Math.max(1, parseInt(e.target.value, 10) || 1))}
                  />
                  <span className="cron-interval-label">分钟</span>
                </div>
              )}
            </>
          )}

          {/* Natural language preview */}
          <div className="cron-preview">{scheduleDesc} 执行</div>

          <textarea
            className="cron-textarea"
            placeholder="要执行的提示词"
            value={formPrompt}
            onChange={(e) => setFormPrompt(e.target.value)}
          />
          <button
            className="cron-submit-btn"
            onClick={handleRegister}
            disabled={!formPrompt.trim()}
          >
            创建任务
          </button>
        </div>
      )}

      {tasks.length === 0 && !showForm ? (
        <div className="cron-empty">暂无定时任务</div>
      ) : (
        <div className="cron-list">
          {tasks.map((task) => (
            <div key={task.id} className="cron-task">
              <div className="cron-task-header">
                <span className="cron-task-name">{task.name || '未命名任务'}</span>
                <span className="cron-task-schedule">{cronToNaturalLanguage(task.cronExpression)}</span>
              </div>
              <div className="cron-task-prompt">{task.prompt}</div>
              <div className="cron-task-footer">
                <div className="cron-task-meta">
                  {task.lastRunAt
                    ? `上次执行: ${new Date(task.lastRunAt).toLocaleString()}`
                    : '尚未执行'}
                </div>
                <div className="cron-task-actions">
                  <button
                    className="cron-action-btn"
                    onClick={() => handleExecute(task.id)}
                    disabled={running === task.id}
                    title="立即执行"
                  >
                    <Play size={12} />
                  </button>
                  <button
                    className="cron-action-btn cron-action-danger"
                    onClick={() => handleRemove(task.id)}
                    title="删除"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
              {task.lastResult && (
                <div className="cron-task-result">
                  {task.lastResult.substring(0, 150)}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default CronPanel
