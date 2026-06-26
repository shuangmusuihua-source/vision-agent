import { useState, useEffect, useCallback, useRef } from 'react'
import {
  CheckCircle2,
  Cpu,
  Eye,
  EyeOff,
  Info,
  KeyRound,
  Monitor,
  Moon,
  Palette,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Server,
  Sun,
  Trash2,
  Users,
  X,
  Zap
} from 'lucide-react'
import { useSettings, useSettingsStore } from '../../store/settings-cache'
import type { ModelProfile } from '../../lib/ipc'
import { APP_NAME } from '../../../shared/branding'
import appIcon from '../../../../build/icon_preview.png'

interface SettingsModalProps {
  onClose: () => void
}

type SettingsPage = 'appearance' | 'profiles' | 'about'

const PAGES: Array<{ id: SettingsPage; label: string; description: string; icon: React.ReactElement }> = [
  { id: 'appearance', label: '外观', description: '界面主题与显示偏好', icon: <Palette size={16} /> },
  { id: 'profiles', label: '模型配置', description: '管理 Agent 使用的模型连接', icon: <Users size={16} /> },
  { id: 'about', label: '关于', description: '版本与产品信息', icon: <Info size={16} /> }
]

const THEME_OPTIONS: Array<{
  id: 'light' | 'dark' | 'system'
  label: string
  description: string
  icon: React.ReactElement
}> = [
  { id: 'light', label: '浅色', description: '清爽高亮，适合白天工作', icon: <Sun size={18} /> },
  { id: 'dark', label: '深色', description: '低亮度界面，适合夜间专注', icon: <Moon size={18} /> },
  { id: 'system', label: '跟随系统', description: '自动同步 macOS 外观', icon: <Monitor size={18} /> }
]

const NEW_PROFILE: Omit<ModelProfile, 'id'> = {
  name: '',
  apiKey: '',
  apiProvider: '',
  baseUrl: '',
  model: ''
}

