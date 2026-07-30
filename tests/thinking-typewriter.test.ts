import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import ThinkingTypewriter from '../src/renderer/components/chat/ThinkingTypewriter'

describe('ThinkingTypewriter', () => {
  it('renders a decorative, screen-reader-hidden typewriter', () => {
    const html = renderToStaticMarkup(createElement(ThinkingTypewriter))

    expect(html).toContain('class="typewriter-viewport"')
    expect(html).toContain('class="typewriter-scale"')
    expect(html).toContain('class="typewriter"')
    expect(html).toContain('aria-hidden="true"')
    expect(html).toContain('class="slide"')
    expect(html).toContain('class="paper"')
    expect(html).toContain('class="keyboard"')
  })
})
