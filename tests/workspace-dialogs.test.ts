import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import WorkspaceDialogs from '../src/renderer/components/workspace/WorkspaceDialogs'
import { ModalProvider } from '../src/renderer/components/common/ModalSystem'
import type { WorkspaceDialogsController } from '../src/renderer/hooks/useWorkspace'

function renderDialogs(controller: WorkspaceDialogsController): string {
  return renderToStaticMarkup(createElement(
    ModalProvider,
    null,
    createElement(WorkspaceDialogs, { controller, onDeleted: vi.fn() }),
  ))
}

function controller(overrides: Partial<WorkspaceDialogsController> = {}): WorkspaceDialogsController {
  return {
    create: {
      open: false,
      visible: false,
      name: '',
      error: '',
      pending: false,
      setName: vi.fn(),
      close: vi.fn(),
      submit: vi.fn(async () => {}),
    },
    remove: {
      path: null,
      confirmation: '',
      setConfirmation: vi.fn(),
      close: vi.fn(),
      submit: vi.fn(async () => ({ success: true })),
    },
    ...overrides,
  }
}

describe('WorkspaceDialogs', () => {
  it('renders create validation and pending state through the dialog Interface', () => {
    const base = controller()
    const html = renderDialogs(controller({
      create: {
        ...base.create,
        open: true,
        visible: true,
        name: 'Research',
        error: '工作区已存在',
        pending: true,
      },
    }))

    expect(html).toContain('aria-label="新建工作区"')
    expect(html).toContain('value="Research"')
    expect(html).toContain('工作区已存在')
    expect(html).toContain('创建中...')
  })

  it('requires the exact workspace name before enabling deletion', () => {
    const base = controller()
    const disabledHtml = renderDialogs(controller({
      remove: {
        ...base.remove,
        path: '/workspace/Research',
        confirmation: 'Wrong',
      },
    }))
    const enabledHtml = renderDialogs(controller({
      remove: {
        ...base.remove,
        path: '/workspace/Research',
        confirmation: 'Research',
      },
    }))

    expect(disabledHtml).toContain('aria-label="删除工作区"')
    expect(disabledHtml).toContain('disabled=""')
    expect(enabledHtml).not.toContain('class="btn-modal btn-modal-primary btn-modal-danger" disabled=""')
  })
})