function SettingsModal({ onClose }: SettingsModalProps): React.ReactElement {
  const [activePage, setActivePage] = useState<SettingsPage>('appearance')
  const [theme, setTheme] = useState<'light' | 'dark' | 'system' | null>(null)
  const [profiles, setProfiles] = useState<ModelProfile[]>([])
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null)
  const [showApiKey, setShowApiKey] = useState<Record<string, boolean>>({})
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<Partial<ModelProfile>>({})
  const [isNewProfile, setIsNewProfile] = useState(false)
  const [validationErrors, setValidationErrors] = useState<Record<string, boolean>>({})
  const [connectionTest, setConnectionTest] = useState<{ status: 'idle' | 'testing' | 'success' | 'error'; message?: string }>({ status: 'idle' })
  const [updateCheck, setUpdateCheck] = useState<{ status: 'idle' | 'checking' | 'latest' | 'available' | 'skipped' | 'error'; message?: string }>({ status: 'idle' })
  const nameInputRef = useRef<HTMLInputElement>(null)
  const baseUrlInputRef = useRef<HTMLInputElement>(null)
  const apiKeyInputRef = useRef<HTMLInputElement>(null)
  const modelInputRef = useRef<HTMLInputElement>(null)

  const cachedSettings = useSettings()

  useEffect(() => {
    if (cachedSettings) {
      setProfiles(cachedSettings.profiles)
      setActiveProfileId(cachedSettings.activeProfileId)
      setTheme(cachedSettings.theme)
    }
  }, [cachedSettings])

  const handleThemeChange = useCallback(async (newTheme: 'light' | 'dark' | 'system') => {
    setTheme(newTheme)
    await window.api.settings.setTheme(newTheme)
    let effective: 'light' | 'dark'
    if (newTheme === 'system') {
      effective = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    } else {
      effective = newTheme
    }
    document.documentElement.setAttribute('data-theme', effective)
  }, [])

  const handleDeleteProfile = useCallback(async (id: string) => {
    await window.api.settings.removeProfile(id)
    const s = useSettingsStore.getState().settings
    if (s) {
      setProfiles(s.profiles)
      setActiveProfileId(s.activeProfileId)
    }
    if (editingProfileId === id) setEditingProfileId(null)
  }, [editingProfileId])

  const handleSetActive = useCallback(async (id: string) => {
    await window.api.settings.setActiveProfile(id)
    setActiveProfileId(id)
  }, [])

  const startEditing = useCallback((profile: ModelProfile) => {
    setEditingProfileId(profile.id)
    setIsNewProfile(false)
    setEditForm({
      name: profile.name,
      model: profile.model,
      apiProvider: profile.apiProvider,
      apiKey: profile.apiKey,
      baseUrl: profile.baseUrl
    })
    setValidationErrors({})
    setConnectionTest({ status: 'idle' })
  }, [])

  const cancelEditing = useCallback(() => {
    if (isNewProfile) {
      setProfiles((prev) => prev.filter((p) => p.id !== editingProfileId))
    }
    setEditingProfileId(null)
    setIsNewProfile(false)
    setEditForm({})
    setValidationErrors({})
  }, [isNewProfile, editingProfileId])

  const saveEditing = useCallback(async (id: string) => {
    const errors: Record<string, boolean> = {}
    if (!editForm.name?.trim()) errors.name = true
    if (!editForm.baseUrl?.trim()) errors.baseUrl = true
    if (!editForm.apiKey?.trim()) errors.apiKey = true
    if (!editForm.model?.trim()) errors.model = true

    if (Object.keys(errors).length > 0) {
      setValidationErrors({})
      requestAnimationFrame(() => {
        setValidationErrors(errors)
        if (errors.name) nameInputRef.current?.focus()
        else if (errors.baseUrl) baseUrlInputRef.current?.focus()
        else if (errors.apiKey) apiKeyInputRef.current?.focus()
        else if (errors.model) modelInputRef.current?.focus()
      })
      return
    }

    if (isNewProfile) {
      await window.api.settings.addProfile({ id, ...editForm } as ModelProfile)
      if (!activeProfileId) {
        await window.api.settings.setActiveProfile(id)
        setActiveProfileId(id)
      }
    } else {
      await window.api.settings.updateProfile(id, editForm)
    }
    const settings = await window.api.settings.get()
    setProfiles(settings.profiles)
    setEditingProfileId(null)
    setIsNewProfile(false)
    setEditForm({})
    setValidationErrors({})
  }, [editForm, isNewProfile, activeProfileId])

  const handleAddProfile = useCallback(() => {
    const id = `profile-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    const tempProfile: ModelProfile = { id, ...NEW_PROFILE }
    setProfiles((prev) => [...prev, tempProfile])
    setEditingProfileId(id)
    setIsNewProfile(true)
    setEditForm({ ...NEW_PROFILE })
    setValidationErrors({})
  }, [])

  const toggleApiKey = useCallback((id: string) => {
    setShowApiKey((prev) => ({ ...prev, [id]: !prev[id] }))
  }, [])

  const clearFieldError = useCallback((field: string) => {
    setValidationErrors((prev) => {
      if (prev[field]) {
        const next = { ...prev }
        delete next[field]
        return next
      }
      return prev
    })
  }, [])

  const testConnection = useCallback(async () => {
    if (!editForm.baseUrl?.trim() || !editForm.apiKey?.trim() || !editForm.model?.trim()) {
      setConnectionTest({ status: 'error', message: '请先填写 Base URL、API Key 和模型' })
      return
    }
    setConnectionTest({ status: 'testing' })
    try {
      const result = await window.api.settings.testConnection({
        baseUrl: editForm.baseUrl,
        apiKey: editForm.apiKey,
        model: editForm.model
      })
      setConnectionTest({ status: result.success ? 'success' : 'error', message: result.message })
    } catch (err) {
      setConnectionTest({ status: 'error', message: (err as Error).message })
    }
  }, [editForm.baseUrl, editForm.apiKey, editForm.model])

  const handleCheckUpdates = useCallback(async () => {
    setUpdateCheck({ status: 'checking', message: '正在检查更新...' })
    try {
      const result = await window.api.update.checkForUpdates()
      if (result.status === 'available') {
        setUpdateCheck({
          status: 'available',
          message: result.version ? `发现新版本 v${result.version}` : '发现新版本',
        })
      } else if (result.status === 'not-available') {
        setUpdateCheck({
          status: 'latest',
          message: result.version ? `已是最新版本 v${result.version}` : '已是最新版本',
        })
      } else if (result.status === 'skipped') {
        setUpdateCheck({ status: 'skipped', message: result.message })
      } else {
        setUpdateCheck({ status: 'error', message: result.message })
      }
    } catch (err) {
      setUpdateCheck({ status: 'error', message: (err as Error).message })
    }
  }, [])

  const overlayRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  useEffect(() => {
    const el = overlayRef.current
    if (!el) return
    const focusable = el.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    )
    if (focusable.length > 0) focusable[0].focus()

    const handleTab = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !focusable.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault()
          last.focus()
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    el.addEventListener('keydown', handleTab)
    return () => el.removeEventListener('keydown', handleTab)
  }, [])

  const activePageMeta = PAGES.find((page) => page.id === activePage) || PAGES[0]
  const activeProfile = profiles.find((profile) => profile.id === activeProfileId)
  const themeLabel = THEME_OPTIONS.find((option) => option.id === theme)?.label || '未设置'

  return (
    <div className="settings-overlay" ref={overlayRef} onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="settings-window" role="dialog" aria-modal="true" aria-label="设置" onClick={(e) => e.stopPropagation()}>
        <aside className="settings-sidebar" aria-label="设置分类">
          <div className="settings-brand">
            <div className="settings-brand-mark" aria-hidden="true">
              <img src={appIcon} alt="" />
            </div>
            <div className="settings-brand-copy">
              <div className="settings-brand-title">{APP_NAME}</div>
              <div className="settings-brand-subtitle">设置中心</div>
            </div>
          </div>

          <nav className="settings-nav">
            {PAGES.map((page) => (
              <button
                key={page.id}
                className={`settings-sidebar-item ${activePage === page.id ? 'active' : ''}`}
                onClick={() => setActivePage(page.id)}
                aria-current={activePage === page.id ? 'page' : undefined}
              >
                <span className="settings-sidebar-icon">{page.icon}</span>
                <span className="settings-sidebar-copy">
                  <span className="settings-sidebar-label">{page.label}</span>
                  <span className="settings-sidebar-desc">{page.description}</span>
                </span>
              </button>
            ))}
          </nav>

          <div className="settings-sidebar-spacer" />
          <div className="settings-sidebar-summary">
            <div className="settings-summary-label">当前配置</div>
            <div className="settings-summary-value">{activeProfile?.name || '未选择'}</div>
            <div className="settings-summary-meta">{themeLabel}</div>
          </div>
          <div className="settings-sidebar-version">Version 1.3.0</div>
        </aside>

        <section className="settings-content">
          <button className="settings-close-btn" onClick={onClose} aria-label="关闭设置">
            <X size={17} />
          </button>

          <header className="settings-content-header">
            <div>
              <div className="settings-kicker">Settings</div>
              <h2 className="settings-page-title">{activePageMeta.label}</h2>
              <p className="settings-page-subtitle">{activePageMeta.description}</p>
            </div>
          </header>

          {activePage === 'appearance' && (
            <div className="settings-page">
              <section className="settings-hero-card" aria-label="外观概览">
                <div className="settings-hero-icon">
                  <Palette size={20} />
                </div>
                <div>
                  <div className="settings-hero-title">界面外观</div>
                  <div className="settings-hero-desc">主题会立即应用到整个应用窗口，保持编辑区、侧栏和 Agent 面板一致。</div>
                </div>
              </section>

              <section className="settings-card">
                <div className="settings-section-heading">
                  <div>
                    <div className="settings-section-title">主题</div>
                    <div className="settings-section-subtitle">选择你当前工作环境下最舒服的视觉模式</div>
                  </div>
                </div>
                <div className="theme-options" role="radiogroup" aria-label="选择主题">
                  {THEME_OPTIONS.map((option) => (
                    <button
                      key={option.id}
                      className={`theme-option ${theme === option.id ? 'active' : ''}`}
                      onClick={() => handleThemeChange(option.id)}
                      role="radio"
                      aria-checked={theme === option.id}
                    >
                      <span className="theme-option-icon">{option.icon}</span>
                      <span className="theme-option-copy">
                        <span className="theme-option-label">{option.label}</span>
                        <span className="theme-option-desc">{option.description}</span>
                      </span>
                      {theme === option.id && <CheckCircle2 className="theme-option-check" size={17} aria-hidden="true" />}
                    </button>
                  ))}
                </div>
              </section>
            </div>
          )}

          {activePage === 'profiles' && (
            <div className="settings-page">
              <div className="settings-toolbar">
                <div>
                  <div className="settings-section-title">模型连接</div>
                  <div className="settings-section-subtitle">这些配置会被 Agent 请求使用，切换激活项不会改写历史会话。</div>
                </div>
                <button className="add-profile-btn add-profile-btn-compact" onClick={handleAddProfile}>
                  <Plus size={16} />
                  添加配置
                </button>
              </div>

              {profiles.map((profile) => {
                const isEditing = editingProfileId === profile.id
                const fieldId = (field: string) => `profile-${profile.id}-${field}`
                const isActive = activeProfileId === profile.id
                const displayName = (isEditing ? editForm.name : profile.name) || profile.name || '未命名配置'
                const displayModel = (isEditing ? editForm.model : profile.model) || profile.model || '未设置模型'
                const displayProvider = (isEditing ? editForm.apiProvider : profile.apiProvider) || profile.apiProvider || '未填写'
                const displayBaseUrl = (isEditing ? editForm.baseUrl : profile.baseUrl) || profile.baseUrl || '未填写'

                return (
                  <section className={`profile-card ${isEditing ? 'profile-card-editing' : ''}`} key={profile.id}>
                    <div className="profile-card-header">
                      <div className="profile-card-identity">
                        <div className={`profile-card-icon ${isActive ? 'profile-card-icon-active' : ''}`}>
                          <Cpu size={18} />
                        </div>
                        <div className="profile-card-title-block">
                          <div className="profile-card-name">{displayName}</div>
                          <div className="profile-card-model">{displayModel}</div>
                        </div>
                      </div>

                      <div className="profile-card-header-right">
                        <span className={`profile-status-badge ${isActive ? 'profile-status-active' : 'profile-status-inactive'}`}>
                          <span className="profile-status-dot" />
                          {isActive ? '当前激活' : '未激活'}
                        </span>
                        <div className="profile-card-actions">
                          {!isActive && !isNewProfile && (
                            <button className="profile-card-btn profile-card-btn-primary" onClick={() => handleSetActive(profile.id)} title="激活配置" aria-label="激活配置">
                              <Zap size={15} />
                              激活
                            </button>
                          )}
                          {!isEditing && (
                            <button className="profile-card-btn" onClick={() => startEditing(profile)} title="编辑配置" aria-label="编辑配置">
                              <Pencil size={15} />
                              编辑
                            </button>
                          )}
                          <button className="profile-card-btn danger" onClick={() => {
                            if (isNewProfile) {
                              setProfiles((prev) => prev.filter((p) => p.id !== profile.id))
                              setEditingProfileId(null)
                              setIsNewProfile(false)
                              setEditForm({})
                              setValidationErrors({})
                            } else {
                              handleDeleteProfile(profile.id)
                            }
                          }} title="删除配置" aria-label="删除配置">
                            <Trash2 size={15} />
                            删除
                          </button>
                        </div>
                      </div>
                    </div>

                    {isEditing ? (
                      <>
                        <div className="profile-edit-grid">
                          <div className={`profile-field ${validationErrors.name ? 'field-error' : ''}`}>
                            <label className="profile-field-label" htmlFor={fieldId('name')}>
                              配置名称 <span className="required-mark" aria-hidden="true">*</span>
                            </label>
                            <input
                              ref={nameInputRef}
                              id={fieldId('name')}
                              className="profile-field-input"
                              type="text"
                              placeholder="例如：My Opus"
                              value={editForm.name || ''}
                              onChange={(e) => {
                                setEditForm((f) => ({ ...f, name: e.target.value }))
                                clearFieldError('name')
                              }}
                              aria-required="true"
                              aria-invalid={!!validationErrors.name}
                            />
                            {validationErrors.name && (
                              <div className="field-error-msg" role="alert">请填写配置名称</div>
                            )}
                          </div>

                          <div className="profile-field">
                            <label className="profile-field-label" htmlFor={fieldId('apiProvider')}>API Provider</label>
                            <input
                              id={fieldId('apiProvider')}
                              className="profile-field-input"
                              type="text"
                              placeholder="anthropic"
                              value={editForm.apiProvider || ''}
                              onChange={(e) => setEditForm((f) => ({ ...f, apiProvider: e.target.value }))}
                            />
                          </div>

                          <div className={`profile-field profile-field-span-2 ${validationErrors.baseUrl ? 'field-error' : ''}`}>
                            <label className="profile-field-label" htmlFor={fieldId('baseUrl')}>
                              Base URL <span className="required-mark" aria-hidden="true">*</span>
                            </label>
                            <input
                              ref={baseUrlInputRef}
                              id={fieldId('baseUrl')}
                              className="profile-field-input"
                              type="text"
                              placeholder="https://api.anthropic.com"
                              value={editForm.baseUrl || ''}
                              onChange={(e) => {
                                setEditForm((f) => ({ ...f, baseUrl: e.target.value }))
                                clearFieldError('baseUrl')
                              }}
                              aria-required="true"
                              aria-invalid={!!validationErrors.baseUrl}
                            />
                            {validationErrors.baseUrl && (
                              <div className="field-error-msg" role="alert">请填写 Base URL</div>
                            )}
                          </div>

                          <div className={`profile-field profile-field-span-2 ${validationErrors.apiKey ? 'field-error' : ''}`}>
                            <label className="profile-field-label" htmlFor={fieldId('apiKey')}>
                              API Key <span className="required-mark" aria-hidden="true">*</span>
                            </label>
                            <div className="api-key-row">
                              <input
                                ref={apiKeyInputRef}
                                id={fieldId('apiKey')}
                                className="profile-field-input api-key-input"
                                type={showApiKey[profile.id] ? 'text' : 'password'}
                                placeholder="sk-ant-..."
                                value={editForm.apiKey || ''}
                                onChange={(e) => {
                                  setEditForm((f) => ({ ...f, apiKey: e.target.value }))
                                  clearFieldError('apiKey')
                                }}
                                aria-required="true"
                                aria-invalid={!!validationErrors.apiKey}
                              />
                              <button
                                className="api-key-toggle"
                                onClick={() => toggleApiKey(profile.id)}
                                aria-label={showApiKey[profile.id] ? '隐藏 API Key' : '显示 API Key'}
                              >
                                {showApiKey[profile.id] ? <EyeOff size={15} /> : <Eye size={15} />}
                              </button>
                            </div>
                            {validationErrors.apiKey && (
                              <div className="field-error-msg" role="alert">请填写 API Key</div>
                            )}
                          </div>

                          <div className={`profile-field profile-field-span-2 ${validationErrors.model ? 'field-error' : ''}`}>
                            <label className="profile-field-label" htmlFor={fieldId('model')}>
                              模型 <span className="required-mark" aria-hidden="true">*</span>
                            </label>
                            <input
                              ref={modelInputRef}
                              id={fieldId('model')}
                              className="profile-field-input"
                              type="text"
                              placeholder="claude-sonnet-4-20250514"
                              value={editForm.model || ''}
                              onChange={(e) => {
                                setEditForm((f) => ({ ...f, model: e.target.value }))
                                clearFieldError('model')
                              }}
                              aria-required="true"
                              aria-invalid={!!validationErrors.model}
                            />
                            {validationErrors.model && (
                              <div className="field-error-msg" role="alert">请填写模型</div>
                            )}
                          </div>
                        </div>

                        <div className="profile-edit-actions">
                          <button
                            className="profile-card-btn profile-test-btn"
                            onClick={testConnection}
                            disabled={connectionTest.status === 'testing'}
                          >
                            {connectionTest.status === 'testing' ? '测试中...' : '测试连接'}
                          </button>
                          {connectionTest.status !== 'idle' && connectionTest.message && (
                            <span className={`profile-test-result ${connectionTest.status === 'success' ? 'profile-test-success' : 'profile-test-error'}`} role="status">
                              {connectionTest.message}
                            </span>
                          )}
                          <button className="profile-card-btn" onClick={cancelEditing}>取消</button>
                          <button className="profile-card-btn profile-save-btn" onClick={() => saveEditing(profile.id)}>
                            <Save size={15} />
                            保存
                          </button>
                        </div>
                      </>
                    ) : (
                      <div className="profile-detail-grid">
                        <div className="profile-detail-item">
                          <Server size={15} />
                          <div>
                            <div className="profile-field-label">API Provider</div>
                            <div className="profile-field-value">{displayProvider}</div>
                          </div>
                        </div>
                        <div className="profile-detail-item profile-detail-item-wide">
                          <Monitor size={15} />
                          <div>
                            <div className="profile-field-label">Base URL</div>
                            <div className="profile-field-value profile-field-url">{displayBaseUrl}</div>
                          </div>
                        </div>
                        <div className="profile-detail-item profile-detail-item-wide">
                          <KeyRound size={15} />
                          <div>
                            <div className="profile-field-label">API Key</div>
                            <div className="api-key-row">
                              <span className="profile-field-value api-key-value">
                                {showApiKey[profile.id] ? profile.apiKey : 'sk-ant-••••••••••••••••'}
                              </span>
                              <button
                                className="api-key-toggle"
                                onClick={() => toggleApiKey(profile.id)}
                                aria-label={showApiKey[profile.id] ? '隐藏 API Key' : '显示 API Key'}
                              >
                                {showApiKey[profile.id] ? <EyeOff size={15} /> : <Eye size={15} />}
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </section>
                )
              })}

              {profiles.length === 0 && (
                <button className="add-profile-btn add-profile-btn-empty" onClick={handleAddProfile}>
                  <Plus size={18} />
                  添加第一个模型配置
                </button>
              )}
            </div>
          )}

          {activePage === 'about' && (
            <div className="settings-page">
              <section className="about-section">
                <div className="about-logo-mark" aria-hidden="true">
                  <img src={appIcon} alt="" />
                </div>
                <div className="about-logo">{APP_NAME}</div>
                <div className="about-version">Version 1.3.0</div>
                <div className="about-desc">
                  我是 sumi，你的本地智能工作台。你可以按事务建立工作区，在任务会话里和我一起阅读资料、整理思路、沉淀文档，并把成熟内容转成知识和交付物。
                </div>
                <div className="about-update-actions">
                  <button
                    className={`about-update-btn ${updateCheck.status === 'checking' ? 'about-update-btn-checking' : ''}`}
                    onClick={handleCheckUpdates}
                    disabled={updateCheck.status === 'checking'}
                  >
                    <RefreshCw size={15} />
                    {updateCheck.status === 'checking' ? '检查中' : '检查更新'}
                  </button>
                  {updateCheck.status !== 'idle' && updateCheck.message && (
                    <div className={`about-update-status about-update-status-${updateCheck.status}`} role="status">
                      {updateCheck.message}
                    </div>
                  )}
                </div>
                <div className="about-facts">
                  <div className="about-fact">
                    <CheckCircle2 size={16} />
                    本地优先
                  </div>
                  <div className="about-fact">
                    <CheckCircle2 size={16} />
                    多工作区
                  </div>
                  <div className="about-fact">
                    <CheckCircle2 size={16} />
                    Agent 会话
                  </div>
                </div>
              </section>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

export default SettingsModal
