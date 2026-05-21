import { useMemo, useRef, useEffect, useState } from 'react'
import { createLowlight, common } from 'lowlight'

const lowlight = createLowlight(common)

const TAIL_LINES = 5

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

function OdometerDigit({ digit }: { digit: string }) {
  const [display, setDisplay] = useState({ current: digit, prev: digit })
  const [animating, setAnimating] = useState(false)

  useEffect(() => {
    if (digit !== display.current) {
      setDisplay({ current: digit, prev: display.current })
      setAnimating(true)
      const timer = setTimeout(() => setAnimating(false), 300)
      return () => clearTimeout(timer)
    }
  }, [digit])

  return (
    <span className="odometer">
      <span className="odometer-digit placeholder" aria-hidden="true">{display.current}</span>
      {animating ? (
        <>
          <span className="odometer-digit exit" key={`p-${display.prev}`}>{display.prev}</span>
          <span className="odometer-digit enter" key={`c-${display.current}`}>{display.current}</span>
        </>
      ) : (
        <span className="odometer-digit static" key={`s-${display.current}`}>{display.current}</span>
      )}
    </span>
  )
}

function OdometerNumber({ value }: { value: number }) {
  const digits = String(value).split('')
  return (
    <span className="odometer-number">
      {digits.map((d, i) => <OdometerDigit key={i} digit={d} />)}
    </span>
  )
}

export default function SkillOutputCard({ content, isStreaming, language = 'html' }: SkillOutputCardProps) {
  const lines = content.split('\n')
  const lineCount = lines.length

  // Completed: compact single-line status
  if (!isStreaming) {
    return (
      <div className="skill-output-card skill-output-card-completed">
        <div className="skill-output-card-header">
          <span className="skill-output-card-lang">{language.toUpperCase()}</span>
          <span className="skill-output-card-lines"><OdometerNumber value={lineCount} /> 行</span>
          <span className="skill-output-card-status done">Done</span>
        </div>
      </div>
    )
  }

  // Streaming: show last few lines as progress indicator
  const tailLines = lines.slice(-TAIL_LINES)
  const tailContent = tailLines.join('\n')

  const highlightedHtml = useMemo(() => {
    try {
      const tree = lowlight.highlight(language, tailContent)
      return treeToHtml(tree)
    } catch {
      return tailContent.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    }
  }, [tailContent, language])

  return (
    <div className="skill-output-card skill-output-card-streaming">
      <div className="skill-output-card-header">
        <span className="skill-output-card-lang">{language.toUpperCase()}</span>
        <span className="skill-output-card-lines"><OdometerNumber value={lineCount} /> 行</span>
        <span className="skill-output-card-status">Generating<span className="generating-dots"><span>.</span><span>.</span><span>.</span></span></span>
      </div>
      <div className="skill-output-card-body">
        <pre><code className={`hljs language-${language}`} dangerouslySetInnerHTML={{ __html: highlightedHtml }} /></pre>
      </div>
    </div>
  )
}
