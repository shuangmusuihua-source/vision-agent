import { useState, useEffect } from 'react'
import { Plus, Trash2, Edit3, Check, X } from 'lucide-react'
import type { ModelProfile, AppSettings } from '../../lib/ipc'

const PROVIDERS = [
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'bedrock', label: 'Amazon Bedrock' },
  { value: 'vertex', label: 'Google Vertex AI' },
  { value: 'azure', label: 'Microsoft Azure' },
  { value: 'custom', label: 'Custom' }
]

const PRESET_MODELS = [
  { value: 'claude-opus-4-20250514', label: 'Claude Opus 4' },
  { value: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4' },
  { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' }
]

interface SettingsModalProps {
  onClose: () => void
}

function SettingsModal({ onClose }: SettingsModalProps): React.ReactElement {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<Partial<ModelProfile>>({})
  const [customModelId, setCustomModelId] = useState('')

  useEffect(() => {
    window.api.settings.get().then(setSettings)
  }, [])

  const refreshSettings = async () => {
    const s = await window.api.settings.get()
    setSettings(s)
  }

  const handleAddProfile = async () => {
    const id = `profile-${Date.now()}`
    const newProfile: ModelProfile = {
      id,
      name: '',
      apiKey: '',
      apiProvider: 'custom',
      baseUrl: '',
      model: ''
    }
    await window.api.settings.addProfile(newProfile)
    await refreshSettings()
    setEditingProfileId(id)
    setEditForm(newProfile)
    setCustomModelId('')
  }

  const handleSaveProfile = async () => {
    if (editingProfileId && editForm) {
      const updates = { ...editForm }
      // If custom model ID was entered, use it
      if (customModelId) {
        updates.model = customModelId
      }
      await window.api.settings.updateProfile(editingProfileId, updates)
      await refreshSettings()
      setEditingProfileId(null)
      setEditForm({})
      setCustomModelId('')
    }
  }

  const handleRemoveProfile = async (id: string) => {
    await window.api.settings.removeProfile(id)
    await refreshSettings()
    if (editingProfileId === id) {
      setEditingProfileId(null)
      setEditForm({})
    }
  }

  const handleSetActiveProfile = async (id: string) => {
    await window.api.settings.setActiveProfile(id)
    await refreshSettings()
  }

  const handleAddDirectory = async () => {
    const dir = await window.api.workspace.openDirectoryDialog()
    if (dir) {
      await window.api.settings.addDirectory(dir)
      await refreshSettings()
    }
  }

  const handleRemoveDirectory = async (dir: string) => {
    await window.api.settings.removeDirectory(dir)
    await refreshSettings()
  }

  const getProfileLabel = (profile: ModelProfile) => {
    const provider = PROVIDERS.find((p) => p.value === profile.apiProvider)?.label
    const model = PRESET_MODELS.find((m) => m.value === profile.model)?.label || profile.model
    return `${provider} / ${model}`
  }

  if (!settings) return <div className="modal-overlay">Loading...</div>

  const isCustomProvider = editForm.apiProvider === 'custom'
  const isPresetModel = PRESET_MODELS.some((m) => m.value === editForm.model)

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Settings</h2>
          <button className="modal-close-btn" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="modal-body">
          {/* --- Model Profiles --- */}
          <div className="settings-section">
            <h3 className="settings-section-title">Model Profiles</h3>

            <div className="profile-list">
              {settings.profiles.map((profile) => (
                <div
                  key={profile.id}
                  className={`profile-card ${profile.id === settings.activeProfileId ? 'profile-active' : ''}`}
                >
                  <div className="profile-card-header">
                    <span className="profile-indicator">
                      {profile.id === settings.activeProfileId ? '●' : '○'}
                    </span>
                    <span className="profile-name">{profile.name || 'Unnamed'}</span>
                    <span className="profile-meta">{getProfileLabel(profile)}</span>
                    <div className="profile-actions">
                      {profile.id !== settings.activeProfileId && (
                        <button
                          className="profile-action-btn"
                          onClick={() => handleSetActiveProfile(profile.id)}
                          title="Set active"
                        >
                          <Check size={14} />
                        </button>
                      )}
                      <button
                        className="profile-action-btn"
                        onClick={() => {
                          setEditingProfileId(profile.id)
                          setEditForm(profile)
                          setCustomModelId(
                            PRESET_MODELS.some((m) => m.value === profile.model) ? '' : profile.model
                          )
                        }}
                        title="Edit"
                      >
                        <Edit3 size={14} />
                      </button>
                      <button
                        className="profile-action-btn profile-action-danger"
                        onClick={() => handleRemoveProfile(profile.id)}
                        title="Delete"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
              <button className="profile-add-btn" onClick={handleAddProfile}>
                <Plus size={14} />
                Add Profile
              </button>
            </div>

            {/* --- Edit Profile Form --- */}
            {editingProfileId && (
              <div className="profile-edit-form">
                <div className="form-field">
                  <label>Name</label>
                  <input
                    type="text"
                    value={editForm.name || ''}
                    onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                    placeholder="e.g. Work Account"
                  />
                </div>
                <div className="form-field">
                  <label>API Provider</label>
                  <select
                    value={editForm.apiProvider || 'custom'}
                    onChange={(e) =>
                      setEditForm({ ...editForm, apiProvider: e.target.value as ModelProfile['apiProvider'] })
                    }
                  >
                    {PROVIDERS.map((p) => (
                      <option key={p.value} value={p.value}>{p.label}</option>
                    ))}
                  </select>
                </div>
                {isCustomProvider && (
                  <div className="form-field">
                    <label>Base URL</label>
                    <input
                      type="text"
                      value={editForm.baseUrl || ''}
                      onChange={(e) => setEditForm({ ...editForm, baseUrl: e.target.value })}
                      placeholder="https://api.example.com/v1"
                    />
                  </div>
                )}
                <div className="form-field">
                  <label>API Key</label>
                  <input
                    type="password"
                    value={editForm.apiKey || ''}
                    onChange={(e) => setEditForm({ ...editForm, apiKey: e.target.value })}
                    placeholder="sk-ant-..."
                  />
                </div>
                <div className="form-field">
                  <label>Model ID</label>
                  <select
                    value={isPresetModel ? editForm.model : '__custom__'}
                    onChange={(e) => {
                      if (e.target.value === '__custom__') {
                        setEditForm({ ...editForm, model: '' })
                        setCustomModelId('')
                      } else {
                        setEditForm({ ...editForm, model: e.target.value })
                        setCustomModelId('')
                      }
                    }}
                  >
                    {PRESET_MODELS.map((m) => (
                      <option key={m.value} value={m.value}>{m.label}</option>
                    ))}
                    <option value="__custom__">Custom...</option>
                  </select>
                  {!isPresetModel && (
                    <input
                      type="text"
                      className="form-field-extra-input"
                      value={customModelId}
                      onChange={(e) => setCustomModelId(e.target.value)}
                      placeholder="Enter custom model ID"
                    />
                  )}
                </div>
                <div className="form-actions">
                  <button className="btn-primary" onClick={handleSaveProfile}>Save</button>
                  <button className="btn-secondary" onClick={() => { setEditingProfileId(null); setEditForm({}); setCustomModelId('') }}>Cancel</button>
                </div>
              </div>
            )}
          </div>

          {/* --- Workspace --- */}
          <div className="settings-section">
            <h3 className="settings-section-title">Workspace</h3>
            <div className="directory-list">
              {settings.authorizedDirectories.map((dir) => (
                <div key={dir} className="directory-entry">
                  <span className="directory-path">{dir}</span>
                  <button
                    className="directory-remove-btn"
                    onClick={() => handleRemoveDirectory(dir)}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
              <button className="directory-add-btn" onClick={handleAddDirectory}>
                <Plus size={14} />
                Add Directory
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default SettingsModal