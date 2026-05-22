import { useState, useEffect, useCallback, useRef } from 'react'
import { Sun, Moon, Desktop, Users, Info, Plus, X, Trash } from '@phosphor-icons/react'
import ReactDOM from 'react-dom'
import { useSettings, getSettingsCache } from '../../store/settings-cache'

interface SettingsModalProps {
  onClose: () => void
}

type SettingsPage = 'appearance' | 'profiles' | 'about'

const PAGES: Array<{ id: SettingsPage; label: string; icon: React.ReactElement }> = [
  { id: 'appearance', label: '外观', icon: <Sun size={16} weight="bold" /> },
  { id: 'profiles', label: '模型配置', icon: <Users size={16} weight="bold" /> },
  { id: 'about', label: '关于', icon: <Info size={16} weight="bold" /> }
]

const MODEL_PRESETS = [
  'claude-sonnet-4-20250514',
  'claude-opus-4-20250514',
  'claude-haiku-4-20250514',
  'deepseek-chat',
  'deepseek-reasoner',
  'mistral-large-latest',
  'gpt-4o',
  'gpt-4.1',
  'o3',
  'o4-mini'
]

const PROVIDER_PRESETS = ['anthropic', 'bedrock', 'vertex', 'azure', 'openai', 'deepseek', 'mistral', 'ollama', 'custom']

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
    const s = getSettingsCache()
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
      // Clear first then set, so shake animation re-triggers each time
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
    const id = `profile-${Date.now()}`
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

  return (
    <div className="settings-overlay app-modal-overlay app-modal-visible" ref={overlayRef} onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="settings-window app-modal app-modal-visible" role="dialog" aria-modal="true" aria-label="Settings" onClick={(e) => e.stopPropagation()}>
        <div className="settings-sidebar">
          {PAGES.map((page) => (
            <button
              key={page.id}
              className={`settings-sidebar-item ${activePage === page.id ? 'active' : ''}`}
              onClick={() => setActivePage(page.id)}
            >
              {page.icon}
              <span>{page.label}</span>
            </button>
          ))}
          <div className="settings-sidebar-spacer" />
          <div className="settings-sidebar-version">Vision Agent v1.0.0</div>
        </div>

        <div className="settings-content">
          <button className="settings-close-btn" onClick={onClose}>
            <X size={16} weight="bold" />
          </button>

          {activePage === 'appearance' && (
            <div className="settings-page">
              <div className="settings-page-title">外观</div>
              <div className="settings-section">
                <div className="settings-section-title">主题</div>
                <div className="theme-options">
                  <button
                    className={`theme-option ${theme === 'light' ? 'active' : ''}`}
                    onClick={() => handleThemeChange('light')}
                  >
                    <Sun size={24} weight="bold" />
                    <span className="theme-option-label">浅色</span>
                  </button>
                  <button
                    className={`theme-option ${theme === 'dark' ? 'active' : ''}`}
                    onClick={() => handleThemeChange('dark')}
                  >
                    <Moon size={24} weight="bold" />
                    <span className="theme-option-label">深色</span>
                  </button>
                  <button
                    className={`theme-option ${theme === 'system' ? 'active' : ''}`}
                    onClick={() => handleThemeChange('system')}
                  >
                    <Desktop size={24} weight="bold" />
                    <span className="theme-option-label">跟随系统</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {activePage === 'profiles' && (
            <div className="settings-page">
              <div className="settings-page-title">模型配置</div>
              {profiles.map((profile) => {
                const isEditing = editingProfileId === profile.id
                return (
                  <div className="settings-section" key={profile.id}>
                    <div className="settings-section-title">
                      {isEditing && isNewProfile ? '新配置' : profile.name}
                    </div>
                    <div className="profile-card">
                      <div className="profile-card-header">
                        <span className={`profile-card-name ${activeProfileId === profile.id ? 'profile-status-active' : 'profile-status-inactive'}`}>
                          {activeProfileId === profile.id ? '● 当前激活' : '○ 未激活'}
                        </span>
                        <div className="profile-card-actions">
                          {activeProfileId !== profile.id && !isNewProfile && (
                            <button className="profile-card-btn" onClick={() => handleSetActive(profile.id)}>激活</button>
                          )}
                          {!isEditing && (
                            <button className="profile-card-btn" onClick={() => startEditing(profile)}>编辑</button>
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
                          }}>删除</button>
                        </div>
                      </div>

                      {isEditing ? (
                        <>
                          <div className={`profile-field ${validationErrors.name ? 'field-error' : ''}`}>
                            <div className="profile-field-label">
                              配置名称 <span className="required-mark">*</span>
                            </div>
                            <input
                              ref={nameInputRef}
                              className="profile-field-input"
                              type="text"
                              placeholder="例如：My Opus"
                              value={editForm.name || ''}
                              onChange={(e) => {
                                setEditForm((f) => ({ ...f, name: e.target.value }))
                                clearFieldError('name')
                              }}
                            />
                            {validationErrors.name && (
                              <div className="field-error-msg">请填写配置名称</div>
                            )}
                          </div>
                          <div className="profile-field">
                            <div className="profile-field-label">API Provider</div>
                            <input
                              className="profile-field-input"
                              type="text"
                              placeholder="anthropic"
                              value={editForm.apiProvider || ''}
                              onChange={(e) => setEditForm((f) => ({ ...f, apiProvider: e.target.value }))}
                            />
                          </div>
                          <div className={`profile-field ${validationErrors.baseUrl ? 'field-error' : ''}`}>
                            <div className="profile-field-label">
                              Base URL <span className="required-mark">*</span>
                            </div>
                            <input
                              className="profile-field-input"
                              type="text"
                              placeholder="https://api.anthropic.com"
                              value={editForm.baseUrl || ''}
                              onChange={(e) => {
                                setEditForm((f) => ({ ...f, baseUrl: e.target.value }))
                                clearFieldError('baseUrl')
                              }}
                            />
                            {validationErrors.baseUrl && (
                              <div className="field-error-msg">请填写 Base URL</div>
                            )}
                          </div>
                          <div className={`profile-field ${validationErrors.apiKey ? 'field-error' : ''}`}>
                            <div className="profile-field-label">
                              API Key <span className="required-mark">*</span>
                            </div>
                            <div className="api-key-row">
                              <input
                                ref={apiKeyInputRef}
                                className="profile-field-input api-key-input"
                                type={showApiKey[profile.id] ? 'text' : 'password'}
                                placeholder="sk-ant-..."
                                value={editForm.apiKey || ''}
                                onChange={(e) => {
                                  setEditForm((f) => ({ ...f, apiKey: e.target.value }))
                                  clearFieldError('apiKey')
                                }}
                              />
                              <button className="api-key-toggle" onClick={() => toggleApiKey(profile.id)}>
                                {showApiKey[profile.id] ? '隐藏' : '显示'}
                              </button>
                            </div>
                            {validationErrors.apiKey && (
                              <div className="field-error-msg">请填写 API Key</div>
                            )}
                          </div>
                          <div className={`profile-field ${validationErrors.model ? 'field-error' : ''}`}>
                            <div className="profile-field-label">
                              模型 <span className="required-mark">*</span>
                            </div>
                            <input
                              className="profile-field-input"
                              type="text"
                              placeholder="claude-sonnet-4-20250514"
                              value={editForm.model || ''}
                              onChange={(e) => {
                                setEditForm((f) => ({ ...f, model: e.target.value }))
                                clearFieldError('model')
                              }}
                            />
                            {validationErrors.model && (
                              <div className="field-error-msg">请填写模型</div>
                            )}
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
                              <span className={`profile-test-result ${connectionTest.status === 'success' ? 'profile-test-success' : 'profile-test-error'}`}>
                                {connectionTest.message}
                              </span>
                            )}
                            <button className="profile-card-btn" onClick={cancelEditing}>取消</button>
                            <button className="profile-card-btn profile-save-btn" onClick={() => saveEditing(profile.id)}>保存</button>
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="profile-field">
                            <div className="profile-field-label">API Provider</div>
                            <div className="profile-field-value">{profile.apiProvider}</div>
                          </div>
                          <div className="profile-field">
                            <div className="profile-field-label">Base URL</div>
                            <div className="profile-field-value">{profile.baseUrl}</div>
                          </div>
                          <div className="profile-field">
                            <div className="profile-field-label">API Key</div>
                            <div className="api-key-row">
                              <span className="profile-field-value api-key-value">
                                {showApiKey[profile.id] ? profile.apiKey : 'sk-ant-••••••••••••••••'}
                              </span>
                              <button className="api-key-toggle" onClick={() => toggleApiKey(profile.id)}>
                                {showApiKey[profile.id] ? '隐藏' : '显示'}
                              </button>
                            </div>
                          </div>
                          <div className="profile-field">
                            <div className="profile-field-label">模型</div>
                            <div className="profile-field-value">{profile.model}</div>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                )
              })}
              <button className="add-profile-btn" onClick={handleAddProfile}>
                <Plus size={16} weight="bold" />
                添加配置
              </button>
            </div>
          )}

          {activePage === 'about' && (
            <div className="settings-page">
              <div className="settings-page-title">关于</div>
              <div className="about-logo">Vision Agent</div>
              <div className="about-version">Version 1.0.0</div>
              <div className="about-desc">
                基于 Claude Agent SDK 的智能编程助手。<br />
                集成文件编辑、代码审查、定时任务等功能。
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default SettingsModal