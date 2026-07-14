import { describe, expect, it } from 'vitest'
import { getDefaultAgentPanelWidth } from '../src/renderer/hooks/useResponsiveLayout'

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
