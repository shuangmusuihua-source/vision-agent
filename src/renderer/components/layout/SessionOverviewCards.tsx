import { useState, useEffect, useCallback } from 'react'
import { Check, Loader2 } from 'lucide-react'
import { useAgentStore } from '../../store/agent-store-impl'

interface OverviewCard {
  id: string
  text: string
  type: 'todo' | 'memo' | 'decision'
  done: boolean
  createdAt: number
}

interface SessionOverviewCardsProps {
  sessionId: string | null
}

const TYPE_CONFIG: Record<string, { label: string; icon: string }> = {
  todo: { label: '待办', icon: '📋' },
  memo: { label: '备忘', icon: '💡' },
  decision: { label: '决策', icon: '✅' },
}

export default function SessionOverviewCards({ sessionId }: SessionOverviewCardsProps) {
  const [cards, setCards] = useState<OverviewCard[]>([])
  const [loading, setLoading] = useState(false)
  const activeWorkspacePath = useAgentStore((s) => s.activeWorkspacePath)

  const overviewPath = activeWorkspacePath && sessionId
    ? `${activeWorkspacePath}/.vision/session-overviews/${sessionId}.json`
    : null

  const loadCards = useCallback(async () => {
    if (!overviewPath) return
    setLoading(true)
    try {
      const result = await window.api.workspace.readFile(overviewPath)
      if (result.success && result.content) {
        const data = JSON.parse(result.content)
        setCards(data.cards || [])
      }
    } catch {
      setCards([])
    } finally {
      setLoading(false)
    }
  }, [overviewPath])

  useEffect(() => {
    loadCards()
  }, [loadCards])

  const toggleDone = useCallback(async (cardId: string) => {
    if (!overviewPath) return
    const updated = cards.map(c => c.id === cardId ? { ...c, done: !c.done } : c)
    setCards(updated)
    try {
      await window.api.workspace.writeFile(overviewPath, JSON.stringify({ cards: updated }, null, 2))
    } catch {
      // Revert on failure
      setCards(cards)
    }
  }, [cards, overviewPath])

  if (loading) return <Loader2 size={16} className="overview-loading" />

  const activeCards = cards.filter(c => !c.done)
  const doneCards = cards.filter(c => c.done)

  if (cards.length === 0) return null

  const renderCard = (card: OverviewCard) => (
    <div
      key={card.id}
      className={`overview-card overview-card--${card.type}${card.done ? ' overview-card--done' : ''}`}
    >
      <button
        className={`overview-card-check${card.done ? ' overview-card-check--done' : ''}`}
        onClick={() => toggleDone(card.id)}
        title={card.done ? '标记未完成' : '标记完成'}
      >
        {card.done && <Check size={12} />}
      </button>
      <span className="overview-card-type">{TYPE_CONFIG[card.type]?.icon}</span>
      <span className="overview-card-text">{card.text}</span>
    </div>
  )

  return (
    <div className="overview-section">
      <h3 className="overview-section-title">会话概览</h3>
      <div className="overview-card-list">
        {activeCards.map(renderCard)}
        {doneCards.length > 0 && (
          <>
            <div className="overview-card-divider">已完成</div>
            {doneCards.map(renderCard)}
          </>
        )}
      </div>
    </div>
  )
}
