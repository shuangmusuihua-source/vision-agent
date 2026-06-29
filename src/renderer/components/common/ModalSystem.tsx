import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'
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

  const close = useCallback(() => {
    setVisible(false)
    setTimeout(() => {
      setModal(EMPTY)
      setDangerInput('')
    }, 200)
  }, [])

  const confirm = useCallback((opts: { title: string; message: string; variant?: ModalVariant; confirmLabel?: string }) => {
    return new Promise<boolean>((resolve) => {
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
  }, [])

  const alert = useCallback((opts: { title: string; message: string }) => {
    return new Promise<void>((resolve) => {
      setModal({
        open: true,
        variant: 'info',
        title: opts.title,
        message: opts.message,
        resolve: () => resolve(),
      })
      requestAnimationFrame(() => setVisible(true))
    })
  }, [])

  const dangerPrompt = useCallback((opts: { title: string; message: string; inputLabel: string; expectedValue: string; confirmLabel?: string }) => {
    return new Promise<boolean>((resolve) => {
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
  }, [])

  const handleConfirm = () => {
    modal.resolve?.(true)
    close()
  }

  const handleCancel = () => {
    modal.resolve?.(false)
    close()
  }

  const canConfirm = modal.variant === 'danger-input'
    ? dangerInput.trim() === modal.dangerInputExpected
    : true

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
          <div className={`modal-window${visible ? ' modal-window-visible' : ''}`} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <div className="modal-icon-row">
              {iconMap[modal.variant]}
              <div className="modal-title">{modal.title}</div>
            </div>
            <div className="modal-body">{modal.message}</div>
            {modal.variant === 'danger-input' && (
              <>
                <div className="modal-hint">{modal.dangerInputLabel}</div>
                <input
                  className="modal-input"
                  placeholder={modal.dangerInputExpected}
                  value={dangerInput}
                  onChange={(e) => setDangerInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && canConfirm) handleConfirm() }}
                  autoFocus
                />
              </>
            )}
            <div className="modal-actions">
              <button className="btn-modal btn-modal-cancel" onClick={handleCancel}>
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
