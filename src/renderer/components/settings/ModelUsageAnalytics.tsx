import { useEffect, useMemo, useState } from 'react'
import {
  Activity,
  ArrowLeft,
  BarChart3,
  Coins,
  Database,
  Layers3,
  Loader2,
  MessageSquareText,
  Sparkles,
} from 'lucide-react'
import type { ModelProfile, ModelUsageDetail, ModelUsageRange } from '../../../shared/types'

type ModelUsageAnalyticsProps = {
  profile: ModelProfile
  onBack: () => void
}

const RANGE_OPTIONS: Array<{ value: ModelUsageRange; label: string }> = [
  { value: '7d', label: '近 7 天' },
  { value: '30d', label: '近 30 天' },
  { value: '90d', label: '近 90 天' },
  { value: 'all', label: '全部' },
]

const SOURCE_LABELS: Record<ModelUsageDetail['sessions'][number]['source'], string> = {
  interactive: '会话',
  automation: '自动化',
  'inline-rewrite': '行内改写',
  'automation-planning': '自动化规划',
}

type DonutDatum = {
  label: string
  value: number
  tone: 'action' | 'accent' | 'success' | 'warning'
}

const compactNumber = new Intl.NumberFormat('zh-CN', {
  notation: 'compact',
  maximumFractionDigits: 1,
})

function formatTokens(value: number): string {
  return compactNumber.format(Math.round(value))
}

function formatCost(value: number): string {
  if (value === 0) return '$0.00'
  if (value < 0.01) return `$${value.toFixed(4)}`
  return `$${value.toFixed(2)}`
}

function formatDate(value: number): string {
  return new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric' }).format(value)
}

