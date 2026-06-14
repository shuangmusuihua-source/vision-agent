import { describe, expect, it } from 'vitest'
import { treeToSafeHtml } from '../src/renderer/components/chat/SkillOutputCard'

describe('treeToSafeHtml', () => {
  it('escapes highlighted text so code is not parsed as DOM', () => {
    const html = treeToSafeHtml({
      type: 'root',
      children: [
        {
          type: 'element',
          tagName: 'span',
          properties: { className: ['hljs-string'] },
          children: [{ type: 'text', value: '"<img src=x onerror=alert(1)>"' }],
        },
      ],
    })

    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(html).not.toContain('<img')
  })

  it('keeps only safe class tokens from highlight nodes', () => {
    const html = treeToSafeHtml({
      type: 'element',
      tagName: 'span',
      properties: { className: ['hljs-keyword', 'bad" onclick="alert(1)'] },
      children: [{ type: 'text', value: 'const' }],
    })

    expect(html).toBe('<span class="hljs-keyword">const</span>')
  })
})
