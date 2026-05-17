import { NodeViewContent, NodeViewWrapper } from '@tiptap/react'
import { useCallback, useState, useRef } from 'react'
import { Copy } from '@phosphor-icons/react'

function CodeBlockView({ node }: { node: { attrs: { language: string | null } } }): React.ReactElement {
  const [copied, setCopied] = useState(false)
  const codeRef = useRef<HTMLPreElement>(null)
  const language = node.attrs.language

  const handleCopy = useCallback(() => {
    const text = codeRef.current?.textContent ?? ''
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }, [])

  return (
    <NodeViewWrapper className="code-block-wrapper" as="div">
      <div className="code-block-header">
        <span className="code-block-language">{language || 'text'}</span>
        <button className="code-block-copy-btn" onClick={handleCopy}>
          {copied ? 'Copied' : <Copy size={13} weight="regular" />}
        </button>
      </div>
      <pre ref={codeRef}>
        <NodeViewContent className="code-block-content" />
      </pre>
    </NodeViewWrapper>
  )
}

export default CodeBlockView