function buildSmoothPath(points: Array<{ x: number; y: number }>): string {
  if (points.length === 0) return ''
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`

  return points.slice(1).reduce((path, point, index) => {
    const previous = points[index]
    const middleX = (previous.x + point.x) / 2
    return `${path} C ${middleX} ${previous.y}, ${middleX} ${point.y}, ${point.x} ${point.y}`
  }, `M ${points[0].x} ${points[0].y}`)
}

function UsageTrendChart({ points }: { points: ModelUsageDetail['daily'] }): React.ReactElement {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)
  const width = 720
  const height = 230
  const padding = { top: 16, right: 16, bottom: 34, left: 46 }
  const chartWidth = width - padding.left - padding.right
  const chartHeight = height - padding.top - padding.bottom
  const maxTokens = Math.max(1, ...points.map((point) => point.totalTokens))
  const coordinates = points.map((point, index) => ({
    x: points.length === 1
      ? padding.left + chartWidth / 2
      : padding.left + index / (points.length - 1) * chartWidth,
    y: padding.top + chartHeight - point.totalTokens / maxTokens * chartHeight,
  }))
  const linePath = buildSmoothPath(coordinates)
  const baseline = padding.top + chartHeight
  const areaPath = coordinates.length > 0
    ? `${linePath} L ${coordinates.at(-1)?.x ?? padding.left} ${baseline} L ${coordinates[0].x} ${baseline} Z`
    : ''
  const labelIndexes = new Set([0, Math.floor((points.length - 1) / 2), points.length - 1])
  const hoveredCoordinate = hoveredIndex === null ? null : coordinates[hoveredIndex]
  const hoveredPoint = hoveredIndex === null ? null : points[hoveredIndex]

  const selectNearestPoint = (event: React.PointerEvent<SVGSVGElement>) => {
    if (points.length === 0) return
    const bounds = event.currentTarget.getBoundingClientRect()
    const chartX = (event.clientX - bounds.left) / bounds.width * width
    const ratio = Math.max(0, Math.min(1, (chartX - padding.left) / chartWidth))
    setHoveredIndex(Math.round(ratio * (points.length - 1)))
  }

  const handleKeyDown = (event: React.KeyboardEvent<SVGSVGElement>) => {
    if (points.length === 0 || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return
    event.preventDefault()
    const direction = event.key === 'ArrowRight' ? 1 : -1
    const current = hoveredIndex ?? (direction > 0 ? -1 : points.length)
    setHoveredIndex(Math.max(0, Math.min(points.length - 1, current + direction)))
  }

  return (
    <div className="model-usage-area-chart">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="每日 Token 用量面积折线图，可悬停或使用左右方向键查看每日数据"
        tabIndex={points.length > 0 ? 0 : -1}
        onPointerMove={selectNearestPoint}
        onPointerLeave={() => setHoveredIndex(null)}
        onFocus={() => setHoveredIndex((current) => current ?? points.length - 1)}
        onBlur={() => setHoveredIndex(null)}
        onKeyDown={handleKeyDown}
      >
        <title>每日 Token 用量趋势</title>
        <defs>
          <linearGradient id="model-usage-area-gradient" x1="0" x2="0" y1="0" y2="1">
            <stop className="model-usage-chart-gradient-start" offset="0%" />
            <stop className="model-usage-chart-gradient-middle" offset="55%" />
            <stop className="model-usage-chart-gradient-end" offset="100%" />
          </linearGradient>
        </defs>
        {[0, 0.5, 1].map((ratio) => {
          const y = padding.top + chartHeight * ratio
          const value = maxTokens * (1 - ratio)
          return (
            <g key={ratio}>
              <line className="model-usage-chart-grid-line" x1={padding.left} x2={width - padding.right} y1={y} y2={y} />
              <text className="model-usage-chart-axis-label" x={padding.left - 8} y={y + 3} textAnchor="end">{formatTokens(value)}</text>
            </g>
          )
        })}
        {areaPath && <path className="model-usage-chart-area" d={areaPath} />}
        {linePath && <path className="model-usage-chart-line" d={linePath} />}
        {hoveredCoordinate && (
          <line
            className="model-usage-chart-guide"
            x1={hoveredCoordinate.x}
            x2={hoveredCoordinate.x}
            y1={padding.top}
            y2={baseline}
          />
        )}
        {coordinates.map((coordinate, index) => (
          <g key={points[index].date}>
            {labelIndexes.has(index) && (
              <text className="model-usage-chart-axis-label" x={coordinate.x} y={height - 8} textAnchor={index === 0 ? 'start' : index === points.length - 1 ? 'end' : 'middle'}>
                {points[index].date.slice(5).replace('-', '/')}
              </text>
            )}
          </g>
        ))}
        {points.length === 0 && (
          <text className="model-usage-chart-empty-label" x={width / 2} y={height / 2} textAnchor="middle">等待首条用量记录</text>
        )}
      </svg>
      {hoveredCoordinate && hoveredPoint && (
        <div
          className="model-usage-chart-tooltip"
          role="status"
          style={{
            left: `${Math.max(12, Math.min(88, hoveredCoordinate.x / width * 100))}%`,
            top: `${Math.max(10, hoveredCoordinate.y / height * 100)}%`,
          }}
        >
          <span>{hoveredPoint.date}</span>
          <strong>{hoveredPoint.totalTokens.toLocaleString('zh-CN')} tokens</strong>
          <small>{hoveredPoint.requestCount} 次请求</small>
        </div>
      )}
    </div>
  )
}

function UsageDonut({
  data,
  centerLabel,
}: {
  data: DonutDatum[]
  centerLabel: string
}): React.ReactElement {
  const [activeIndex, setActiveIndex] = useState<number | null>(null)
  const total = data.reduce((sum, item) => sum + item.value, 0)
  const activeItem = activeIndex === null ? null : data[activeIndex]
  const radius = 42
  const circumference = 2 * Math.PI * radius
  const visibleSegments = data.filter((item) => item.value > 0).length
  const segmentGap = visibleSegments > 1 ? 1.8 : 0
  let offset = 0

  return (
    <div className="model-usage-donut-layout" onPointerLeave={() => setActiveIndex(null)}>
      <div className="model-usage-donut-wrap">
        <svg className="model-usage-donut" viewBox="0 0 110 110" role="img" aria-label={`${centerLabel}环形图，可聚焦每个扇区查看数据`}>
          <circle className="model-usage-donut-track" cx="55" cy="55" r={radius} />
          {data.map((item, index) => {
            const length = total > 0 ? item.value / total * circumference : 0
            const currentOffset = offset
            offset += length
            return (
              <circle
                className={`model-usage-donut-segment tone-${item.tone}${activeIndex === index ? ' active' : activeIndex !== null ? ' dimmed' : ''}`}
                key={item.label}
                cx="55"
                cy="55"
                r={radius}
                strokeDasharray={`${Math.max(0, length - segmentGap)} ${circumference - Math.max(0, length - segmentGap)}`}
                strokeDashoffset={-currentOffset}
                tabIndex={item.value > 0 ? 0 : -1}
                aria-label={`${item.label}，${formatTokens(item.value)} tokens，${total > 0 ? Math.round(item.value / total * 100) : 0}%`}
                onPointerEnter={() => setActiveIndex(index)}
                onFocus={() => setActiveIndex(index)}
                onBlur={() => setActiveIndex(null)}
              >
                <title>{item.label} · {formatTokens(item.value)} tokens</title>
              </circle>
            )
          })}
        </svg>
        <div className="model-usage-donut-center">
          <strong>{formatTokens(activeItem?.value ?? total)}</strong>
          <span>{activeItem?.label ?? centerLabel}</span>
        </div>
      </div>
      <div className="model-usage-chart-legend">
        {data.map((item, index) => (
          <button
            type="button"
            className={`model-usage-chart-legend-row${activeIndex === index ? ' active' : activeIndex !== null ? ' dimmed' : ''}`}
            key={item.label}
            onPointerEnter={() => setActiveIndex(index)}
            onFocus={() => setActiveIndex(index)}
            onBlur={() => setActiveIndex(null)}
          >
            <i className={`tone-${item.tone}`} />
            <span>{item.label}</span>
            <strong>{formatTokens(item.value)}</strong>
            <small>{total > 0 ? `${Math.round(item.value / total * 100)}%` : '0%'}</small>
          </button>
        ))}
      </div>
    </div>
  )
}

function ModelUsageAnalytics({ profile, onBack }: ModelUsageAnalyticsProps): React.ReactElement {
  const [range, setRange] = useState<ModelUsageRange>('30d')
  const [detail, setDetail] = useState<ModelUsageDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    window.api.settings.getModelUsageDetail(profile.id, range)
      .then((result) => {
        if (!cancelled) setDetail(result)
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : '无法读取模型用量')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [profile.id, range])

  const trend = useMemo(() => detail?.daily.slice(-30) || [], [detail])
  const tokenComposition = useMemo<DonutDatum[]>(() => [
    { label: '输入', value: detail?.totals.inputTokens ?? 0, tone: 'action' },
    { label: '输出', value: detail?.totals.outputTokens ?? 0, tone: 'accent' },
    { label: '缓存读取', value: detail?.totals.cacheReadInputTokens ?? 0, tone: 'success' },
    { label: '缓存写入', value: detail?.totals.cacheCreationInputTokens ?? 0, tone: 'warning' },
  ], [detail])
  const sourceDistribution = useMemo<DonutDatum[]>(() => {
    const totals = new Map<ModelUsageDetail['sessions'][number]['source'], number>()
    for (const session of detail?.sessions ?? []) {
      totals.set(session.source, (totals.get(session.source) ?? 0) + session.totalTokens)
    }
    const tones: DonutDatum['tone'][] = ['action', 'accent', 'success', 'warning']
    return (Object.entries(SOURCE_LABELS) as Array<[ModelUsageDetail['sessions'][number]['source'], string]>)
      .map(([source, label], index) => ({ label, value: totals.get(source) ?? 0, tone: tones[index] }))
  }, [detail])
  const maxSessionTokens = Math.max(1, ...(detail?.sessions.map((item) => item.totalTokens) || []))
  const maxSkillTokens = Math.max(1, ...(detail?.skills.map((item) => item.totalTokens) || []))

  return (
    <div className="model-usage-page">
      <div className="model-usage-toolbar">
        <button type="button" className="model-usage-back" onClick={onBack}>
          <ArrowLeft size={16} />
          返回模型配置
        </button>
        <div className="model-usage-range" role="group" aria-label="用量统计范围">
          {RANGE_OPTIONS.map((option) => (
            <button
              type="button"
              key={option.value}
              className={range === option.value ? 'active' : ''}
              onClick={() => setRange(option.value)}
              aria-pressed={range === option.value}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <section className="model-usage-identity" aria-label="当前分析模型">
        <div className="model-usage-identity-icon"><Activity size={19} /></div>
        <div>
          <div className="model-usage-identity-label">正在分析</div>
          <div className="model-usage-identity-name">{profile.name}</div>
          <div className="model-usage-identity-model">{profile.model}</div>
        </div>
        {detail?.recordingSince && (
          <div className="model-usage-recording-since">
            自 {formatDate(detail.recordingSince)} 起记录
          </div>
        )}
      </section>

      {loading && (
        <div className="model-usage-loading" role="status">
          <Loader2 size={18} />
          正在汇总用量…
        </div>
      )}

      {!loading && error && (
        <div className="model-usage-error" role="alert">{error}</div>
      )}

      {!loading && !error && detail && (
        <>
          <section className="model-usage-metrics" aria-label="用量总览">
            <div className="model-usage-metric model-usage-metric-primary">
              <BarChart3 size={16} />
              <span>总 Token</span>
              <strong>{formatTokens(detail.totals.totalTokens)}</strong>
              <small>{detail.totals.totalTokens.toLocaleString('zh-CN')} tokens</small>
            </div>
            <div className="model-usage-metric">
              <MessageSquareText size={16} />
              <span>输入 / 输出</span>
              <strong>{formatTokens(detail.totals.inputTokens)} / {formatTokens(detail.totals.outputTokens)}</strong>
              <small>上下文与生成内容</small>
            </div>
            <div className="model-usage-metric">
              <Database size={16} />
              <span>缓存读取 / 写入</span>
              <strong>{formatTokens(detail.totals.cacheReadInputTokens)} / {formatTokens(detail.totals.cacheCreationInputTokens)}</strong>
              <small>Prompt cache tokens</small>
            </div>
            <div className="model-usage-metric">
              <Sparkles size={16} />
              <span>请求 / 会话</span>
              <strong>{detail.totals.requestCount} / {detail.totals.sessionCount}</strong>
              <small>模型运行与任务数量</small>
            </div>
            <div className="model-usage-metric">
              <Coins size={16} />
              <span>预估费用</span>
              <strong>{formatCost(detail.totals.costUSD)}</strong>
              <small>由 SDK 依据模型价格估算</small>
            </div>
            <div className="model-usage-metric">
              <Layers3 size={16} />
              <span>思考 Token</span>
              <strong>{formatTokens(detail.totals.thinkingTokens)}</strong>
              <small>已包含在输出 Token 中</small>
            </div>
          </section>

          <div className="model-usage-visual-grid" aria-label="用量可视化图表">
            <section className="model-usage-section model-usage-chart-card-wide">
              <div className="model-usage-section-heading">
                <div>
                  <h3>用量趋势</h3>
                  <p>{trend.length > 0 ? `最近有调用记录的 ${trend.length} 天` : '选定范围内暂无调用'}</p>
                </div>
                <div className="model-usage-chart-summary">
                  <span><i className="tone-action" />Token</span>
                  <strong>{formatTokens(detail.totals.totalTokens)}</strong>
                </div>
              </div>
              <UsageTrendChart points={trend} />
            </section>

            <section className="model-usage-section model-usage-chart-card">
              <div className="model-usage-section-heading">
                <div>
                  <h3>Token 构成</h3>
                  <p>输入、输出与缓存占比</p>
                </div>
              </div>
              <UsageDonut data={tokenComposition} centerLabel="tokens" />
            </section>

            <section className="model-usage-section model-usage-chart-card">
              <div className="model-usage-section-heading">
                <div>
                  <h3>调用来源</h3>
                  <p>按 Token 汇总运行场景</p>
                </div>
              </div>
              <UsageDonut data={sourceDistribution} centerLabel="tokens" />
            </section>
          </div>

          {detail.totals.requestCount === 0 ? (
            <section className="model-usage-empty">
              <BarChart3 size={24} />
              <h3>还没有可分析的用量</h3>
              <p>从此版本开始，本地记录该模型配置的 Agent、自动化和行内改写用量。</p>
            </section>
          ) : (
            <>
              <div className="model-usage-rankings">
                <section className="model-usage-section">
                  <div className="model-usage-section-heading">
                    <div>
                      <h3>会话用量排行</h3>
                      <p>按总 Token 从高到低</p>
                    </div>
                  </div>
                  <div className="model-usage-ranking-list">
                    {detail.sessions.slice(0, 8).map((session, index) => (
                      <div className="model-usage-ranking-row" key={`${session.source}:${session.sessionId}`}>
                        <span className="model-usage-rank">{String(index + 1).padStart(2, '0')}</span>
                        <div className="model-usage-ranking-copy">
                          <div className="model-usage-ranking-title">
                            <span>{session.title}</span>
                            <strong>{formatTokens(session.totalTokens)}</strong>
                          </div>
                          <div className="model-usage-ranking-meta">
                            <span>{SOURCE_LABELS[session.source]} · {session.workspaceName}</span>
                            <span>{session.requestCount} 次</span>
                          </div>
                          <div className="model-usage-ranking-track"><i style={{ width: `${session.totalTokens / maxSessionTokens * 100}%` }} /></div>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="model-usage-section">
                  <div className="model-usage-section-heading">
                    <div>
                      <h3>Skill 用量</h3>
                      <p>多 Skill 任务按参与数量均分</p>
                    </div>
                  </div>
                  {detail.skills.length > 0 ? (
                    <div className="model-usage-ranking-list">
                      {detail.skills.slice(0, 8).map((skill, index) => (
                        <div className="model-usage-ranking-row" key={skill.skillId}>
                          <span className="model-usage-rank">{String(index + 1).padStart(2, '0')}</span>
                          <div className="model-usage-ranking-copy">
                            <div className="model-usage-ranking-title">
                              <span>{skill.skillId}</span>
                              <strong>{formatTokens(skill.totalTokens)}</strong>
                            </div>
                            <div className="model-usage-ranking-meta">
                              <span>{skill.sessionCount} 个会话</span>
                              <span>{skill.requestCount} 次参与</span>
                            </div>
                            <div className="model-usage-ranking-track"><i style={{ width: `${skill.totalTokens / maxSkillTokens * 100}%` }} /></div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="model-usage-section-empty">当前范围内没有 Skill 调用记录</div>
                  )}
                </section>
              </div>

              <section className="model-usage-section">
                <div className="model-usage-section-heading">
                  <div>
                    <h3>实际模型分布</h3>
                    <p>包含主模型、子任务与内部辅助调用</p>
                  </div>
                </div>
                <div className="model-usage-model-table">
                  <div className="model-usage-model-head">
                    <span>模型</span><span>输入</span><span>输出</span><span>缓存</span><span>总量</span><span>费用</span>
                  </div>
                  {detail.models.map((model) => (
                    <div className="model-usage-model-row" key={model.modelId}>
                      <span title={model.modelId}>{model.modelId}</span>
                      <span>{formatTokens(model.inputTokens)}</span>
                      <span>{formatTokens(model.outputTokens)}</span>
                      <span>{formatTokens(model.cacheReadInputTokens + model.cacheCreationInputTokens)}</span>
                      <strong>{formatTokens(model.totalTokens)}</strong>
                      <span>{formatCost(model.costUSD)}</span>
                    </div>
                  ))}
                </div>
              </section>
            </>
          )}

          <p className="model-usage-footnote">
            用量与费用均来自 Claude Agent SDK 的运行结果，仅供分析参考，不作为账单依据。数据保存在本机。
          </p>
        </>
      )}
    </div>
  )
}

export default ModelUsageAnalytics
