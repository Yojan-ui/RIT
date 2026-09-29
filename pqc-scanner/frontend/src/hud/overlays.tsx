import { useEffect, useRef, useState } from 'react'
import { useReducedMotion } from 'framer-motion'
import { hudAnchor, type HudMode } from './anchor'

const MODE_COLOR: Record<HudMode, string> = {
  idle: 'var(--hud-cyan)',
  scanning: 'var(--hud-cyan)',
  alert: 'var(--hud-amber)',
  critical: 'var(--hud-amber)',
  upgrading: 'var(--hud-cyan)',
  secure: 'var(--hud-green)',
}

/** Keep an element centred on the globe's projected screen position. */
function useAnchorFollow<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  useEffect(() => {
    let raf = 0
    const loop = () => {
      const el = ref.current
      if (el && hudAnchor.ready) {
        const d = hudAnchor.r * 1.5 // ring overlay extends to ~1.4× the globe radius
        el.style.transform = `translate(${hudAnchor.x - d}px, ${hudAnchor.y - d}px)`
        el.style.width = `${d * 2}px`
        el.style.height = `${d * 2}px`
        el.style.opacity = '1'
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [])
  return ref
}

// ── Concentric HUD rings, ticks, degree ticker, target label ──────────────────

export function HudRings({ mode, target, subline }: { mode: HudMode; target: string | null; subline: string | null }) {
  const ref = useAnchorFollow<HTMLDivElement>()
  const [deg, setDeg] = useState(0)
  const reduced = useReducedMotion()
  useEffect(() => {
    if (reduced) return
    const id = setInterval(() => setDeg((d) => (d + (mode === 'scanning' || mode === 'upgrading' ? 7.3 : 1.7)) % 360), 60)
    return () => clearInterval(id)
  }, [mode, reduced])
  const color = MODE_COLOR[mode]
  const ticks = Array.from({ length: 72 }, (_, i) => i)
  return (
    <div ref={ref} className="pointer-events-none fixed top-0 left-0 z-[5]" style={{ opacity: 0, color }} aria-hidden>
      <svg viewBox="-100 -100 200 200" className="absolute inset-0 h-full w-full overflow-visible">
        {/* outer tick ring */}
        <g className="hud-spin" style={{ ['--dur' as string]: '90s' }}>
          {ticks.map((i) => {
            const a = (i / 72) * Math.PI * 2
            const long = i % 6 === 0
            const r1 = long ? 88 : 91
            return <line key={i} x1={Math.cos(a) * r1} y1={Math.sin(a) * r1} x2={Math.cos(a) * 95} y2={Math.sin(a) * 95} stroke="currentColor" strokeWidth={long ? 0.6 : 0.3} opacity={long ? 0.8 : 0.45} />
          })}
        </g>
        {/* dashed data rings */}
        <circle r="82" fill="none" stroke="currentColor" strokeWidth="0.35" strokeDasharray="2 3" opacity="0.5" className="hud-spin rev" style={{ ['--dur' as string]: '60s' }} />
        <g className="hud-spin" style={{ ['--dur' as string]: '24s' }}>
          <circle r="76" fill="none" stroke="currentColor" strokeWidth="1.1" strokeDasharray="36 12 6 12 70 40" opacity="0.7" />
        </g>
        <g className="hud-spin rev" style={{ ['--dur' as string]: '14s' }}>
          <circle r="70" fill="none" stroke="currentColor" strokeWidth="0.4" strokeDasharray="1 4" opacity="0.6" />
        </g>
        {/* targeting brackets */}
        {[0, 90, 180, 270].map((r) => (
          <g key={r} transform={`rotate(${r})`}>
            <path d="M -60 -66 L -66 -66 L -66 -60" fill="none" stroke="currentColor" strokeWidth="1.2" opacity="0.9" />
          </g>
        ))}
        {/* crosshair */}
        <line x1="-100" y1="0" x2="-74" y2="0" stroke="currentColor" strokeWidth="0.35" opacity="0.6" />
        <line x1="74" y1="0" x2="100" y2="0" stroke="currentColor" strokeWidth="0.35" opacity="0.6" />
        <line x1="0" y1="-100" x2="0" y2="-74" stroke="currentColor" strokeWidth="0.35" opacity="0.6" />
        <line x1="0" y1="74" x2="0" y2="100" stroke="currentColor" strokeWidth="0.35" opacity="0.6" />
        {/* rotating bearing marker */}
        <g transform={`rotate(${deg})`}>
          <path d="M 0 -97 L 2.4 -101 L -2.4 -101 Z" fill="currentColor" />
        </g>
      </svg>
      <div className="absolute top-[3%] left-1/2 -translate-x-1/2 text-[11px] tracking-[0.3em] hud-glow">
        BRG {deg.toFixed(1).padStart(5, '0')}°
      </div>
      {target && (
        <div className="absolute bottom-[2%] left-1/2 -translate-x-1/2 text-center whitespace-nowrap">
          <div className={`text-[12px] font-bold tracking-[0.3em] hud-glow ${mode === 'critical' || mode === 'alert' ? 'hud-glitch' : ''}`}>[ TARGET ACQUIRED ]</div>
          <div className="mt-1 text-[11px] tracking-[0.18em] opacity-80">{target}</div>
          {subline && <div className="mt-0.5 text-[10px] tracking-[0.18em] opacity-60">{subline}</div>}
        </div>
      )}
    </div>
  )
}

// ── Tracking lines that lock onto [data-lock] elements ────────────────────────

interface Lock {
  key: string
  label: string
  x: number
  y: number
  w: number
  h: number
}

export function TrackingLayer({ active, color = 'var(--hud-amber)' }: { active: boolean; color?: string }) {
  const [locks, setLocks] = useState<Lock[]>([])
  const [anchor, setAnchor] = useState({ x: 0, y: 0, r: 0 })
  useEffect(() => {
    if (!active) {
      setLocks([])
      return
    }
    let raf = 0
    let last = 0
    const loop = (now: number) => {
      if (now - last > 50) {
        last = now
        const els = Array.from(document.querySelectorAll<HTMLElement>('[data-lock]'))
        const next = els.map((el) => {
          const r = el.getBoundingClientRect()
          return { key: el.dataset.lock!, label: el.dataset.lockLabel ?? el.dataset.lock!, x: r.left, y: r.top, w: r.width, h: r.height }
        })
        setLocks((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next))
        setAnchor((a) => (Math.abs(a.x - hudAnchor.x) + Math.abs(a.y - hudAnchor.y) + Math.abs(a.r - hudAnchor.r) < 1 ? a : { x: hudAnchor.x, y: hudAnchor.y, r: hudAnchor.r }))
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [active])
  if (!active || !locks.length || !anchor.r) return null
  return (
    <svg className="pointer-events-none fixed inset-0 z-[25] h-full w-full" style={{ color }} aria-hidden>
      {locks.map((l, i) => {
        // start on the globe's rim, facing the target
        const tx = l.x + l.w
        const ty = l.y + l.h / 2
        const ang = Math.atan2(ty - anchor.y, tx - anchor.x)
        const sx = anchor.x + Math.cos(ang) * anchor.r * 1.05
        const sy = anchor.y + Math.sin(ang) * anchor.r * 1.05
        const ex = tx + 10
        const labelW = 16 + l.label.length * 7.4 + 60
        const mx = ex + Math.max(24, (sx - ex) * 0.35)
        const pad = 6
        const c = 12
        const bx = l.x - pad
        const by = l.y - pad
        const bw = l.w + pad * 2
        const bh = l.h + pad * 2
        return (
          <g key={l.key}>
            <polyline
              className="hud-track-line"
              style={{ animationDelay: `${i * 0.18}s` }}
              points={`${sx},${sy} ${Math.max(mx, ex + labelW)},${ty + 18} ${ex + labelW},${ty + 18} ${ex},${ty + 18}`}
              fill="none"
              stroke="currentColor"
              strokeWidth="1.2"
              opacity="0.85"
            />
            <circle cx={sx} cy={sy} r="3" fill="currentColor" />
            <g className="hud-track-bracket" style={{ transformOrigin: `${bx + bw / 2}px ${by + bh / 2}px`, animationDelay: `${0.7 + i * 0.18}s` }}>
              <path d={`M ${bx} ${by + c} V ${by} H ${bx + c} M ${bx + bw - c} ${by} H ${bx + bw} V ${by + c} M ${bx + bw} ${by + bh - c} V ${by + bh} H ${bx + bw - c} M ${bx + c} ${by + bh} H ${bx} V ${by + bh - c}`} fill="none" stroke="currentColor" strokeWidth="2" />
              <text x={bx + bw + 10} y={by + 12} textAnchor="start" fill="currentColor" fontSize="10" letterSpacing="2" fontFamily="JetBrains Mono Variable, monospace">
                LOCK · {l.label}
              </text>
            </g>
          </g>
        )
      })}
    </svg>
  )
}

// ── Matrix scanner: falling code fragments ───────────────────────────────────

export function MatrixRain({ words, color = '#22e6ff' }: { words: string[]; color?: string }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const wordsRef = useRef(words)
  const colorRef = useRef(color)
  wordsRef.current = words
  colorRef.current = color
  const reduced = useReducedMotion()
  useEffect(() => {
    const canvas = ref.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx || reduced) return
    let raf = 0
    let last = 0
    const col = 120
    let drops: { x: number; y: number; v: number; w: string }[] = []
    const resize = () => {
      const dpr = Math.min(2, devicePixelRatio || 1)
      canvas.width = innerWidth * dpr
      canvas.height = innerHeight * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      drops = Array.from({ length: Math.ceil(innerWidth / col) }, (_, i) => ({ x: i * col + Math.random() * 40, y: Math.random() * innerHeight, v: 18 + Math.random() * 40, w: '' }))
    }
    resize()
    addEventListener('resize', resize)
    const pick = () => {
      const w = wordsRef.current
      return w[(Math.random() * w.length) | 0] ?? '0x00'
    }
    const loop = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000)
      if (now - last > 33) {
        last = now
        ctx.clearRect(0, 0, innerWidth, innerHeight)
        ctx.font = '11px "JetBrains Mono Variable", monospace'
        for (const d of drops) {
          d.y += d.v * dt * 3
          if (d.y > innerHeight + 200) {
            d.y = -40
            d.w = ''
          }
          if (!d.w) d.w = Array.from({ length: 6 }, pick).join(' ')
          const parts = d.w.split(' ')
          parts.forEach((p, k) => {
            ctx.globalAlpha = Math.max(0, 0.35 - k * 0.055)
            ctx.fillStyle = k === 0 ? '#ffffff' : colorRef.current
            ctx.fillText(p, d.x, d.y - k * 16)
          })
        }
        ctx.globalAlpha = 1
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => {
      cancelAnimationFrame(raf)
      removeEventListener('resize', resize)
    }
  }, [reduced])
  return <canvas ref={ref} className="pointer-events-none fixed inset-0 z-[1] opacity-40" aria-hidden />
}

// ── Telemetry cascade ────────────────────────────────────────────────────────

export interface TeleLine {
  text: string
  tone?: 'cyan' | 'amber' | 'green' | 'dim'
}

/** Cycles through `source` lines, appending one at a time like a live feed. */
export function TelemetryCascade({ source, rate = 520 }: { source: TeleLine[]; rate?: number }) {
  const [lines, setLines] = useState<(TeleLine & { id: number })[]>([])
  const idx = useRef(0)
  const id = useRef(0)
  const srcRef = useRef(source)
  srcRef.current = source
  useEffect(() => {
    idx.current = 0
    setLines([])
  }, [source.length, source[0]?.text])
  useEffect(() => {
    const t = setInterval(() => {
      const src = srcRef.current
      if (!src.length) return
      const next = src[idx.current % src.length]
      idx.current++
      setLines((l) => [...l.slice(-13), { ...next, id: id.current++ }])
    }, rate)
    return () => clearInterval(t)
  }, [rate])
  const tone = { cyan: 'hud-cyan', amber: 'hud-amber', green: 'hud-green', dim: 'hud-dim' }
  return (
    <div className="h-[220px] overflow-hidden text-[11px] leading-[16px]">
      {lines.map((l, i) => (
        <div key={l.id} className={`truncate ${tone[l.tone ?? 'cyan']}`} style={{ opacity: 0.35 + (i / Math.max(1, lines.length - 1)) * 0.65 }}>
          <span className="hud-dim">{String(l.id % 1000).padStart(3, '0')}</span> {l.text}
        </div>
      ))}
    </div>
  )
}

// ── Network ping sweep ───────────────────────────────────────────────────────

export function PingSweep({ blips, color }: { blips: { label: string; ok: boolean }[]; color: string }) {
  return (
    <svg viewBox="-50 -50 100 100" className="h-[120px] w-[120px]" style={{ color }} aria-hidden>
      {[46, 32, 18].map((r) => (
        <circle key={r} r={r} fill="none" stroke="currentColor" strokeWidth="0.5" opacity="0.4" />
      ))}
      <line x1="-46" y1="0" x2="46" y2="0" stroke="currentColor" strokeWidth="0.3" opacity="0.3" />
      <line x1="0" y1="-46" x2="0" y2="46" stroke="currentColor" strokeWidth="0.3" opacity="0.3" />
      <g className="hud-spin" style={{ ['--dur' as string]: '3s' }}>
        <path d="M 0 0 L 46 0 A 46 46 0 0 0 32.5 -32.5 Z" fill="currentColor" opacity="0.18" />
        <line x1="0" y1="0" x2="46" y2="0" stroke="currentColor" strokeWidth="1" />
      </g>
      {blips.map((b, i) => {
        const a = (i / Math.max(1, blips.length)) * Math.PI * 2 + 0.6
        const r = 24 + (i % 2) * 12
        return <circle key={b.label} cx={Math.cos(a) * r} cy={Math.sin(a) * r} r="2.6" fill={b.ok ? 'var(--hud-green)' : 'var(--hud-amber)'} className="hud-blink" style={{ animationDelay: `${i * 0.3}s` }} />
      })}
    </svg>
  )
}

// ── Bit pattern readout ──────────────────────────────────────────────────────

export function BitPattern({ bytes, color }: { bytes: string[]; color: string }) {
  const [hot, setHot] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setHot((h) => (h + 1) % Math.max(1, bytes.length)), 140)
    return () => clearInterval(t)
  }, [bytes.length])
  return (
    <div className="grid grid-cols-8 gap-x-2 gap-y-1 text-[11px]" style={{ color }}>
      {bytes.slice(0, 32).map((b, i) => (
        <span key={i} className={i === hot ? 'text-white hud-glow' : 'opacity-60'}>
          {b}
        </span>
      ))}
    </div>
  )
}
