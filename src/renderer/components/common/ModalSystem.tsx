import { createContext, useContext, useState, useCallback, useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Trash2, AlertTriangle, Info, Download } from 'lucide-react'

type ModalVariant = 'confirm' | 'primary' | 'danger' | 'info' | 'danger-input'

interface ModalState {
  open: boolean
  variant: ModalVariant
  title: string
  message: string
  confirmLabel?: string
  dangerInputLabel?: string
  dangerInputExpected?: string
  onConfirm?: () => void
  onCancel?: () => void
  resolve?: (value: boolean) => void
}

interface ModalContextValue {
  confirm: (opts: { title: string; message: string; variant?: ModalVariant; confirmLabel?: string }) => Promise<boolean>
  alert: (opts: { title: string; message: string }) => Promise<void>
  dangerPrompt: (opts: { title: string; message: string; inputLabel: string; expectedValue: string; confirmLabel?: string }) => Promise<boolean>
}

const ModalContext = createContext<ModalContextValue | null>(null)

const EMPTY: ModalState = { open: false, variant: 'confirm', title: '', message: '' }

export function ModalProvider({ children }: { children: ReactNode }) {
  const [modal, setModal] = useState<ModalState>(EMPTY)
  const [dangerInput, setDangerInput] = useState('')
  const [visible, setVisible] = useState(false)
  const dialogRef = useRef<HTMLDivElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const closingRef = useRef(false)

  const rememberFocus = useCallback(() => {
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    closingRef.current = false
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
  }, [])

  const close = useCallback(() => {
    if (closingRef.current) return
    closingRef.current = true
    setVisible(false)
    const returnTarget = returnFocusRef.current
    closeTimerRef.current = setTimeout(() => {
      setModal(EMPTY)
      setDangerInput('')
      closingRef.current = false
      closeTimerRef.current = null
      if (returnTarget?.isConnected) returnTarget.focus()
    }, 200)
  }, [])

  useEffect(() => () => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
  }, [])

  const confirm = useCallback((opts: { title: string; message: string; variant?: ModalVariant; confirmLabel?: string }) => {
    return new Promise<boolean>((resolve) => {
      rememberFocus()
      setModal({
        open: true,
        variant: opts.variant || 'confirm',
        title: opts.title,
        message: opts.message,
        confirmLabel: opts.confirmLabel,
        resolve,
      })
      requestAnimationFrame(() => setVisible(true))
    })
  }, [rememberFocus])

  const alert = useCallback((opts: { title: string; message: string }) => {
    return new Promise<void>((resolve) => {
      rememberFocus()
      setModal({
        open: true,
        variant: 'info',
        title: opts.title,
        message: opts.message,
        resolve: () => resolve(),
      })
      requestAnimationFrame(() => setVisible(true))
    })
  }, [rememberFocus])

  const dangerPrompt = useCallback((opts: { title: string; message: string; inputLabel: string; expectedValue: string; confirmLabel?: string }) => {
    return new Promise<boolean>((resolve) => {
      rememberFocus()
      setModal({
        open: true,
        variant: 'danger-input',
        title: opts.title,
        message: opts.message,
        dangerInputLabel: opts.inputLabel,
        dangerInputExpected: opts.expectedValue,
        confirmLabel: opts.confirmLabel,
        resolve,
      })
      setDangerInput('')
      requestAnimationFrame(() => setVisible(true))
    })
  }, [rememberFocus])

  const handleConfirm = useCallback(() => {
    if (closingRef.current) return
    modal.resolve?.(true)
    close()
  }, [close, modal])

  const handleCancel = useCallback(() => {
    if (closingRef.current) return
    modal.resolve?.(false)
    close()
  }, [close, modal])

  const canConfirm = modal.variant === 'danger-input'
    ? dangerInput.trim() === modal.dangerInputExpected
    : true

  useEffect(() => {
    if (!modal.open || !visible) return
    const dialog = dialogRef.current
    if (!dialog) return

    const focusableSelector = 'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [href], [tabindex]:not([tabindex="-1"])'
    const initialFocus = dialog.querySelector<HTMLElement>('[data-modal-initial-focus]')
      || dialog.querySelector<HTMLElement>(focusableSelector)
      || dialog
    initialFocus.focus()

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        handleCancel()
        return
      }
      if (event.key !== 'Tab') return
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector))
      if (focusable.length === 0) {
        event.preventDefault()
        dialog.focus()
        return
      }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [handleCancel, modal.open, visible])

  const iconMap: Record<ModalVariant, ReactNode> = {
    confirm:    <div className="modal-icon-circle danger"><Trash2 size={16} /></div>,
    primary:    <div className="modal-icon-circle primary"><Download size={16} /></div>,
    danger:     <div className="modal-icon-circle danger"><AlertTriangle size={16} /></div>,
    'danger-input': <div className="modal-icon-circle danger"><AlertTriangle size={16} /></div>,
    info:       <div className="modal-icon-circle info"><Info size={16} /></div>,
  }

  return (
    <ModalContext.Provider value={{ confirm, alert, dangerPrompt }}>
      {children}
      {modal.open && createPortal(
        <div className={`modal-overlay${visible ? ' modal-overlay-visible' : ''}`} onClick={handleCancel}>
          <div
            ref={dialogRef}
            className={`modal-window${visible ? ' modal-window-visible' : ''}`}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="app-modal-title"
            aria-describedby="app-modal-description"
            tabIndex={-1}
          >
            <div className="modal-icon-row">
              {iconMap[modal.variant]}
              <div className="modal-title" id="app-modal-title">{modal.title}</div>
            </div>
            <div className="modal-body" id="app-modal-description">{modal.message}</div>
            {modal.variant === 'danger-input' && (
              <>
                <div className="modal-hint">{modal.dangerInputLabel}</div>
                <input
                  className="modal-input"
                  placeholder={modal.dangerInputExpected}
                  value={dangerInput}
                  aria-label={modal.dangerInputLabel || '确认文本'}
                  data-modal-initial-focus
                  onChange={(e) => setDangerInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && canConfirm) handleConfirm() }}
                />
              </>
            )}
            <div className="modal-actions">
              <button className="btn-modal btn-modal-cancel" onClick={handleCancel} data-modal-initial-focus={modal.variant === 'danger-input' ? undefined : true}>
                {modal.variant === 'info' ? '知道了' : '取消'}
              </button>
              {modal.variant !== 'info' && (
                <button
                  className={`btn-modal ${modal.variant === 'confirm' || modal.variant === 'danger' || modal.variant === 'danger-input' ? 'btn-modal-danger' : 'btn-modal-primary'}`}
                  onClick={handleConfirm}
                  disabled={!canConfirm}
                >
                  {modal.confirmLabel || (modal.variant === 'danger-input' ? '删除' : '确认')}
                </button>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}
    </ModalContext.Provider>
  )
}

export function useModal(): ModalContextValue {
  const ctx = useContext(ModalContext)
  if (!ctx) throw new Error('useModal must be used within ModalProvider')
  return ctx
}
