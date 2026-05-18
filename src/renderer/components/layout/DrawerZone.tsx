import { useState, useEffect, useCallback, useMemo } from 'react'
import { CaretDown, Play, Trash, Plus, X } from '@phosphor-icons/react'
import type { CronTask } from '../../lib/ipc'

// --- Schedule builder types (migrated from CronPanel) ---

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
  if (min.startsWith('*/') && hour === '*') return `每 ${min.slice(2)} 分钟`
  if (min === '0' && hour === '*') return '每小时'
  const h = parseInt(hour, 10)
  const timeStr = isNaN(h) ? cron : formatHour(h)
  if (dow !== '*') {
    const d = parseInt(dow, 10)
    const day = WEEKDAY_OPTIONS.find(w => w.value === d)?.label || `周${dow}`
    return `每${day} ${timeStr}`
  }
  return `每天 ${timeStr}`
}

function DrawerZone(): React.ReactElement {
  const [expanded, setExpanded] = useState(false)
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

  return (
    <div className={`drawer-zone ${expanded ? 'drawer-zone-expanded' : ''}`}>
      <div className="drawer">
        <div className="drawer-lip" onClick={() => setExpanded(!expanded)}>
          <div className={`drawer-lip-icon ${expanded ? 'drawer-lip-icon-active' : ''}`}>
            <CaretDown size={16} weight="bold" className={`drawer-chevron ${expanded ? 'drawer-chevron-up' : ''}`} />
          </div>
        </div>
        <div className="drawer-body">
          <div className="drawer-body-inner">
            <div className="drawer-section-label">定时任务</div>

            {showForm && (
              <div className="drawer-form">
                <input
                  className="drawer-input"
                  type="text"
                  placeholder="任务名称（可选）"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                />

                <div className="drawer-mode-tabs">
                  <button
                    className={`drawer-mode-tab ${mode === 'preset' ? 'active' : ''}`}
                    onClick={() => setMode('preset')}
                  >
                    预设模板
                  </button>
                  <button
                    className={`drawer-mode-tab ${mode === 'custom' ? 'active' : ''}`}
                    onClick={() => setMode('custom')}
                  >
                    自定义
                  </button>
                </div>

                {mode === 'preset' ? (
                  <>
                    <div className="drawer-preset-grid">
                      {PRESETS.map(p => (
                        <button
                          key={p.key}
                          className={`drawer-preset-btn ${selectedPreset === p.key ? 'active' : ''}`}
                          onClick={() => setSelectedPreset(p.key)}
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>
                    {selectedPresetOption.hasTimePicker && (
                      <div className="drawer-time-picker">
                        {presetHours.map(h => (
                          <button
                            key={h}
                            className={`drawer-time-btn ${presetHour === h ? 'active' : ''}`}
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
                    <select
                      className="drawer-select"
                      value={customFreq}
                      onChange={(e) => setCustomFreq(e.target.value as CustomFrequency)}
                    >
                      <option value="daily">每天</option>
                      <option value="weekly">每周</option>
                      <option value="custom-interval">自定义间隔</option>
                    </select>
                    {customFreq === 'weekly' && (
                      <select
                        className="drawer-select"
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
                        className="drawer-select"
                        value={customHour}
                        onChange={(e) => setCustomHour(parseInt(e.target.value, 10))}
                      >
                        {Array.from({ length: 24 }, (_, i) => i).map(h => (
                          <option key={h} value={h}>{formatHour(h)}</option>
                        ))}
                      </select>
                    ) : (
                      <div className="drawer-interval-row">
                        <span className="drawer-interval-label">每</span>
                        <input
                          className="drawer-input drawer-interval-input"
                          type="number"
                          min={1}
                          max={1440}
                          value={customInterval}
                          onChange={(e) => setCustomInterval(Math.max(1, parseInt(e.target.value, 10) || 1))}
                        />
                        <span className="drawer-interval-label">分钟</span>
                      </div>
                    )}
                  </>
                )}

                <div className="drawer-preview">{scheduleDesc} 执行</div>

                <textarea
                  className="drawer-textarea"
                  placeholder="要执行的提示词"
                  value={formPrompt}
                  onChange={(e) => setFormPrompt(e.target.value)}
                />
                <button
                  className="drawer-submit-btn"
                  onClick={handleRegister}
                  disabled={!formPrompt.trim()}
                >
                  创建任务
                </button>
              </div>
            )}

            {!showForm && tasks.length > 0 && (
              <button className="drawer-add-btn" onClick={() => setShowForm(true)}>
                <Plus size={12} weight="bold" />
                新建定时任务
              </button>
            )}

            {tasks.length === 0 && !showForm ? (
              <div className="drawer-empty">
                <button className="drawer-add-btn" onClick={() => setShowForm(true)}>
                  <Plus size={12} weight="bold" />
                  新建定时任务
                </button>
              </div>
            ) : (
              <div className="drawer-task-list">
                {tasks.map((task) => (
                  <div key={task.id} className="drawer-task">
                    <div className="drawer-task-info">
                      <div className="drawer-task-name">{task.name || '未命名任务'}</div>
                      <div className="drawer-task-schedule">{cronToNaturalLanguage(task.cronExpression)}</div>
                    </div>
                    <div className="drawer-task-actions">
                      <button
                        className="drawer-task-action"
                        onClick={() => handleExecute(task.id)}
                        disabled={running === task.id}
                        title="立即执行"
                      >
                        <Play size={12} weight="bold" />
                      </button>
                      <button
                        className="drawer-task-action drawer-task-action-danger"
                        onClick={() => handleRemove(task.id)}
                        title="删除"
                      >
                        <Trash size={12} weight="bold" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {showForm && (
              <button className="drawer-form-close" onClick={() => setShowForm(false)}>
                <X size={12} weight="bold" />
                关闭
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default DrawerZone