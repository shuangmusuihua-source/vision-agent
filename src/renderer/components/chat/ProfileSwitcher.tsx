import { useState, useEffect, useRef, useCallback } from 'react'
import { CaretDown, Plus } from '@phosphor-icons/react'
import type { ModelProfile, AppSettings } from '../../lib/ipc'
import { useSettings } from '../../store/settings-cache'

const MODELS: Record<string, string> = {
  'claude-opus-4-20250514': 'Opus 4',
  'claude-sonnet-4-20250514': 'Sonnet 4',
  'claude-haiku-4-5-20251001': 'Haiku 4.5'
}

interface ProfileSwitcherProps {
  onOpenSettings: () => void
}

function ProfileSwitcher({ onOpenSettings }: ProfileSwitcherProps): React.ReactElement {
  const settings = useSettings()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const handleSelect = async (id: string) => {
    await window.api.settings.setActiveProfile(id)
    setOpen(false)
  }

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const activeProfile = settings?.profiles.find((p) => p.id === settings.activeProfileId)

  return (
    <div className="profile-switcher" ref={ref}>
      <button className="profile-switcher-btn" onClick={() => setOpen(!open)}>
        <span className="profile-switcher-label">
          {activeProfile ? (activeProfile.name || 'Unnamed') : 'No Profile'}
        </span>
        {activeProfile && (
          <span className="profile-switcher-model">
            {MODELS[activeProfile.model] || activeProfile.model}
          </span>
        )}
        <CaretDown size={14} weight="bold" />
      </button>

      {open && (
        <div className="profile-switcher-dropdown">
          {settings?.profiles.map((profile) => (
            <button
              key={profile.id}
              className={`profile-switcher-option ${profile.id === settings.activeProfileId ? 'active' : ''}`}
              onClick={() => handleSelect(profile.id)}
            >
              <span className="profile-switcher-option-indicator">
                {profile.id === settings.activeProfileId ? '●' : '○'}
              </span>
              <span className="profile-switcher-option-name">{profile.name || 'Unnamed'}</span>
              <span className="profile-switcher-option-model">
                {MODELS[profile.model] || profile.model}
              </span>
            </button>
          ))}
          <button
            className="profile-switcher-option profile-switcher-add"
            onClick={() => {
              setOpen(false)
              onOpenSettings()
            }}
          >
            <Plus size={14} weight="bold" />
            <span>Add Profile</span>
          </button>
        </div>
      )}
    </div>
  )
}

export default ProfileSwitcher