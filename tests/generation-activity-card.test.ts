import { createElement } from 'react'
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import GenerationActivityCard from '../src/renderer/components/chat/GenerationActivityCard'

describe('GenerationActivityCard', () => {
  it('renders preparing feedback before preview content exists', () => {
    const html = renderToStaticMarkup(createElement(GenerationActivityCard, {
      activity: {
        activityId: 'tool:write-1',
        skillId: null,
        phase: 'preparing',
        source: 'tool-input',
        toolName: 'Write',
        label: '准备生成内容',
        content: '',
        language: 'text',
      },
    }))

    expect(html).toContain('准备生成内容')
    expect(html).toContain('准备中')
    expect(html).toContain('role="status"')
    expect(html).not.toContain('generation-activity-card-body')
  })

  it('renders the line count as a right-aligned odometer value', () => {
    const html = renderToStaticMarkup(createElement(GenerationActivityCard, {
      activity: {
        activityId: 'tool:write-1',
        skillId: null,
        phase: 'generating',
        source: 'tool-input',
        toolName: 'Write',
        label: '正在生成内容',
        content: 'one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\nnine\nten\neleven\ntwelve',
        language: 'text',
      },
    }))

    expect(html).toContain('class="odometer-number"')
    expect(html).toContain('aria-label="12"')
    expect(html).not.toContain('generation-activity-card-signal')
    expect(html).not.toContain('generation-activity-card-status-dot')
    expect(html.match(/class="odometer"/g)).toHaveLength(2)
  })
})
