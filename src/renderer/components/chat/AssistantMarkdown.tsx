import { useSyncExternalStore } from 'react'
import { Streamdown } from 'streamdown'
import type { DiagramPlugin } from 'streamdown'
import 'streamdown/styles.css'
import 'katex/dist/katex.min.css'
import { code } from '@streamdown/code'
import { math } from '@streamdown/math'
import remarkGfm from 'remark-gfm'
import type { BundledTheme } from 'shiki'
import { createLazyMermaidInstance } from '../../lib/mermaid-renderer'
import { stripSkillOutputBlock } from './message-text-utils'

const REMARK_PLUGINS = [remarkGfm]

const mermaidPlugin: DiagramPlugin = {
  name: 'mermaid',
  type: 'diagram',
  language: 'mermaid',
  getMermaid(config) {
    return createLazyMermaidInstance(config)
  },
}

const STREAMDOWN_PLUGINS = { code, math, mermaid: mermaidPlugin }

const themeListeners = new Set<() => void>()
let themeObserver: MutationObserver | null = null

function subscribeCodeTheme(listener: () => void): () => void {
  themeListeners.add(listener)
  if (!themeObserver) {
    themeObserver = new MutationObserver(() => {
      for (const notify of themeListeners) notify()
    })
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
  }
  return () => {
    themeListeners.delete(listener)
    if (themeListeners.size === 0) {
      themeObserver?.disconnect()
      themeObserver = null
    }
  }
}

function codeThemeSnapshot(): string | null {
  return document.documentElement.getAttribute('data-theme')
}

function useCodeTheme(): [BundledTheme, BundledTheme] {
  const theme = useSyncExternalStore(subscribeCodeTheme, codeThemeSnapshot)
  return theme === 'light'
    ? ['github-light', 'github-dark']
    : ['github-dark', 'github-light']
}

interface AssistantMarkdownProps {
  text: string
  isStreaming: boolean
}

function AssistantMarkdown({ text, isStreaming }: AssistantMarkdownProps): React.ReactElement {
  const codeTheme = useCodeTheme()

  return (
    <Streamdown
      plugins={STREAMDOWN_PLUGINS}
      remarkPlugins={REMARK_PLUGINS}
      shikiTheme={codeTheme}
      mode={isStreaming ? 'streaming' : 'static'}
      isAnimating={isStreaming}
      animated={isStreaming ? { animation: 'slideUp', sep: 'word', stagger: 30, duration: 200 } : undefined}
      parseIncompleteMarkdown={isStreaming}
      caret="block"
      mermaid={{ config: { startOnLoad: false, securityLevel: 'strict' } }}
      lineNumbers={false}
      controls={false}
    >
      {stripSkillOutputBlock(text)}
    </Streamdown>
  )
}

export default AssistantMarkdown
