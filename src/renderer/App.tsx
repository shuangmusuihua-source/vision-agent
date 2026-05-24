import { useState, useCallback, useEffect } from 'react'
import { initSettingsCache, updateSettingsCache, useSettings } from './store/settings-cache'
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
import { ErrorBoundary } from './components/common/ErrorBoundary'

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
  const settings = useSettings()

  // Init settings cache and listen for push updates from main process
  useEffect(() => {
    initSettingsCache()
    const unsub = window.api.settings.onChanged((s) => {
      updateSettingsCache(s as unknown as import('./lib/ipc').AppSettings)
    })
    return unsub
  }, [])

  // Apply theme from cached settings
  useEffect(() => {
    if (settings?.theme) applyTheme(settings.theme)
  }, [settings?.theme])

  // Listen for system theme changes when in 'system' mode
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = () => {
      if (settings?.theme === 'system') applyTheme('system')
    }
    mediaQuery.addEventListener('change', handler)
    return () => mediaQuery.removeEventListener('change', handler)
  }, [settings?.theme])

  const handleSettingsClose = useCallback(() => {
    setShowSettings(false)
  }, [])

  return (
    <ErrorBoundary fallback={
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', gap: '0.75rem', color: 'var(--text-secondary)' }}>
        <p style={{ fontSize: '1rem', color: 'var(--text-primary)' }}>应用出错</p>
        <button onClick={() => location.reload()} style={{ padding: '0.5rem 1.5rem', fontSize: '0.875rem', border: '1px solid var(--border)', borderRadius: '6px', background: 'var(--bg-primary)', color: 'var(--text-primary)', cursor: 'pointer' }}>重新加载</button>
      </div>
    }>
      <AppShell onOpenSettings={() => setShowSettings(true)} />
      {showSettings && <SettingsModal onClose={handleSettingsClose} />}
    </ErrorBoundary>
  )
}

export default App
