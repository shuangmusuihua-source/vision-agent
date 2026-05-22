import { useEffect, useCallback } from 'react'

interface DaydreamOverlayProps {
  onExit: () => void
}

const DIGITS = Array.from({ length: 36 }, (_, i) => ({
  key: i,
  value: Math.random() > 0.5 ? '1' : '0',
  delay: (i * 0.15) % 3.6
}))

function DaydreamOverlay({ onExit }: DaydreamOverlayProps): React.ReactElement {
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onExit()
  }, [onExit])

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  // Periodically shuffle digit values
  useEffect(() => {
    const interval = setInterval(() => {
      const digits = document.querySelectorAll('.matrix-digit')
      digits.forEach((d) => {
        if (Math.random() > 0.7) {
          d.textContent = Math.random() > 0.5 ? '1' : '0'
        }
      })
    }, 800)
    return () => clearInterval(interval)
  }, [])

  return (
    <div className="daydream-overlay" onClick={onExit}>
      <div className="daydream-hint">点击任意位置或按 Esc 退出</div>
      <div className="ai-matrix-loader">
        {DIGITS.map((d) => (
          <div
            key={d.key}
            className="matrix-digit"
            style={{ animationDelay: `${d.delay}s` }}
          >
            {d.value}
          </div>
        ))}
        <div className="matrix-glow" />
      </div>
    </div>
  )
}

export default DaydreamOverlay