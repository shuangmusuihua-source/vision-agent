import { useState, useEffect, useCallback } from 'react'
import { Sun, Moon, Monitor, Users, Info, Plus, Trash2, X } from 'lucide-react'

interface SettingsModalProps {
  onClose: () => void
}

type SettingsPage = 'appearance' | 'profiles' | 'about'

const PAGES: Array<{ id: SettingsPage; label: string; icon: React.ReactElement }> = [
  { id: 'appearance', label: '外观', icon: <Sun size={16} /> },
  { id: 'profiles', label: '模型配置', icon: <Users size={16} /> },
  { id: 'about', label: '关于', icon: <Info size={16} /> }
]

const MODEL_OPTIONS = [
  'claude-sonnet-4-20250514',
  'claude-opus-4-20250514',
  'claude-haiku-4-20250514'
]

const PROVIDER_OPTIONS: Array<{ value: ModelProfile['apiProvider']; label: string }> = [
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'bedrock', label: 'AWS Bedrock' },
  { value: 'vertex', label: 'Google Vertex' },
  { value: 'azure', label: 'Azure' },
  { value: 'custom', label: 'Custom' }
]

function SettingsModal({ onClose }: SettingsModalProps): React.ReactElement {
  const [activePage, setActivePage] = useState<SettingsPage>('appearance')
  const [theme, setTheme] = useState<'light' | 'dark' | 'system'>('system')
  const [profiles, setProfiles] = useState<ModelProfile[]>([])
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null)
  const [showApiKey, setShowApiKey] = useState<Record<string, boolean>>({})
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<Partial<ModelProfile>>({})

  useEffect(() => {
    window.api.settings.get().then((settings) => {
      setProfiles(settings.profiles)
      setActiveProfileId(settings.activeProfileId)
      setTheme(settings.theme)
    })
  }, [])

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
    const settings = await window.api.settings.get()
    setProfiles(settings.profiles)
    setActiveProfileId(settings.activeProfileId)
    if (editingProfileId === id) setEditingProfileId(null)
  }, [editingProfileId])

  const handleSetActive = useCallback(async (id: string) => {
    await window.api.settings.setActiveProfile(id)
    setActiveProfileId(id)
  }, [])

  const startEditing = useCallback((profile: ModelProfile) => {
    setEditingProfileId(profile.id)
    setEditForm({
      name: profile.name,
      model: profile.model,
      apiProvider: profile.apiProvider,
      apiKey: profile.apiKey,
      baseUrl: profile.baseUrl
    })
  }, [])

  const cancelEditing = useCallback(() => {
    setEditingProfileId(null)
    setEditForm({})
  }, [])

  const saveEditing = useCallback(async (id: string) => {
    await window.api.settings.updateProfile(id, editForm)
    const settings = await window.api.settings.get()
    setProfiles(settings.profiles)
    setEditingProfileId(null)
    setEditForm({})
  }, [editForm])

  const toggleApiKey = useCallback((id: string) => {
    setShowApiKey((prev) => ({ ...prev, [id]: !prev[id] }))
  }, [])

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-window" onClick={(e) => e.stopPropagation()}>
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
            <X size={16} />
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
                    <Sun size={24} />
                    <span className="theme-option-label">浅色</span>
                  </button>
                  <button
                    className={`theme-option ${theme === 'dark' ? 'active' : ''}`}
                    onClick={() => handleThemeChange('dark')}
                  >
                    <Moon size={24} />
                    <span className="theme-option-label">深色</span>
                  </button>
                  <button
                    className={`theme-option ${theme === 'system' ? 'active' : ''}`}
                    onClick={() => handleThemeChange('system')}
                  >
                    <Monitor size={24} />
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
                    <div className="settings-section-title">{profile.name}</div>
                    <div className="profile-card">
                      <div className="profile-card-header">
                        <span className="profile-card-name">
                          {activeProfileId === profile.id ? '● 当前激活' : '○ 未激活'}
                        </span>
                        <div className="profile-card-actions">
                          {activeProfileId !== profile.id && (
                            <button className="profile-card-btn" onClick={() => handleSetActive(profile.id)}>激活</button>
                          )}
                          {!isEditing && (
                            <button className="profile-card-btn" onClick={() => startEditing(profile)}>编辑</button>
                          )}
                          <button className="profile-card-btn danger" onClick={() => handleDeleteProfile(profile.id)}>删除</button>
                        </div>
                      </div>

                      {isEditing ? (
                        <>
                          <div className="profile-field">
                            <div className="profile-field-label">配置名称</div>
                            <input
                              className="profile-field-input"
                              type="text"
                              value={editForm.name || ''}
                              onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                            />
                          </div>
                          <div className="profile-field">
                            <div className="profile-field-label">模型</div>
                            <select
                              className="profile-field-select"
                              value={editForm.model || ''}
                              onChange={(e) => setEditForm((f) => ({ ...f, model: e.target.value }))}
                            >
                              {MODEL_OPTIONS.map((m) => (
                                <option key={m} value={m}>{m}</option>
                              ))}
                            </select>
                          </div>
                          <div className="profile-field">
                            <div className="profile-field-label">API Provider</div>
                            <select
                              className="profile-field-select"
                              value={editForm.apiProvider || 'anthropic'}
                              onChange={(e) => setEditForm((f) => ({ ...f, apiProvider: e.target.value as ModelProfile['apiProvider'] }))}
                            >
                              {PROVIDER_OPTIONS.map((p) => (
                                <option key={p.value} value={p.value}>{p.label}</option>
                              ))}
                            </select>
                          </div>
                          <div className="profile-field">
                            <div className="profile-field-label">API Key</div>
                            <div className="api-key-row">
                              <input
                                className="profile-field-input api-key-input"
                                type={showApiKey[profile.id] ? 'text' : 'password'}
                                value={editForm.apiKey || ''}
                                onChange={(e) => setEditForm((f) => ({ ...f, apiKey: e.target.value }))}
                              />
                              <button className="api-key-toggle" onClick={() => toggleApiKey(profile.id)}>
                                {showApiKey[profile.id] ? '隐藏' : '显示'}
                              </button>
                            </div>
                          </div>
                          <div className="profile-field">
                            <div className="profile-field-label">Base URL</div>
                            <input
                              className="profile-field-input"
                              type="text"
                              placeholder="https://api.anthropic.com"
                              value={editForm.baseUrl || ''}
                              onChange={(e) => setEditForm((f) => ({ ...f, baseUrl: e.target.value }))}
                            />
                          </div>
                          <div className="profile-edit-actions">
                            <button className="profile-card-btn" onClick={cancelEditing}>取消</button>
                            <button className="profile-card-btn profile-save-btn" onClick={() => saveEditing(profile.id)}>保存</button>
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="profile-field">
                            <div className="profile-field-label">模型</div>
                            <div className="profile-field-value">{profile.model}</div>
                          </div>
                          <div className="profile-field">
                            <div className="profile-field-label">API Provider</div>
                            <div className="profile-field-value">{profile.apiProvider}</div>
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
                          {profile.baseUrl && (
                            <div className="profile-field">
                              <div className="profile-field-label">Base URL</div>
                              <div className="profile-field-value">{profile.baseUrl}</div>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                )
              })}
              <button className="add-profile-btn" onClick={() => setActivePage('profiles')}>
                <Plus size={16} />
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