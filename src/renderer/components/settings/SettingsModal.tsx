import { useState, useEffect, useCallback } from 'react'
import { X, Sun, Moon, Monitor } from 'lucide-react'

interface SettingsModalProps {
  onClose: () => void
}

function SettingsModal({ onClose }: SettingsModalProps): React.ReactElement {
  const [theme, setTheme] = useState<'light' | 'dark' | 'system'>('system')
  const [profiles, setProfiles] = useState<Array<{
    id: string
    name: string
    apiKey: string
    apiProvider: 'anthropic' | 'bedrock' | 'vertex' | 'azure' | 'custom'
    baseUrl: string
    model: string
  }>>([])
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null)
  const [showProfileForm, setShowProfileForm] = useState(false)
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null)
  const [formName, setFormName] = useState('')
  const [formApiKey, setFormApiKey] = useState('')
  const [formProvider, setFormProvider] = useState<'anthropic' | 'bedrock' | 'vertex' | 'azure' | 'custom'>('anthropic')
  const [formBaseUrl, setFormBaseUrl] = useState('')
  const [formModel, setFormModel] = useState('claude-sonnet-4-6')

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
    // Apply immediately
    let effective: 'light' | 'dark'
    if (newTheme === 'system') {
      effective = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    } else {
      effective = newTheme
    }
    document.documentElement.setAttribute('data-theme', effective)
  }, [])

  const resetForm = useCallback(() => {
    setFormName('')
    setFormApiKey('')
    setFormProvider('anthropic')
    setFormBaseUrl('')
    setFormModel('claude-sonnet-4-6')
    setEditingProfileId(null)
    setShowProfileForm(false)
  }, [])

  const handleSaveProfile = useCallback(async () => {
    if (!formName.trim() || !formApiKey.trim()) return
    if (editingProfileId) {
      await window.api.settings.updateProfile(editingProfileId, {
        name: formName,
        apiKey: formApiKey,
        apiProvider: formProvider,
        baseUrl: formBaseUrl,
        model: formModel
      })
    } else {
      await window.api.settings.addProfile({
        id: `profile-${Date.now()}`,
        name: formName,
        apiKey: formApiKey,
        apiProvider: formProvider,
        baseUrl: formBaseUrl,
        model: formModel
      })
    }
    const settings = await window.api.settings.get()
    setProfiles(settings.profiles)
    resetForm()
  }, [formName, formApiKey, formProvider, formBaseUrl, formModel, editingProfileId, resetForm])

  const handleEditProfile = useCallback((profile: typeof profiles[0]) => {
    setEditingProfileId(profile.id)
    setFormName(profile.name)
    setFormApiKey(profile.apiKey)
    setFormProvider(profile.apiProvider)
    setFormBaseUrl(profile.baseUrl)
    setFormModel(profile.model)
    setShowProfileForm(true)
  }, [])

  const handleDeleteProfile = useCallback(async (id: string) => {
    await window.api.settings.removeProfile(id)
    const settings = await window.api.settings.get()
    setProfiles(settings.profiles)
    setActiveProfileId(settings.activeProfileId)
  }, [])

  const handleSetActive = useCallback(async (id: string) => {
    await window.api.settings.setActiveProfile(id)
    setActiveProfileId(id)
  }, [])

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <h2>设置</h2>
          <button className="settings-close-btn" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="settings-content">
          {/* Appearance */}
          <div className="settings-section">
            <h3>外观</h3>
            <div className="theme-options">
              <button
                className={`theme-option ${theme === 'light' ? 'active' : ''}`}
                onClick={() => handleThemeChange('light')}
              >
                <Sun size={18} />
                <span>浅色</span>
              </button>
              <button
                className={`theme-option ${theme === 'dark' ? 'active' : ''}`}
                onClick={() => handleThemeChange('dark')}
              >
                <Moon size={18} />
                <span>深色</span>
              </button>
              <button
                className={`theme-option ${theme === 'system' ? 'active' : ''}`}
                onClick={() => handleThemeChange('system')}
              >
                <Monitor size={18} />
                <span>跟随系统</span>
              </button>
            </div>
          </div>

          {/* Model Profiles */}
          <div className="settings-section">
            <div className="settings-section-header">
              <h3>模型配置</h3>
              <button
                className="settings-add-btn"
                onClick={() => {
                  resetForm()
                  setShowProfileForm(true)
                }}
              >
                + 添加
              </button>
            </div>

            {profiles.map((profile) => (
              <div
                key={profile.id}
                className={`settings-profile ${activeProfileId === profile.id ? 'active' : ''}`}
              >
                <div className="settings-profile-info">
                  <span className="settings-profile-name">{profile.name}</span>
                  <span className="settings-profile-model">{profile.model}</span>
                </div>
                <div className="settings-profile-actions">
                  {activeProfileId !== profile.id && (
                    <button
                      className="settings-profile-activate"
                      onClick={() => handleSetActive(profile.id)}
                    >
                      激活
                    </button>
                  )}
                  <button
                    className="settings-profile-edit"
                    onClick={() => handleEditProfile(profile)}
                  >
                    编辑
                  </button>
                  <button
                    className="settings-profile-delete"
                    onClick={() => handleDeleteProfile(profile.id)}
                  >
                    删除
                  </button>
                </div>
              </div>
            ))}

            {showProfileForm && (
              <div className="settings-form">
                <input
                  className="settings-input"
                  type="text"
                  placeholder="配置名称"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                />
                <input
                  className="settings-input"
                  type="password"
                  placeholder="API Key"
                  value={formApiKey}
                  onChange={(e) => setFormApiKey(e.target.value)}
                />
                <select
                  className="settings-select"
                  value={formProvider}
                  onChange={(e) => setFormProvider(e.target.value as typeof formProvider)}
                >
                  <option value="anthropic">Anthropic</option>
                  <option value="bedrock">AWS Bedrock</option>
                  <option value="vertex">Google Vertex</option>
                  <option value="azure">Azure</option>
                  <option value="custom">自定义</option>
                </select>
                {formProvider === 'custom' && (
                  <input
                    className="settings-input"
                    type="text"
                    placeholder="Base URL"
                    value={formBaseUrl}
                    onChange={(e) => setFormBaseUrl(e.target.value)}
                  />
                )}
                <input
                  className="settings-input"
                  type="text"
                  placeholder="模型 (e.g. claude-sonnet-4-6)"
                  value={formModel}
                  onChange={(e) => setFormModel(e.target.value)}
                />
                <div className="settings-form-actions">
                  <button className="settings-save-btn" onClick={handleSaveProfile}>
                    保存
                  </button>
                  <button className="settings-cancel-btn" onClick={resetForm}>
                    取消
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default SettingsModal
