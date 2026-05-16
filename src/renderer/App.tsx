import { useState, useCallback, useEffect } from 'react'
import './styles/global.css'
import './styles/layout.css'
import './styles/editor.css'
import './styles/chat.css'
import './styles/settings.css'
import './styles/graph.css'
import './styles/drawer.css'
import './styles/search.css'
import AppShell from './components/layout/AppShell'
import SettingsModal from './components/settings/SettingsModal'

function applyTheme(theme: 'light' | 'dark' | 'system'): void {
  let effective: 'light' | 'dark'
  if (theme === 'system') {
    effective = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  } else {
    effective = theme
  }
  document.documentElement.setAttribute('data-theme', effective)
}

function App(): React.ReactElement {
  const [showSettings, setShowSettings] = useState(false)
  const [settingsChangeKey, setSettingsChangeKey] = useState(0)

  // Apply theme on mount and when settings change
  useEffect(() => {
    window.api.settings.getTheme().then(applyTheme).catch(() => {})
  }, [settingsChangeKey])

  // Listen for system theme changes when in 'system' mode
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = () => {
      window.api.settings.getTheme().then((theme) => {
        if (theme === 'system') applyTheme('system')
      }).catch(() => {})
    }
    mediaQuery.addEventListener('change', handler)
    return () => mediaQuery.removeEventListener('change', handler)
  }, [settingsChangeKey])

  const handleSettingsClose = useCallback(() => {
    setShowSettings(false)
    setSettingsChangeKey((k) => k + 1)
  }, [])

  return (
    <>
      <AppShell onOpenSettings={() => setShowSettings(true)} settingsChangeKey={settingsChangeKey} />
      {showSettings && <SettingsModal onClose={handleSettingsClose} />}
    </>
  )
}

export default App
