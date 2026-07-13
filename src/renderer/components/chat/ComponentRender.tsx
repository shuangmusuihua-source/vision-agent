import { Renderer, StateProvider, VisibilityProvider, ActionProvider } from '@json-render/react'
import type { ReactNode } from 'react'

// ─── Registry ─────────────────────────────────────────────────────────
// Design: light, modern, shadow-over-border. No thick frames.

const S = {
  radius: 12,
  shadow: '0 1px 3px rgba(0,0,0,.06), 0 1px 2px rgba(0,0,0,.04)',
  bg: 'var(--jr-bg, #fff)',
  bgMuted: 'var(--jr-bg-muted, #f8f9fa)',
  text: 'var(--jr-text, #1a1a2e)',
  textMuted: 'var(--jr-text-muted, #6b7280)',
  accent: 'var(--jr-accent, #6366f1)',
  accentBg: 'var(--jr-accent-bg, #eef2ff)',
  success: '#10b981',
  danger: '#ef4444',
  amber: '#f59e0b',
  blue: '#3b82f6',
}

const trendConfig: Record<string, { icon: string; color: string }> = {
  up:      { icon: '↗', color: S.success },
  down:    { icon: '↘', color: S.danger },
  neutral: { icon: '→', color: S.textMuted },
}

const severityConfig: Record<string, { bg: string; dot: string; icon: string }> = {
  info:    { bg: '#eff6ff', dot: S.blue,    icon: 'ℹ' },
  warning: { bg: '#fffbeb', dot: S.amber,   icon: '⚠' },
  error:   { bg: '#fef2f2', dot: S.danger,  icon: '✕' },
  success: { bg: '#f0fdf4', dot: S.success, icon: '✓' },
}

// json-render passes { element, children, emit, on, bindings, loading } to registry components.
// Props live in element.props, text content in element.text.

interface RegistryElement {
  type: string
  props?: Record<string, unknown>
  children?: string[]
  text?: string
}

interface RegistryComponentProps {
  element: RegistryElement
  children?: ReactNode
  emit?: (actionName: string, params?: unknown) => void
  on?: (eventName: string, handler: (...args: unknown[]) => void) => void
  bindings?: Record<string, unknown>
  loading?: boolean
}

