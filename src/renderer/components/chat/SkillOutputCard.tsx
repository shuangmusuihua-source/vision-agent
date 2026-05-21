import { useRef, useEffect, useMemo } from 'react'
import { createLowlight, common } from 'lowlight'

const lowlight = createLowlight(common)

interface SkillOutputCardProps {
  content: string
  isStreaming: boolean
  language?: string
}

function treeToHtml(tree: any): string {
  if (tree.type === 'text') return tree.value
  if (tree.type === 'element') {
    const attrs = tree.properties
      ? Object.entries(tree.properties)
          .map(([k, v]) => ` ${k}="${String(v)}"`)
          .join('')
      : ''
    const children = tree.children ? tree.children.map(treeToHtml).join('') : ''
    return `<${tree.tagName}${attrs}>${children}</${tree.tagName}>`
  }
  if (tree.children) return tree.children.map(treeToHtml).join('')
  return ''
}

export default function SkillOutputCard({ content, isStreaming, language = 'html' }: SkillOutputCardProps) {
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (isStreaming && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [content, isStreaming])

  const lines = content.split('\n')
  const lineCount = lines.length

  const highlightedHtml = useMemo(() => {
    try {
      const tree = lowlight.highlight(language, content)
      return treeToHtml(tree)
    } catch {
      return content.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    }
  }, [content, language])

  return (
    <div className="skill-output-card">
      <div className="skill-output-card-header">
        <span className="skill-output-card-lang">{language.toUpperCase()}</span>
        <span className="skill-output-card-lines">{lineCount} lines</span>
        {isStreaming && <span className="skill-output-card-status">Generating</span>}
        {!isStreaming && <span className="skill-output-card-status done">Done</span>}
      </div>
      <div className="skill-output-card-body" ref={scrollRef}>
        <div className="skill-output-card-code">
          <div className="skill-output-card-line-numbers">
            {lines.map((_, i) => (
              <span key={i}>{i + 1}</span>
            ))}
          </div>
          <pre><code className={`hljs language-${language}`} dangerouslySetInnerHTML={{ __html: highlightedHtml }} /></pre>
        </div>
      </div>
    </div>
  )
}