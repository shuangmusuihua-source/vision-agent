import { DOCUMENTS_DIR_NAME } from '../../../shared/branding'
import type { WorkspaceDialogsController } from '../../hooks/useWorkspace'
import { useModal } from '../common/ModalSystem'

interface WorkspaceDialogsProps {
  controller: WorkspaceDialogsController
  onDeleted: (path: string) => void
}

function trapFocus(event: React.KeyboardEvent<HTMLDivElement>): void {
  if (event.key !== 'Tab') return
  const focusable = event.currentTarget.querySelectorAll<HTMLElement>('input, button:not([disabled])')
  if (!focusable.length) return
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}

function WorkspaceDialogs({ controller, onDeleted }: WorkspaceDialogsProps): React.ReactElement {
  const modal = useModal()
  const create = controller.create
  const remove = controller.remove
  const workspaceName = remove.path?.split('/').pop() || ''
  const canDelete = !!remove.path && remove.confirmation === workspaceName

  const handleDelete = async () => {
    const deletingPath = remove.path
    if (!deletingPath || !canDelete) return
    const result = await remove.submit()
    if (result.success) {
      onDeleted(deletingPath)
    } else {
      await modal.alert({ title: '删除失败', message: result.error || '删除失败' })
    }
  }

  return (
    <>
      {create.open && (
        <div className={`modal-overlay${create.visible ? ' modal-overlay-visible' : ''}`} onClick={create.close}>
          <div
            className={`modal-window${create.visible ? ' modal-window-visible' : ''}`}
            role="dialog"
            aria-modal="true"
            aria-label="新建工作区"
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              trapFocus(event)
              if (event.key === 'Escape') create.close()
            }}
          >
            <div className="modal-title">新建工作区</div>
            <div className="modal-subtitle">将创建在 ~/Documents/{DOCUMENTS_DIR_NAME}/ 下</div>
            <input
              className="modal-input"
              placeholder="工作区名称"
              value={create.name}
              onChange={(event) => create.setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.isComposing && !create.pending) {
                  void create.submit()
                }
              }}
              disabled={create.pending}
              autoFocus
              aria-describedby={create.error ? 'workspace-error' : undefined}
            />
            {create.error && <div className="modal-error" id="workspace-error" role="alert">{create.error}</div>}
            <div className="modal-actions">
              <button className="btn-modal btn-modal-cancel" onClick={create.close} disabled={create.pending}>取消</button>
              <button className="btn-modal btn-modal-primary" onClick={() => void create.submit()} disabled={create.pending}>
                {create.pending ? '创建中...' : '创建'}
              </button>
            </div>
          </div>
        </div>
      )}
      {remove.path && (
        <div className="modal-overlay modal-overlay-visible" onClick={remove.close}>
          <div
            className="modal-window modal-window-visible"
            role="dialog"
            aria-modal="true"
            aria-label="删除工作区"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-title">删除工作区</div>
            <div className="modal-body">
              此操作将永久删除工作区 <strong>{workspaceName}</strong> 及其所有文件，不可撤销。
            </div>
            <div className="modal-hint">请输入工作区名称以确认删除：</div>
            <input
              className="modal-input"
              placeholder={workspaceName}
              value={remove.confirmation}
              onChange={(event) => remove.setConfirmation(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') remove.close()
                if (event.key === 'Enter' && !event.isComposing && canDelete) {
                  void handleDelete()
                }
              }}
              autoFocus
            />
            <div className="modal-actions">
              <button className="btn-modal btn-modal-cancel" onClick={remove.close}>取消</button>
              <button
                className="btn-modal btn-modal-primary btn-modal-danger"
                disabled={!canDelete}
                onClick={() => void handleDelete()}
              >
                删除
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

export default WorkspaceDialogs
