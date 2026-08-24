import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  AskSumiIcon,
  AutomationIcon,
  ConnectorsIcon,
  KnowledgeIcon,
  SkillsIcon,
} from '../src/renderer/components/layout/SidebarPrimaryIcons'

describe('SidebarPrimaryIcons', () => {
  it.each([
    [AskSumiIcon, 'lucide-message-square-plus'],
    [SkillsIcon, 'lucide-blocks'],
    [ConnectorsIcon, 'lucide-cable'],
    [AutomationIcon, 'lucide-calendar-clock'],
    [KnowledgeIcon, 'lucide-library-big'],
  ])('renders the selected Lucide icon set', (Icon, expectedClass) => {
    const html = renderToStaticMarkup(createElement(Icon))

    expect(html).toContain(expectedClass)
    expect(html).toContain('sidebar-primary-icon-svg')
    expect(html).toContain('width="18"')
    expect(html).toContain('stroke-width="1.6"')
    expect(html).toContain('aria-hidden="true"')
  })
})
