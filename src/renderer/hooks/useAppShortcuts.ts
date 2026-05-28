import { useEffect } from 'react'

interface UseAppShortcutsOptions {
  setShowSearch: (v: boolean) => void
  setIsChatFirst: React.Dispatch<React.SetStateAction<boolean>>
}

export function useAppShortcuts({ setShowSearch, setIsChatFirst }: UseAppShortcutsOptions) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'f') {
        e.preventDefault()
        setShowSearch(true)
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'r') {
        e.preventDefault()
        setIsChatFirst((v) => !v)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [setShowSearch, setIsChatFirst])
}
