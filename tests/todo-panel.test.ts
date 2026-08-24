import { createElement } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import TodoPanel from '../src/renderer/components/chat/TodoPanel'

describe('TodoPanel', () => {
  it('renders a collapsed, accessible task summary without emoji status icons', () => {
    const html = renderToStaticMarkup(createElement(TodoPanel, {
      todoList: {
        totalCount: 2,
        tasks: [
          {
            taskId: 'task-1',
            subject: '生成商业计划书',
            description: '整理章节与表格',
            status: 'pending',
            createdAt: 1,
          },
          {
            taskId: 'task-2',
            subject: '校验 PDF',
            status: 'pending',
            createdAt: 2,
          },
        ],
      },
      onClose: vi.fn(),
    }))

    expect(html).toContain('准备中')
    expect(html).toContain('0/2')
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('title="展开任务进度"')
    expect(html).toContain('aria-label="隐藏任务进度"')
    expect(html).not.toMatch(/[✅🔧⏳⌛]/u)
    expect(html).not.toContain('role="list"')
  })

  it('uses the completed summary state when every task is done', () => {
    const html = renderToStaticMarkup(createElement(TodoPanel, {
      todoList: {
        totalCount: 1,
        tasks: [{
          taskId: 'task-1',
          subject: '完成交付',
          status: 'completed',
          createdAt: 1,
        }],
      },
      onClose: vi.fn(),
    }))

    expect(html).toContain('全部完成')
    expect(html).toContain('1/1')
    expect(html).not.toMatch(/[✅🔧⏳⌛]/u)
  })
})
