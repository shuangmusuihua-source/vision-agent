import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const globalCssPath = fileURLToPath(new URL('../src/renderer/styles/global.css', import.meta.url))
const globalCss = readFileSync(globalCssPath, 'utf8')
const editorCssPath = fileURLToPath(new URL('../src/renderer/styles/editor.css', import.meta.url))
const editorCss = readFileSync(editorCssPath, 'utf8')
const searchCssPath = fileURLToPath(new URL('../src/renderer/styles/search.css', import.meta.url))
const searchCss = readFileSync(searchCssPath, 'utf8')
const settingsCssPath = fileURLToPath(new URL('../src/renderer/styles/settings.css', import.meta.url))
const settingsCss = readFileSync(settingsCssPath, 'utf8')
const skillsCssPath = fileURLToPath(new URL('../src/renderer/styles/skills.css', import.meta.url))
const skillsCss = readFileSync(skillsCssPath, 'utf8')
const automationCssPath = fileURLToPath(new URL('../src/renderer/components/automation/AutomationPanel.css', import.meta.url))
const automationCss = readFileSync(automationCssPath, 'utf8')
const memoryCssPath = fileURLToPath(new URL('../src/renderer/components/settings/MemorySettingsPage.css', import.meta.url))
const memoryCss = readFileSync(memoryCssPath, 'utf8')
const overviewCssPath = fileURLToPath(new URL('../src/renderer/components/layout/OverviewPanel.css', import.meta.url))
const overviewCss = readFileSync(overviewCssPath, 'utf8')

function declarationsFor(css: string, selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = css.match(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`))
  expect(match, `Missing CSS rule for ${selector}`).not.toBeNull()
  return match?.[1] ?? ''
}

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

  it('keeps tertiary color available for decorative and disabled UI', () => {
    expect(globalCss).toContain('--color-text-tertiary:')
  })

  it.each([
    [searchCss, '.search-result-workspace'],
    [settingsCss, '.settings-sidebar-desc'],
    [skillsCss, '.skill-catalog-card-footer'],
    [automationCss, '.automation-schedule-hint'],
    [memoryCss, '.memory-settings-meta'],
    [editorCss, '.editor-status-bar'],
  ])('uses readable secondary color for meaningful supporting text', (css, selector) => {
    expect(declarationsFor(css, selector)).toContain('color: var(--color-text-secondary)')
  })

  it('keeps overview card footers compact without shrinking action targets', () => {
    expect(declarationsFor(overviewCss, '.overview-card')).toContain('padding: 14px 14px 8px')
    expect(declarationsFor(overviewCss, '.overview-card-toolbar')).toMatch(
      /margin-top:\s*auto;[\s\S]*padding-top:\s*8px;/,
    )
    expect(declarationsFor(overviewCss, '.overview-icon-action')).toMatch(
      /width:\s*32px;[\s\S]*height:\s*32px;/,
    )
  })
})
