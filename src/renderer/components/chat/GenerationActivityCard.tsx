import { useMemo, useRef, useEffect, useLayoutEffect, useState } from 'react'
import { createLowlight, common } from 'lowlight'
import type { GenerationActivity } from '../../../shared/types'

const lowlight = createLowlight(common)
const TAIL_LINES = 5
const SAFE_CLASS_TOKEN = /^[A-Za-z0-9_-]+$/

type HighlightNode = {
  type?: string
  value?: string
  tagName?: string
  properties?: Record<string, unknown>
  children?: HighlightNode[]
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function safeClassName(value: unknown): string {
  const tokens = Array.isArray(value)
    ? value.flatMap((item) => String(item).split(/\s+/))
    : String(value || '').split(/\s+/)
  return tokens.filter((token) => SAFE_CLASS_TOKEN.test(token)).join(' ')
}

export function treeToSafeHtml(tree: HighlightNode): string {
  if (tree.type === 'text') return escapeHtml(tree.value || '')
  if (tree.type === 'element') {
    const children = tree.children ? tree.children.map(treeToSafeHtml).join('') : ''
    if (tree.tagName !== 'span') return children
    const className = safeClassName(tree.properties?.className || tree.properties?.class)
    return className
      ? `<span class="${escapeHtml(className)}">${children}</span>`
      : `<span>${children}</span>`
  }
  if (tree.children) return tree.children.map(treeToSafeHtml).join('')
  return ''
}

type DigitTransition = {
  from: string
  to: string
  sequence: number
}

function OdometerDigit({ digit }: { digit: string }) {
  const currentRef = useRef(digit)
  const sequenceRef = useRef(0)
  const [transition, setTransition] = useState<DigitTransition | null>(null)

  useEffect(() => {
    if (digit === currentRef.current) return

    const from = currentRef.current
    currentRef.current = digit
    sequenceRef.current += 1
    setTransition({ from, to: digit, sequence: sequenceRef.current })

    const timer = setTimeout(() => setTransition(null), 360)
    return () => clearTimeout(timer)
  }, [digit])

  return (
    <span className="odometer" aria-hidden="true">
      <span className="odometer-digit placeholder">{digit}</span>
      {transition ? (
        <>
          <span key={`exit-${transition.sequence}`} className="odometer-digit exit">{transition.from}</span>
          <span key={`enter-${transition.sequence}`} className="odometer-digit enter">{transition.to}</span>
        </>
      ) : (
        <span className="odometer-digit static">{digit}</span>
      )}
    </span>
  )
}

function OdometerNumber({ value }: { value: number }) {
  const ref = useRef<HTMLSpanElement>(null)
  const maxWidthRef = useRef(0)
  const digits = String(value).split('')

  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const width = element.getBoundingClientRect().width
    if (width <= maxWidthRef.current) return
    maxWidthRef.current = width
    element.style.minWidth = `${width}px`
  })

  return (
    <span className="odometer-number" ref={ref} aria-label={String(value)}>
      {digits.map((digit, index) => (
        <OdometerDigit key={digits.length - index - 1} digit={digit} />
      ))}
    </span>
  )
}

function phaseText(phase: GenerationActivity['phase']): string {
  if (phase === 'preparing') return '准备中'
  if (phase === 'finalizing') return '处理中'
  return '生成中'
}

export default function GenerationActivityCard({ activity }: { activity: GenerationActivity }) {
  const lines = activity.content ? activity.content.split('\n') : []
  const lineCount = lines.length
  const tailContent = lines.slice(-TAIL_LINES).join('\n')

  const highlightedHtml = useMemo(() => {
    if (!tailContent) return ''
    try {
      return treeToSafeHtml(lowlight.highlight(activity.language, tailContent))
    } catch {
      return escapeHtml(tailContent)
    }
  }, [tailContent, activity.language])

  return (
    <div
      className="generation-activity-card"
      role="status"
      aria-live="polite"
      aria-label={`${activity.label}，${phaseText(activity.phase)}`}
    >
      <div className="generation-activity-card-header">
        <span className="generation-activity-card-heading">
          <span className="generation-activity-card-label">{activity.label}</span>
          {lineCount > 0 && (
            <span className="generation-activity-card-lines"><OdometerNumber value={lineCount} /> 行</span>
          )}
        </span>
        <span className="generation-activity-card-status">
          {phaseText(activity.phase)}
          <span className="generating-dots" aria-hidden="true"><span>.</span><span>.</span><span>.</span></span>
        </span>
      </div>
      {highlightedHtml && (
        <div className="generation-activity-card-body">
          <pre><code className={`hljs language-${activity.language}`} dangerouslySetInnerHTML={{ __html: highlightedHtml }} /></pre>
        </div>
      )}
    </div>
  )
}
