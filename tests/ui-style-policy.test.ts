import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const globalCssPath = fileURLToPath(new URL('../src/renderer/styles/global.css', import.meta.url))
const globalCss = readFileSync(globalCssPath, 'utf8')
const editorCssPath = fileURLToPath(new URL('../src/renderer/styles/editor.css', import.meta.url))
const editorCss = readFileSync(editorCssPath, 'utf8')

describe('global UI style policy', () => {
  it('leaves button interaction foreground colors to component variants', () => {
    const globalButtonStateRules = Array.from(globalCss.matchAll(
      /(?:^|\n)button:(?:hover|active|focus|focus-visible)\s*\{([^}]*)\}/g,
    ))

    for (const [, declarations] of globalButtonStateRules) {
      expect(declarations).not.toMatch(/(?:^|;)\s*color\s*:/)
    }
  })

  it('defines a complete semantic primary-button color contract', () => {
    expect(globalCss).toContain('--button-primary-bg:')
    expect(globalCss).toContain('--button-primary-text:')
    expect(globalCss).toContain('--button-primary-hover:')
  })

  it('uses one semantic selection color across application surfaces', () => {
    expect(globalCss).toContain('--color-selection-bg:')
    expect(globalCss).toMatch(/::selection\s*\{[^}]*background:\s*var\(--color-selection-bg\)/s)
  })

  it('gives the BubbleMenu its measurable width before first positioning', () => {
    expect(editorCss).toMatch(/\.ai-inline-menu\s*\{[^}]*width:\s*max-content/s)
  })
})
