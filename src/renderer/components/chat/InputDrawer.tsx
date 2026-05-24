import { useEffect, useState } from 'react'

interface InputDrawerProps {
  open: boolean
  onClose: () => void
  children: React.ReactNode
}

export function InputDrawer({ open, onClose, children }: InputDrawerProps) {
  const [visible, setVisible] = useState(false)
  const [rendered, setRendered] = useState(open)

  useEffect(() => {
    if (open) {
      setRendered(true)
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setVisible(true))
      })
    } else if (rendered) {
      setVisible(false)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  const handleTransitionEnd = () => {
    if (!visible) {
      setRendered(false)
      onClose()
    }
  }

  if (!rendered) return null

  return (
    <div
      className={`input-drawer ${visible ? 'input-drawer--open' : ''}`}
      onTransitionEnd={handleTransitionEnd}
      role="dialog"
      aria-modal="true"
      aria-label="Agent 提问"
    >
      <div className="input-drawer__content">
        {children}
      </div>
    </div>
  )
}
