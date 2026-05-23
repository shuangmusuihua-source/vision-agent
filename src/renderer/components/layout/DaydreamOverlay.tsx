import { useState, useEffect, useCallback, useRef } from 'react'

interface DaydreamOverlayProps {
  onExit: () => void
  mode: string
}

interface Star {
  x: number
  y: number
  size: number
  opacity: number
  speed: number
}

interface MatrixDigit {
  col: number
  row: number
  value: number
  phase: number        // 0-1 animation progress
  cycleSpeed: number   // how fast one fall cycle completes
  flickerPhase: number
}

// ─── Starfield ──────────────────────────────────────────────────────

function initStars(count: number, width: number, height: number, sizeRange: [number, number], speedRange: [number, number]): Star[] {
  return Array.from({ length: count }, () => ({
    x: Math.random() * width,
    y: Math.random() * height,
    size: sizeRange[0] + Math.random() * (sizeRange[1] - sizeRange[0]),
    opacity: 0.4 + Math.random() * 0.6,
    speed: speedRange[0] + Math.random() * (speedRange[1] - speedRange[0]),
  }))
}

function StarfieldCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let w = window.innerWidth
    let h = window.innerHeight
    canvas.width = w
    canvas.height = h

    const allStars = [
      ...initStars(200, w, h, [0.5, 1.2], [0.15, 0.4]),
      ...initStars(80, w, h, [1.2, 2], [0.3, 0.6]),
      ...initStars(30, w, h, [2, 3], [0.5, 0.9]),
    ]

    let raf: number
    function draw() {
      ctx.clearRect(0, 0, w, h)
      for (const s of allStars) {
        ctx.beginPath()
        ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(255,255,255,${s.opacity})`
        ctx.fill()
        s.y -= s.speed
        if (s.y < -s.size) { s.y = h + s.size; s.x = Math.random() * w }
      }
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)

    const onResize = () => { w = window.innerWidth; h = window.innerHeight; canvas.width = w; canvas.height = h }
    window.addEventListener('resize', onResize)
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', onResize) }
  }, [])

  return <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0 }} />
}

// ─── Matrix rain ────────────────────────────────────────────────────

function MatrixCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let w = window.innerWidth
    let h = window.innerHeight
    canvas.width = w
    canvas.height = h

    const COLS = 6
    const CELL_SIZE = 50
    const GRID_W = COLS * CELL_SIZE
    const GRID_H = 6 * CELL_SIZE
    const OFFSET_X = (w - GRID_W) / 2
    const OFFSET_Y = (h - GRID_H) / 2
    const FONT_SIZE = 22
    const GREEN = '#00ff88'
    const GREEN_GLOW = 'rgba(0,255,136,0.3)'

    // Init digits
    const digits: MatrixDigit[] = []
    for (let row = 0; row < 6; row++) {
      for (let col = 0; col < COLS; col++) {
        digits.push({
          col, row,
          value: Math.random() > 0.5 ? 1 : 0,
          phase: (row * 0.15 + col * 0.1) % 1, // staggered start
          cycleSpeed: 0.004 + Math.random() * 0.002,
          flickerPhase: Math.random() * Math.PI * 2,
        })
      }
    }

    let time = 0
    let raf: number

    // Shuffle values periodically
    const shuffleInterval = setInterval(() => {
      for (const d of digits) {
        if (Math.random() > 0.7) d.value = Math.random() > 0.5 ? 1 : 0
      }
    }, 800)

    function draw() {
      ctx.clearRect(0, 0, w, h)

      // Glow at center
      const glowRadius = 160
      const pulse = 0.3 + 0.4 * (0.5 + 0.5 * Math.sin(time * 0.03))
      const grad = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, glowRadius)
      grad.addColorStop(0, `rgba(0,255,136,${pulse * 0.12})`)
      grad.addColorStop(1, 'rgba(0,255,136,0)')
      ctx.fillStyle = grad
      ctx.fillRect(w / 2 - glowRadius, h / 2 - glowRadius, glowRadius * 2, glowRadius * 2)

      // Draw each digit
      ctx.font = `${FONT_SIZE}px monospace`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'

      for (const d of digits) {
        const x = OFFSET_X + d.col * CELL_SIZE + CELL_SIZE / 2
        const baseY = OFFSET_Y + d.row * CELL_SIZE + CELL_SIZE / 2

        // Advance phase
        d.phase += d.cycleSpeed
        if (d.phase >= 1) d.phase -= 1

        // Fall animation with 3D rotateX simulation
        let translateY = 0
        let opacity = 0
        let scaleY = 1
        const p = d.phase
        if (p < 0.2) {
          const enterP = p / 0.2
          translateY = -50 * (1 - enterP)
          opacity = enterP * 0.8
          scaleY = Math.abs(Math.cos(enterP * Math.PI / 2)) // 0→1 simulates rotateX 90°→0°
        } else if (p < 0.8) {
          translateY = 0
          opacity = 0.8
          scaleY = 1
        } else {
          const exitP = (p - 0.8) / 0.2
          translateY = 50 * exitP
          opacity = 0.8 * (1 - exitP)
          scaleY = Math.abs(Math.cos(exitP * Math.PI / 2)) // 1→0 simulates rotateX 0°→-90°
        }

        // Flicker: 20% dip every cycle
        const flicker = Math.sin(d.flickerPhase + time * 0.04)
        if (flicker > 0.8) opacity *= 0.25

        if (opacity < 0.01 || scaleY < 0.05) continue

        const y = baseY + translateY

        // Apply 3D perspective: compress vertically via scaleY
        ctx.save()
        ctx.translate(x, y)
        ctx.scale(1, scaleY)

        // Glow text shadow
        ctx.shadowColor = GREEN
        ctx.shadowBlur = 8
        ctx.fillStyle = `rgba(0,255,136,${opacity})`
        ctx.fillText(String(d.value), 0, 0)

        // Second pass for wider glow
        ctx.shadowBlur = 20
        ctx.shadowColor = GREEN_GLOW
        ctx.fillStyle = `rgba(0,255,136,${opacity * 0.3})`
        ctx.fillText(String(d.value), 0, 0)

        ctx.restore()
      }

      time++
      raf = requestAnimationFrame(draw)
    }

    raf = requestAnimationFrame(draw)

    const onResize = () => { w = window.innerWidth; h = window.innerHeight; canvas.width = w; canvas.height = h }
    window.addEventListener('resize', onResize)

    return () => {
      cancelAnimationFrame(raf)
      clearInterval(shuffleInterval)
      window.removeEventListener('resize', onResize)
    }
  }, [])

  return <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0 }} />
}

// ─── Math symbol matrix ─────────────────────────────────────────────

const MATH_SYMBOLS = [
  '+','−','×','÷','=','≠','≈','∞','√','∑',
  '∏','∫','∂','∆','π','θ','λ','μ','σ','ω',
  'α','β','γ','δ','ε','ζ','η','ι','κ','ν',
  'ξ','ρ','τ','φ','χ','ψ','∈','∉','∩','∪',
  '⊂','⊃','⊆','⊇','∧','∨','¬','⇒','⇔','∀',
  '∃','ℕ','ℤ','ℚ','ℝ','ℂ','|','∥','∠','⊥',
  '≅','∝','∴','∵','⊕','⊗','⊢','⊨','∇',
]

interface MathCell {
  col: number
  row: number
  symbol: string
  pulsePhase: number
  pulseSpeed: number
  isBright: boolean  // some cells use brighter base color
}

function MathCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let w = window.innerWidth
    let h = window.innerHeight
    canvas.width = w
    canvas.height = h

    const CELL = 44
    const FONT_SIZE = 28
    const cols = Math.ceil(w / CELL)
    const rows = Math.ceil(h / CELL)
    const OFFSET_X = (w - cols * CELL) / 2
    const OFFSET_Y = (h - rows * CELL) / 2

    const cells: MathCell[] = []
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const idx = row * cols + col
        cells.push({
          col,
          row,
          symbol: MATH_SYMBOLS[Math.floor(Math.random() * MATH_SYMBOLS.length)],
          pulsePhase: Math.random() * Math.PI * 2,
          pulseSpeed: 0.008 + Math.random() * 0.012,
          isBright: idx % 11 === 0,  // ~1/11 cells use brighter base
        })
      }
    }

    let time = 0
    let raf: number

    // Periodically shuffle some symbols
    const shuffleInterval = setInterval(() => {
      for (const c of cells) {
        if (Math.random() > 0.85) {
          c.symbol = MATH_SYMBOLS[Math.floor(Math.random() * MATH_SYMBOLS.length)]
        }
      }
    }, 2000)

    function draw() {
      ctx.clearRect(0, 0, w, h)

      ctx.font = `${FONT_SIZE}px "Courier New", Courier, monospace`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'

      for (const c of cells) {
        const x = OFFSET_X + c.col * CELL + CELL / 2
        const y = OFFSET_Y + c.row * CELL + CELL / 2

        // Advance phase
        c.pulsePhase += c.pulseSpeed

        // smooth-pulse: 0→0.3→0.5→0.7→1.0 maps to blue→bright-blue→pink→white→blue
        const p = (Math.sin(c.pulsePhase) + 1) / 2  // 0-1 oscillation
        let r: number, g: number, b: number, a: number
        let glowBlur = 0
        let glowR = 0, glowG = 0, glowB = 0

        if (p < 0.3) {
          // Base blue state
          const t = p / 0.3
          r = lerp(0, 100, t)
          g = lerp(150, 200, t)
          b = 255
          a = lerp(0.4, 1, t)
          glowBlur = lerp(5, 10, t)
          glowR = lerp(0, 100, t); glowG = lerp(150, 200, t); glowB = 255
        } else if (p < 0.5) {
          // Bright blue → pink
          const t = (p - 0.3) / 0.2
          r = lerp(100, 255, t)
          g = lerp(200, 105, t)
          b = lerp(255, 180, t)
          a = 1
          glowBlur = lerp(10, 15, t)
          glowR = lerp(100, 255, t); glowG = lerp(200, 105, t); glowB = lerp(255, 180, t)
        } else if (p < 0.7) {
          // Pink → white
          const t = (p - 0.5) / 0.2
          r = 255
          g = lerp(105, 255, t)
          b = lerp(180, 255, t)
          a = 1
          glowBlur = lerp(15, 20, t)
          glowR = 255; glowG = lerp(105, 255, t); glowB = lerp(180, 255, t)
        } else {
          // White → back to blue
          const t = (p - 0.7) / 0.3
          r = lerp(255, 0, t)
          g = lerp(255, 150, t)
          b = 255
          a = lerp(1, 0.4, t)
          glowBlur = lerp(20, 5, t)
          glowR = lerp(255, 0, t); glowG = lerp(255, 150, t); glowB = 255
        }

        // Bright cells have higher base opacity
        const baseOpacity = c.isBright ? 0.7 : 0.4
        const finalA = c.isBright ? Math.max(a, baseOpacity) : a

        // Glow
        ctx.shadowColor = `rgba(${Math.round(glowR)},${Math.round(glowG)},${Math.round(glowB)},${finalA})`
        ctx.shadowBlur = glowBlur
        ctx.fillStyle = `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${finalA})`
        ctx.fillText(c.symbol, x, y)
        ctx.shadowBlur = 0
        ctx.shadowColor = 'transparent'
      }

      time++
      raf = requestAnimationFrame(draw)
    }

    raf = requestAnimationFrame(draw)

    const onResize = () => { w = window.innerWidth; h = window.innerHeight; canvas.width = w; canvas.height = h }
    window.addEventListener('resize', onResize)

    return () => {
      cancelAnimationFrame(raf)
      clearInterval(shuffleInterval)
      window.removeEventListener('resize', onResize)
    }
  }, [])

  return <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0 }} />
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

// ─── Rain ───────────────────────────────────────────────────────────

interface RainDrop {
  x: number
  y: number
  speed: number
  length: number
  opacity: number
  width: number
}

interface RainSplash {
  x: number
  y: number
  radius: number
  opacity: number
  maxRadius: number
}

function RainCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let w = window.innerWidth
    let h = window.innerHeight
    canvas.width = w
    canvas.height = h

    const TILT = -0.3  // slight leftward tilt (radians, matches -45deg feel at smaller angle)
    const drops: RainDrop[] = []
    const splashes: RainSplash[] = []

    // Initialize drops
    function initDrops() {
      drops.length = 0
      const count = Math.floor(w * h / 3000)  // density based on screen size
      for (let i = 0; i < count; i++) {
        drops.push(createDrop(true))
      }
    }

    function createDrop(randomY: boolean): RainDrop {
      const layer = Math.random()
      return {
        x: Math.random() * (w + 200) - 100,
        y: randomY ? Math.random() * h : -Math.random() * 100,
        speed: layer < 0.3 ? 2 + Math.random() * 2 : layer < 0.7 ? 4 + Math.random() * 3 : 7 + Math.random() * 4,
        length: layer < 0.3 ? 8 + Math.random() * 10 : layer < 0.7 ? 15 + Math.random() * 15 : 20 + Math.random() * 20,
        opacity: layer < 0.3 ? 0.08 + Math.random() * 0.07 : layer < 0.7 ? 0.15 + Math.random() * 0.1 : 0.2 + Math.random() * 0.15,
        width: layer < 0.3 ? 0.5 : layer < 0.7 ? 1 : 1 + Math.random() * 0.5,
      }
    }

    initDrops()

    let raf: number

    function draw() {
      ctx.clearRect(0, 0, w, h)

      // Draw drops
      for (const d of drops) {
        const dx = Math.sin(TILT) * d.length
        const dy = Math.cos(TILT) * d.length

        ctx.beginPath()
        ctx.moveTo(d.x, d.y)
        ctx.lineTo(d.x + dx, d.y + dy)

        // Bright head, fading tail
        const grad = ctx.createLinearGradient(d.x, d.y, d.x + dx, d.y + dy)
        grad.addColorStop(0, `rgba(0,255,0,0)`)
        grad.addColorStop(0.7, `rgba(0,255,0,${d.opacity * 0.5})`)
        grad.addColorStop(1, `rgba(100,255,100,${d.opacity})`)

        ctx.strokeStyle = grad
        ctx.lineWidth = d.width
        ctx.stroke()

        // Advance
        d.x += Math.sin(TILT) * d.speed
        d.y += Math.cos(TILT) * d.speed

        // Reset when off-screen
        if (d.y > h + 20) {
          // Spawn splash at bottom
          if (Math.random() > 0.6) {
            splashes.push({
              x: d.x + dx,
              y: h - Math.random() * 5,
              radius: 0,
              opacity: d.opacity * 0.8,
              maxRadius: 2 + Math.random() * 3,
            })
          }
          Object.assign(d, createDrop(false))
        }
      }

      // Draw splashes
      for (let i = splashes.length - 1; i >= 0; i--) {
        const s = splashes[i]
        ctx.beginPath()
        ctx.arc(s.x, s.y, s.radius, 0, Math.PI * 2)
        ctx.strokeStyle = `rgba(0,255,0,${s.opacity})`
        ctx.lineWidth = 0.5
        ctx.stroke()

        s.radius += 0.3
        s.opacity -= 0.02

        if (s.opacity <= 0 || s.radius >= s.maxRadius) {
          splashes.splice(i, 1)
        }
      }

      raf = requestAnimationFrame(draw)
    }

    raf = requestAnimationFrame(draw)

    const onResize = () => {
      w = window.innerWidth
      h = window.innerHeight
      canvas.width = w
      canvas.height = h
      initDrops()
    }
    window.addEventListener('resize', onResize)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', onResize)
    }
  }, [])

  return <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0 }} />
}

// ─── Overlay ────────────────────────────────────────────────────────

function DaydreamOverlay({ onExit, mode }: DaydreamOverlayProps): React.ReactElement {
  const [showHint, setShowHint] = useState(true)

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onExit()
  }, [onExit])

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  useEffect(() => {
    const timer = setTimeout(() => setShowHint(false), 10000)
    return () => clearTimeout(timer)
  }, [])

  const hintClass = showHint ? 'daydream-hint' : 'daydream-hint daydream-hint-fadeout'

  if (mode === 'starfield') {
    return (
      <div className="daydream-overlay daydream-starfield" onClick={onExit}>
        <div className={`${hintClass} daydream-hint-starfield`}>点击任意位置或按 Esc 退出</div>
        <StarfieldCanvas />
      </div>
    )
  }

  if (mode === 'math') {
    return (
      <div className="daydream-overlay daydream-math" onClick={onExit}>
        <div className={`${hintClass} daydream-hint-math`}>点击任意位置或按 Esc 退出</div>
        <MathCanvas />
      </div>
    )
  }

  if (mode === 'rain') {
    return (
      <div className="daydream-overlay daydream-rain" onClick={onExit}>
        <div className={`${hintClass} daydream-hint-rain`}>点击任意位置或按 Esc 退出</div>
        <RainCanvas />
      </div>
    )
  }

  return (
    <div className="daydream-overlay" onClick={onExit}>
      <div className={hintClass}>点击任意位置或按 Esc 退出</div>
      <MatrixCanvas />
    </div>
  )
}

export default DaydreamOverlay