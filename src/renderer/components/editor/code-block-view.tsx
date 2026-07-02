import { NodeViewContent, NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react'
import { createPortal } from 'react-dom'
import { useCallback, useState, useRef, useEffect } from 'react'
import { Copy, ChartBar, Maximize2, X, ZoomIn, ZoomOut } from 'lucide-react'
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch'
import { getMermaidTheme, renderMermaid } from '../../lib/mermaid-renderer'

function MermaidOverlay({ svg, onClose }: { svg: string; onClose: () => void }): React.ReactElement {
  const stableOnClose = useCallback(onClose, [])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') stableOnClose() }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [stableOnClose])

  return createPortal(
    <div className="mermaid-overlay">
      <TransformWrapper
        initialScale={1}
        minScale={0.2}
        maxScale={10}
        centerOnInit
        limitToBounds={false}
      >
        {({ zoomIn, zoomOut, resetTransform, state }) => (
          <>
            <div className="mermaid-overlay-toolbar">
              <button className="mermaid-overlay-btn" onClick={() => zoomIn()} title="放大">
                <ZoomIn size={16} />
              </button>
              <span className="mermaid-overlay-scale">{Math.round(state.scale * 100)}%</span>
              <button className="mermaid-overlay-btn" onClick={() => zoomOut()} title="缩小">
                <ZoomOut size={16} />
              </button>
              <button className="mermaid-overlay-btn" onClick={() => resetTransform()} title="重置">1:1</button>
              <button className="mermaid-overlay-btn" onClick={stableOnClose} title="关闭 (Esc)">
                <X size={16} />
              </button>
            </div>
            <TransformComponent
                wrapperClass="mermaid-overlay-canvas"
                contentClass="mermaid-overlay-content"
              >
                <div dangerouslySetInnerHTML={{ __html: svg }} />
              </TransformComponent>
          </>
        )}
      </TransformWrapper>
    </div>,
    document.body
  )
}

function CodeBlockView({ node }: ReactNodeViewProps): React.ReactElement {
  const [copied, setCopied] = useState(false)
  const [showSource, setShowSource] = useState(false)
  const [mermaidError, setMermaidError] = useState<string | null>(null)
  const [overlaySvg, setOverlaySvg] = useState<string | null>(null)
  const codeRef = useRef<HTMLPreElement>(null)
  const mermaidRef = useRef<HTMLDivElement>(null)
  const language = node.attrs.language as string | null
  const isMermaid = language === 'mermaid'

  const [themeKey, setThemeKey] = useState(0)

  const nodeText = node.textContent || ''
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

    renderMermaid(id, code.trim(), {
          startOnLoad: false,
          theme: getMermaidTheme(),
          securityLevel: 'strict'
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
              <ChartBar size={14} />
              {showSource ? 'Diagram' : 'Source'}
            </button>
          )}
          <button className="code-block-copy-btn" onClick={handleCopy}>
            {copied ? 'Copied' : <Copy size={14} />}
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
            <div ref={mermaidRef} className="mermaid-diagram" onClick={() => {
              if (mermaidRef.current?.innerHTML) setOverlaySvg(mermaidRef.current.innerHTML)
            }} />
          )}
          {!mermaidError && !showSource && (
            <button className="mermaid-expand-btn" onClick={() => {
              if (mermaidRef.current?.innerHTML) setOverlaySvg(mermaidRef.current.innerHTML)
            }} title="放大预览">
              <Maximize2 size={14} />
            </button>
          )}
        </div>
      ) : (
        <pre ref={codeRef}>
          <NodeViewContent className="code-block-content" />
        </pre>
      )}
      {overlaySvg && <MermaidOverlay svg={overlaySvg} onClose={() => setOverlaySvg(null)} />}
    </NodeViewWrapper>
  )
}

export default CodeBlockView
