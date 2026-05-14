import { useState } from 'react'
import './styles/global.css'
import './styles/layout.css'
import './styles/editor.css'
import './styles/chat.css'
import './styles/settings.css'
import AppShell from './components/layout/AppShell'
import SettingsModal from './components/settings/SettingsModal'

function App(): React.ReactElement {
  const [showSettings, setShowSettings] = useState(false)

  return (
    <>
      <AppShell onOpenSettings={() => setShowSettings(true)} />
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
    </>
  )
}

export default App