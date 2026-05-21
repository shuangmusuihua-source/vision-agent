import { NodeViewContent, NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react'
import { useCallback, useState, useRef, useEffect } from 'react'
import { Copy, ChartBar } from '@phosphor-icons/react'

// Lazy-loaded mermaid — only imported when a mermaid code block is encountered
let mermaidModule: typeof import('mermaid').default | null = null
let mermaidLoadPromise: Promise<typeof import('mermaid').default> | null = null

async function loadMermaid() {
  if (mermaidModule) return mermaidModule
  if (mermaidLoadPromise) return mermaidLoadPromise
  mermaidLoadPromise = import('mermaid').then((m) => {
    mermaidModule = m.default
    return mermaidModule
  })
  return mermaidLoadPromise
}

function getMermaidTheme(): 'dark' | 'default' {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'default'
}

function CodeBlockView({ node, editor }: ReactNodeViewProps): React.ReactElement {
  const [copied, setCopied] = useState(false)
  const [showSource, setShowSource] = useState(false)
  const [mermaidError, setMermaidError] = useState<string | null>(null)
  const codeRef = useRef<HTMLPreElement>(null)
  const mermaidRef = useRef<HTMLDivElement>(null)
  const language = node.attrs.language as string | null
  const isMermaid = language === 'mermaid'

  const [themeKey, setThemeKey] = useState(0)

  const nodeText = node.textContent || ''
  const mermaidCodeRef = useRef(nodeText)
  const [mermaidCode, setMermaidCode] = useState(nodeText)

  // Update mermaid code when node content changes (debounced)
  useEffect(() => {
    if (!isMermaid) return
    const timer = setTimeout(() => {
      setMermaidCode(nodeText)
    }, 300)
    return () => clearTimeout(timer)
  }, [nodeText, isMermaid])

  const handleCopy = useCallback(() => {
    const text = codeRef.current?.textContent ?? ''
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }, [])

  // Render mermaid diagram
  useEffect(() => {
    if (!isMermaid || showSource || !mermaidRef.current) return

    const code = mermaidCode
    if (!code.trim()) return

    const id = `mermaid-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    setMermaidError(null)

    let cancelled = false

    loadMermaid()
      .then((mermaid) => {
        if (cancelled) return
        mermaid.initialize({
          startOnLoad: false,
          theme: getMermaidTheme(),
          securityLevel: 'loose'
        })
        return mermaid.render(id, code.trim())
      })
      .then((result) => {
        if (cancelled || !result) return
        if (mermaidRef.current) {
          mermaidRef.current.innerHTML = result.svg
        }
      })
      .catch((err) => {
        if (cancelled) return
        setMermaidError(String(err.message || err))
        // Clean up phantom element mermaid may have created
        const phantom = document.getElementById(`d${id}`)
        if (phantom) phantom.remove()
      })

    return () => { cancelled = true }
  }, [isMermaid, showSource, mermaidCode, themeKey])

  // Watch theme changes for mermaid re-render
  useEffect(() => {
    if (!isMermaid) return

    const observer = new MutationObserver(() => {
      setThemeKey((k) => k + 1)
    })
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme']
    })
    return () => observer.disconnect()
  }, [isMermaid])

  return (
    <NodeViewWrapper className="code-block-wrapper" as="div">
      <div className="code-block-header">
        <span className="code-block-language">{language || 'text'}</span>
        <div className="code-block-header-actions">
          {isMermaid && (
            <button
              className="code-block-copy-btn"
              onClick={() => setShowSource(!showSource)}
              title={showSource ? 'Show diagram' : 'Show source'}
            >
              <ChartBar size={13} weight="bold" />
              {showSource ? 'Diagram' : 'Source'}
            </button>
          )}
          <button className="code-block-copy-btn" onClick={handleCopy}>
            {copied ? 'Copied' : <Copy size={13} weight="bold" />}
          </button>
        </div>
      </div>
      {isMermaid && !showSource ? (
        <div className="mermaid-diagram-wrapper">
          {mermaidError ? (
            <div className="mermaid-error">
              <pre>{mermaidError}</pre>
            </div>
          ) : (
            <div ref={mermaidRef} className="mermaid-diagram" />
          )}
        </div>
      ) : (
        <pre ref={codeRef}>
          <NodeViewContent className="code-block-content" />
        </pre>
      )}
    </NodeViewWrapper>
  )
}

export default CodeBlockView