const registry: Record<string, (props: RegistryComponentProps) => ReactNode> = {
  Card: ({ element, children }) => {
    const { title, description } = element.props || {}
    const hasKids = element.children && element.children.length > 0
    return (
      <div style={{ background: S.bg, borderRadius: S.radius, boxShadow: S.shadow, marginBottom: 14, overflow: 'hidden' }}>
        <div style={{ padding: '18px 22px 0' }}>
          <div style={{ fontWeight: 600, fontSize: 15, color: S.text }}>{String(title ?? '')}</div>
          {description != null && <div style={{ fontSize: 13, color: S.textMuted, marginTop: 4 }}>{String(description)}</div>}
        </div>
        {hasKids
          ? <div style={{ padding: '16px 22px 20px', display: 'flex', flexWrap: 'wrap', gap: 10 }}>{children}</div>
          : <div style={{ height: 14 }} />
        }
      </div>
    )
  },

  Table: ({ element }) => {
    const { columns, rows } = (element.props || {}) as { columns?: Array<{ key: string; label: string }>; rows?: Array<Record<string, unknown>> }
    const cols = columns || []
    const data = rows || []
    return (
      <div style={{ background: S.bg, borderRadius: S.radius, boxShadow: S.shadow, marginBottom: 14, overflow: 'hidden', fontSize: 13 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {cols.map((col) => (
                <th key={col.key} style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600, color: S.textMuted, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', background: S.bgMuted }}>
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((row, i) => (
              <tr key={i}>
                {cols.map((col) => (
                  <td key={col.key} style={{ padding: '10px 16px', color: S.text, borderTop: i > 0 ? `1px solid ${S.bgMuted}` : 'none' }}>
                    {typeof row[col.key] === 'object' ? JSON.stringify(row[col.key]) : String(row[col.key] ?? '—')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  },

  Metric: ({ element }) => {
    const { label, value, trend } = (element.props || {}) as { label?: string; value?: string; trend?: string }
    const t = trendConfig[trend || ''] || trendConfig.neutral
    return (
      <div style={{ background: S.bg, borderRadius: 10, boxShadow: S.shadow, padding: '16px 20px', flex: '1 1 auto', minWidth: 130, maxWidth: 220 }}>
        <div style={{ fontSize: 11, color: S.textMuted, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 }}>
          {label ?? ''}
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
          <span style={{ fontSize: 22, fontWeight: 700, color: S.text, lineHeight: 1.1 }}>{value ?? ''}</span>
          {trend && <span style={{ fontSize: 14, color: t.color, fontWeight: 500 }}>{t.icon}</span>}
        </div>
      </div>
    )
  },

  CodeCard: ({ element, children }) => {
    const { language, title } = element.props || {}
    return (
      <div style={{ background: '#1e1e2e', borderRadius: S.radius, boxShadow: S.shadow, marginBottom: 14, overflow: 'hidden' }}>
        {(title != null || language != null) && (
          <div style={{ padding: '7px 14px', background: 'rgba(255,255,255,.05)', fontSize: 11, color: 'rgba(255,255,255,.45)', display: 'flex', justifyContent: 'space-between' }}>
            <span>{title ? String(title) : ''}</span>
            {language != null && <span>{String(language)}</span>}
          </div>
        )}
        <pre style={{ margin: 0, padding: '12px 16px', overflow: 'auto', fontSize: 13, color: '#e2e2f0', lineHeight: 1.5 }}>
          <code>{children || element.text || ''}</code>
        </pre>
      </div>
    )
  },

  Button: ({ element, emit }) => {
    const { label, variant } = (element.props || {}) as { label?: string; variant?: string }
    const isPrimary = variant !== 'secondary'
    return (
      <button
        style={{ display: 'inline-flex', alignItems: 'center', padding: '7px 18px', borderRadius: 8, border: 'none', background: isPrimary ? S.accent : S.bgMuted, color: isPrimary ? '#fff' : S.text, fontSize: 13, fontWeight: 500, cursor: 'pointer', marginBottom: 8, boxShadow: isPrimary ? S.shadow : 'none' }}
        onClick={() => emit?.('click')}
      >
        {label ?? ''}
      </button>
    )
  },

  Alert: ({ element }) => {
    const { severity, title, content } = (element.props || {}) as { severity?: string; title?: string; content?: string }
    const s = severityConfig[severity || 'info'] || severityConfig.info
    return (
      <div style={{ background: s.bg, borderRadius: S.radius, padding: '14px 18px', marginBottom: 14, display: 'flex', gap: 10, alignItems: 'flex-start', borderLeft: `3px solid ${s.dot}` }}>
        <span style={{ width: 20, height: 20, borderRadius: 10, background: s.dot, color: '#fff', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 }}>
          {s.icon}
        </span>
        <div>
          <div style={{ fontWeight: 600, fontSize: 13, color: S.text, marginBottom: 3 }}>{title ?? ''}</div>
          <div style={{ fontSize: 13, color: S.textMuted, lineHeight: 1.5 }}>{content ?? ''}</div>
        </div>
      </div>
    )
  },

  List: ({ element, children }) => {
    const { title } = element.props || {}
    return (
      <div style={{ background: S.bg, borderRadius: S.radius, boxShadow: S.shadow, marginBottom: 14, overflow: 'hidden' }}>
        {title != null && (
          <div style={{ padding: '14px 18px 0', fontWeight: 600, fontSize: 14, color: S.text }}>
            {String(title)}
          </div>
        )}
        <div style={{ padding: title ? '8px 0 6px' : '4px 0' }}>
          {children || (
            <div style={{ padding: '14px 18px', fontSize: 13, color: S.textMuted }}>暂无数据</div>
          )}
        </div>
      </div>
    )
  },

  ListItem: ({ element }) => {
    const { icon, title, subtitle, href } = (element.props || {}) as { icon?: string; title?: string; subtitle?: string; href?: string }
    return (
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '10px 18px', fontSize: 13, color: S.text,
          cursor: href ? 'pointer' : 'default',
        }}
        onClick={() => { if (href) window.api?.workspace?.openInBrowser?.(href) }}
      >
        {icon && <span style={{ fontSize: 16, flexShrink: 0 }}>{icon}</span>}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {title ?? ''}
          </div>
          {subtitle && (
            <div style={{ fontSize: 12, color: S.textMuted, marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {subtitle}
            </div>
          )}
        </div>
        {href && <span style={{ fontSize: 11, color: S.textMuted, flexShrink: 0 }}>→</span>}
      </div>
    )
  },

  Badge: ({ element }) => {
    const { label, variant } = (element.props || {}) as { label?: string; variant?: string }
    const v = variant || 'default'
    const colors: Record<string, { bg: string; text: string }> = {
      default: { bg: S.bgMuted, text: S.textMuted },
      success: { bg: '#ecfdf5', text: '#059669' },
      warning: { bg: '#fffbeb', text: '#d97706' },
      error:   { bg: '#fef2f2', text: '#dc2626' },
      info:    { bg: '#eff6ff', text: '#2563eb' },
      accent:  { bg: S.accentBg, text: S.accent },
    }
    const c = colors[v] || colors.default
    return (
      <span style={{
        display: 'inline-block', padding: '3px 10px', borderRadius: 6,
        background: c.bg, color: c.text, fontSize: 12, fontWeight: 500,
        marginRight: 6, marginBottom: 4,
      }}>
        {label ?? ''}
      </span>
    )
  },

  Chart: ({ element }) => {
    const { type, data, height, color } = (element.props || {}) as {
      type?: string; data?: Array<{ label: string; value: number }>; height?: number; color?: string
    }
    const items = data || []
    const h = height || 180
    const chartColor = color || S.accent
    const pad = { top: 20, right: 20, bottom: 32, left: 48 }
    const chartW = 600
    const chartH = h
    const plotW = chartW - pad.left - pad.right
    const plotH = chartH - pad.top - pad.bottom
    const maxVal = Math.max(...items.map((d) => d.value), 1)
    const isLine = type === 'line'
    const barGap = 4
    const barW = Math.max(8, (plotW - barGap * (items.length - 1)) / items.length)

    const gridY = (pct: number) => pad.top + plotH * (1 - pct)
    const dataX = (i: number) => isLine
      ? pad.left + (items.length > 1 ? (i / (items.length - 1)) * plotW : plotW / 2)
      : pad.left + i * (barW + barGap) + barW / 2
    const dataY = (v: number) => pad.top + plotH - Math.max(2, (v / maxVal) * plotH)

    // Build line path
    const linePath = items.map((d, i) =>
      `${i === 0 ? 'M' : 'L'}${dataX(i).toFixed(1)},${dataY(d.value).toFixed(1)}`
    ).join(' ')

    return (
      <div style={{ background: S.bg, borderRadius: S.radius, boxShadow: S.shadow, marginBottom: 14, overflow: 'hidden', padding: '8px 0 0' }}>
        <svg width="100%" viewBox={`0 0 ${chartW} ${chartH}`} style={{ display: 'block' }}>
          {/* Grid lines + Y labels */}
          {[0, 0.25, 0.5, 0.75, 1].map((pct) => {
            const y = gridY(pct)
            return (
              <g key={pct}>
                <line x1={pad.left} y1={y} x2={pad.left + plotW} y2={y} stroke={S.bgMuted} strokeWidth={1} />
                <text x={pad.left - 8} y={y + 4} textAnchor="end" fontSize={10} fill={S.textMuted}>
                  {Math.round(maxVal * pct).toLocaleString()}
                </text>
              </g>
            )
          })}
          {/* Bars */}
          {!isLine && items.map((d, i) => {
            const bh = Math.max(2, (d.value / maxVal) * plotH)
            const x = pad.left + i * (barW + barGap)
            const y = pad.top + plotH - bh
            const label = d.label.length > 6 ? d.label.slice(0, 6) + '…' : d.label
            return (
              <g key={i}>
                <rect x={x} y={y} width={barW} height={bh} rx={3} fill={chartColor} opacity={0.85} />
                <text x={x + barW / 2} y={pad.top + plotH + 16} textAnchor="middle" fontSize={10} fill={S.textMuted}>
                  {label}
                </text>
              </g>
            )
          })}
          {/* Line */}
          {isLine && (
            <>
              {/* Area fill */}
              <path
                d={`${linePath} L${dataX(items.length - 1).toFixed(1)},${pad.top + plotH} L${dataX(0).toFixed(1)},${pad.top + plotH} Z`}
                fill={chartColor} opacity={0.08}
              />
              {/* Line stroke */}
              <path d={linePath} fill="none" stroke={chartColor} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
              {/* Dots + labels */}
              {items.map((d, i) => {
                const cx = dataX(i)
                const cy = dataY(d.value)
                const label = d.label.length > 6 ? d.label.slice(0, 6) + '…' : d.label
                return (
                  <g key={i}>
                    <circle cx={cx} cy={cy} r={3.5} fill="#fff" stroke={chartColor} strokeWidth={2} />
                    <text x={cx} y={pad.top + plotH + 16} textAnchor="middle" fontSize={10} fill={S.textMuted}>
                      {label}
                    </text>
                    {/* Value label above point */}
                    <text x={cx} y={cy - 8} textAnchor="middle" fontSize={10} fontWeight={600} fill={S.text}>
                      {d.value.toLocaleString()}
                    </text>
                  </g>
                )
              })}
            </>
          )}
        </svg>
      </div>
    )
  },
}

// ─── Renderer ──────────────────────────────────────────────────────────

interface JsonRenderSpec {
  root: string
  elements: Record<string, {
    type: string
    props?: Record<string, unknown>
    children?: string[]
    text?: string
  }>
}

export function ComponentRenderer({ spec }: { spec: JsonRenderSpec }) {
  return (
    <StateProvider initialState={{}}>
      <ActionProvider handlers={{}}>
        <VisibilityProvider>
          <Renderer spec={spec as any} registry={registry as any} />
        </VisibilityProvider>
      </ActionProvider>
    </StateProvider>
  )
}

// ─── Extract json-render blocks from markdown ─────────────────────────

const JSON_RENDER_REGEX = /```json-render\n([\s\S]*?)```/g

export function extractJsonRenderBlocks(text: string): { blocks: JsonRenderSpec[]; cleanText: string } {
  const blocks: JsonRenderSpec[] = []
  const cleanText = text.replace(JSON_RENDER_REGEX, (_match, json: string) => {
    try {
      const spec = JSON.parse(json) as JsonRenderSpec
      if (spec.root && spec.elements) {
        blocks.push(spec)
      }
    } catch {
      // Invalid JSON — leave as-is in markdown
      return _match
    }
    return '' // Remove the block from rendered markdown
  })
  return { blocks, cleanText: cleanText.replace(/\n{3,}/g, '\n\n').trim() }
}
