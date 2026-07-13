import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, Cpu, Eye, Monitor, Moon, Search, Settings, Sun } from 'lucide-react'
import { useSettings } from '../../store/settings-cache'
import assistantLogo from '../../assets/sumi-assistant-bull.svg'

type ThemeMode = 'light' | 'dark' | 'system'

const QUICK_THEME_OPTIONS = [
  { id: 'light' as const, label: '浅色', Icon: Sun },
  { id: 'dark' as const, label: '深色', Icon: Moon },
  { id: 'system' as const, label: '跟随系统', Icon: Monitor },
]

interface SidebarToolDockProps {
  onOpenSettings: () => void
  onOpenSearch: () => void
  onDaydream: (mode: string) => void
}

function SidebarToolDock({
  onOpenSettings,
  onOpenSearch,
  onDaydream,
}: SidebarToolDockProps): React.ReactElement {
  const settings = useSettings()
  const [showDaydreamPicker, setShowDaydreamPicker] = useState(false)
  const [pickerPos, setPickerPos] = useState({ left: 0, top: 0 })
  const daydreamBtnRef = useRef<HTMLButtonElement>(null)
  const [showQuickMenu, setShowQuickMenu] = useState(false)
  const [quickMenuPos, setQuickMenuPos] = useState({ left: 0, bottom: 0 })
  const quickMenuBtnRef = useRef<HTMLButtonElement>(null)
  const profiles = settings?.profiles ?? []
  const activeProfileId = settings?.activeProfileId ?? null
  const activeProfile = profiles.find((profile) => profile.id === activeProfileId) || null
  const currentTheme = settings?.theme ?? 'system'

  const togglePicker = () => {
    if (!showDaydreamPicker && daydreamBtnRef.current) {
      setShowQuickMenu(false)
      const rect = daydreamBtnRef.current.getBoundingClientRect()
      const estimatedPickerHeight = 190
      const shouldOpenAbove = rect.bottom + estimatedPickerHeight > window.innerHeight
      setPickerPos({
        left: Math.max(12, rect.left - 4),
        top: shouldOpenAbove ? Math.max(12, rect.top - estimatedPickerHeight - 8) : rect.bottom + 8,
      })
    }
    setShowDaydreamPicker((visible) => !visible)
  }

  const toggleQuickMenu = () => {
    if (!showQuickMenu && quickMenuBtnRef.current) {
      setShowDaydreamPicker(false)
      const rect = quickMenuBtnRef.current.getBoundingClientRect()
      const menuWidth = 286
      setQuickMenuPos({
        left: Math.max(12, Math.min(window.innerWidth - menuWidth - 12, rect.left - 8)),
        bottom: Math.max(12, window.innerHeight - rect.top + 10),
      })
    }
    setShowQuickMenu((visible) => !visible)
  }

  const handleThemeChange = (theme: ThemeMode) => {
    if (theme === currentTheme) return
    void window.api.settings.setTheme(theme)
  }

  const handleProfileChange = (profileId: string) => {
    if (profileId === activeProfileId) return
    void window.api.settings.setActiveProfile(profileId)
  }

  const handleOpenSettingsFromQuickMenu = () => {
    setShowQuickMenu(false)
    onOpenSettings()
  }

  useEffect(() => {
    if (!showDaydreamPicker) return
    const handler = (event: MouseEvent) => {
      if (daydreamBtnRef.current?.contains(event.target as Node)) return
      const picker = document.querySelector('.daydream-picker')
      if (picker?.contains(event.target as Node)) return
      setShowDaydreamPicker(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showDaydreamPicker])

  useEffect(() => {
    if (!showQuickMenu) return
    const handler = (event: MouseEvent) => {
      if (quickMenuBtnRef.current?.contains(event.target as Node)) return
      const menu = document.querySelector('.sidebar-quick-menu')
      if (menu?.contains(event.target as Node)) return
      setShowQuickMenu(false)
    }
    const keyHandler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setShowQuickMenu(false)
    }
    document.addEventListener('mousedown', handler)
    document.addEventListener('keydown', keyHandler)
    return () => {
      document.removeEventListener('mousedown', handler)
      document.removeEventListener('keydown', keyHandler)
    }
  }, [showQuickMenu])

  return (
    <>
      <div className="sidebar-tool-zone" role="group" aria-label="全局工具">
        <div className="sidebar-tool-dock">
          <button
            ref={quickMenuBtnRef}
            className={`sidebar-app-btn${showQuickMenu ? ' sidebar-app-btn-active' : ''}`}
            onClick={toggleQuickMenu}
            title="工作有问题，Ask sumi"
            aria-label="工作有问题，Ask sumi"
            aria-expanded={showQuickMenu}
          >
            <img src={assistantLogo} alt="" />
          </button>
          <span className="sidebar-tool-separator" aria-hidden="true" />
          <button className="sidebar-icon-btn" onClick={onOpenSearch} title="搜索" aria-label="搜索">
            <Search size={16} />
          </button>
          <button className="sidebar-icon-btn" onClick={onOpenSettings} title="设置" aria-label="设置">
            <Settings size={16} />
          </button>
          <button ref={daydreamBtnRef} className="sidebar-icon-btn" onClick={togglePicker} title="心休模式" aria-label="心休模式">
            <Eye size={16} />
          </button>
        </div>
      </div>
      {showQuickMenu && createPortal(
        <div className="sidebar-quick-menu" style={{ left: quickMenuPos.left, bottom: quickMenuPos.bottom }}>
          <div className="sidebar-quick-menu-head">
            <span className="sidebar-quick-logo" aria-hidden="true">
              <img src={assistantLogo} alt="" />
            </span>
            <span>
              <span className="sidebar-quick-title">工作有问题，Ask sumi</span>
              <span className="sidebar-quick-subtitle">
                {activeProfile ? `当前模型 · ${activeProfile.name}` : '尚未选择模型配置'}
              </span>
            </span>
          </div>

          <div className="sidebar-quick-section">
            <div className="sidebar-quick-section-title">外观</div>
            <div className="sidebar-quick-theme-grid" role="radiogroup" aria-label="切换主题">
              {QUICK_THEME_OPTIONS.map(({ id, label, Icon }) => (
                <button
                  key={id}
                  className={`sidebar-quick-theme-btn${currentTheme === id ? ' sidebar-quick-theme-btn-active' : ''}`}
                  onClick={() => handleThemeChange(id)}
                  role="radio"
                  aria-checked={currentTheme === id}
                >
                  <Icon size={14} />
                  <span>{label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="sidebar-quick-section">
            <div className="sidebar-quick-section-row">
              <div className="sidebar-quick-section-title">模型</div>
              <button className="sidebar-quick-link" onClick={handleOpenSettingsFromQuickMenu}>管理</button>
            </div>
            <div className="sidebar-quick-model-list">
              {profiles.length > 0 ? profiles.map((profile) => {
                const isActive = profile.id === activeProfileId
                return (
                  <button
                    key={profile.id}
                    className={`sidebar-quick-model-row${isActive ? ' sidebar-quick-model-row-active' : ''}`}
                    onClick={() => handleProfileChange(profile.id)}
                  >
                    <span className="sidebar-quick-model-icon" aria-hidden="true"><Cpu size={14} /></span>
                    <span className="sidebar-quick-model-copy">
                      <span className="sidebar-quick-model-name">{profile.name || '未命名配置'}</span>
                      <span className="sidebar-quick-model-meta">{profile.model || profile.apiProvider || '未设置模型'}</span>
                    </span>
                    {isActive && <Check size={15} className="sidebar-quick-check" aria-hidden="true" />}
                  </button>
                )
              }) : (
                <button className="sidebar-quick-empty" onClick={handleOpenSettingsFromQuickMenu}>
                  添加模型配置
                </button>
              )}
            </div>
          </div>
        </div>,
        document.body,
      )}
      {showDaydreamPicker && createPortal(
        <div className="daydream-picker" style={{ left: pickerPos.left, top: pickerPos.top }}>
          <div className="daydream-picker-title">心休模式</div>
          <button className="daydream-picker-item" onClick={() => { onDaydream('matrix'); setShowDaydreamPicker(false) }}>
            <span className="daydream-picker-preview matrix-preview" />
            <span>数字矩阵</span>
          </button>
          <button className="daydream-picker-item" onClick={() => { onDaydream('starfield'); setShowDaydreamPicker(false) }}>
            <span className="daydream-picker-preview starfield-preview" />
            <span>星空夜语</span>
          </button>
          <button className="daydream-picker-item" onClick={() => { onDaydream('math'); setShowDaydreamPicker(false) }}>
            <span className="daydream-picker-preview math-preview" />
            <span>数理幻境</span>
          </button>
          <button className="daydream-picker-item" onClick={() => { onDaydream('rain'); setShowDaydreamPicker(false) }}>
            <span className="daydream-picker-preview rain-preview" />
            <span>绿野甘霖</span>
          </button>
        </div>,
        document.body,
      )}
    </>
  )
}

export default SidebarToolDock
