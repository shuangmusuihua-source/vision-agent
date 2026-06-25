import type { MermaidConfig } from 'mermaid'

type MermaidModule = typeof import('mermaid').default

let mermaidModule: MermaidModule | null = null
let mermaidLoadPromise: Promise<MermaidModule> | null = null

export async function loadMermaid(): Promise<MermaidModule> {
  if (mermaidModule) return mermaidModule
  if (mermaidLoadPromise) return mermaidLoadPromise
  mermaidLoadPromise = import('mermaid').then((m) => {
    mermaidModule = m.default
    return mermaidModule
  })
  return mermaidLoadPromise
}

export function getMermaidTheme(): 'dark' | 'default' {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'default'
}

export async function renderMermaid(
  id: string,
  source: string,
  config?: MermaidConfig
): Promise<{ svg: string }> {
  const mermaid = await loadMermaid()
  mermaid.initialize({ startOnLoad: false, ...config })
  return mermaid.render(id, source)
}

export function createLazyMermaidInstance(initialConfig?: MermaidConfig): {
  initialize: (config: MermaidConfig) => void
  render: (id: string, source: string) => Promise<{ svg: string }>
} {
  let config: MermaidConfig = { startOnLoad: false, ...initialConfig }
  return {
    initialize(nextConfig) {
      config = { startOnLoad: false, ...nextConfig }
    },
    render(id, source) {
      return renderMermaid(id, source, config)
    },
  }
}
