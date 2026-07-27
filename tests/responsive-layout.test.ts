import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { getDefaultAgentPanelWidth } from '../src/renderer/hooks/useResponsiveLayout'

const mainProcessPath = fileURLToPath(new URL('../src/main/index.ts', import.meta.url))
const mainProcessSource = readFileSync(mainProcessPath, 'utf8')
const layoutCssPath = fileURLToPath(new URL('../src/renderer/styles/layout.css', import.meta.url))
const layoutCss = readFileSync(layoutCssPath, 'utf8')

describe('default Agent panel layout', () => {
  it('splits the desktop panel area evenly with an expanded sidebar', () => {
    expect(getDefaultAgentPanelWidth(1440, false)).toBe(610)
  })

  it('splits the full panel area evenly when the sidebar is collapsed', () => {
    expect(getDefaultAgentPanelWidth(1000, true)).toBe(500)
  })

  it('keeps a usable minimum width', () => {
    expect(getDefaultAgentPanelWidth(480, true)).toBe(240)
  })
})

describe('compact desktop window policy', () => {
  it('supports a practical half-screen minimum instead of the unusable 680x400 size', () => {
    expect(mainProcessSource).toMatch(/minWidth:\s*720/)
    expect(mainProcessSource).toMatch(/minHeight:\s*560/)
  })

  it('does not pull Ask sumi underneath the hidden sidebar below 900px', () => {
    const compactLayout = layoutCss.slice(layoutCss.indexOf('@media (max-width: 899px)'))
    expect(compactLayout).toMatch(
      /\.main-content-ask-zuovis\.main-content-cover-sidebar\s*\{\s*margin-left:\s*0\s*!important;/,
    )
  })
})
