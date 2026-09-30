import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { hudAnchor, viewportOrigin, type HoloNode } from './anchor'

const NODE_HEX = { warn: '#f97316', crit: '#ef4444', ok: '#10b981' } as const

/** rAF loop that only runs while mounted. */
function useFrameLoop(fn: () => void) {
  const ref = useRef(fn)
  useLayoutEffect(() => {
    ref.current = fn
  })
  useEffect(() => {
    let raf = 0
    const loop = () => {
      ref.current()
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [])
}

// ── Hairline ring chrome registered to the hologram ──────────────────────────

export function HudRings({ target, index, total, dim = 1 }: { target: string | null; index: number; total: number; dim?: number }) {
  const box = useRef<HTMLDivElement>(null)
  const brg = useRef<HTMLSpanElement>(null)
  const marker = useRef<SVGGElement>(null)
  useFrameLoop(() => {
    const el = box.current
    if (!el || !hudAnchor.ready) return
    const d = hudAnchor.r * 1.75
    el.style.transform = `translate(${hudAnchor.x - d}px, ${hudAnchor.y - d}px)`
    el.style.width = el.style.height = `${d * 2}px`
    el.style.opacity = String(dim)
    const deg = hudAnchor.rotationDeg
    if (brg.current) brg.current.textContent = deg.toFixed(1).padStart(5, '0')
    marker.current?.setAttribute('transform', `rotate(${deg})`)
  })
  const ticks = Array.from({ length: 180 }, (_, i) => i * 2)
  return (
    <div ref={box} className="pointer-events-none absolute top-0 left-0 z-[5] transition-opacity duration-700" style={{ opacity: 0 }} aria-hidden>
      <svg viewBox="-100 -100 200 200" className="absolute inset-0 h-full w-full overflow-visible">
        <g stroke="#577c95" strokeWidth="0.18">
          {ticks.map((d) => {
            const a = ((d - 90) * Math.PI) / 180
            const r0 = d % 30 === 0 ? 90.5 : d % 10 === 0 ? 92 : 93
            return <line key={d} x1={Math.cos(a) * r0} y1={Math.sin(a) * r0} x2={Math.cos(a) * 94.5} y2={Math.sin(a) * 94.5} opacity={d % 30 === 0 ? 0.9 : 0.45} />
          })}
        </g>
        {[0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330].map((d) => {
          const a = ((d - 90) * Math.PI) / 180
          return (
            <text key={d} x={Math.cos(a) * 98} y={Math.sin(a) * 98 + 1} textAnchor="middle" fontSize="2.4" fill="#6b7785" fontFamily="Inter Variable, system-ui, sans-serif">
              {String(d).padStart(3, '0')}
            </text>
          )
        })}
        <circle r="86" fill="none" stroke="#4b5563" strokeWidth="0.15" strokeDasharray="0.6 1.4" />
        <g ref={marker}>
          <path d="M 0 -89.5 L 1.1 -87.6 L -1.1 -87.6 Z" fill="#67e8f9" />
        </g>
        {/* 90° corner brackets */}
        {[0, 90, 180, 270].map((r) => (
          <path key={r} transform={`rotate(${r})`} d="M -70 -64 V -70 H -64" fill="none" stroke="#ffffff" strokeWidth="0.25" opacity="0.55" />
        ))}
        <line x1="-100" y1="0" x2="-95" y2="0" stroke="#ffffff" strokeWidth="0.2" opacity="0.5" />
        <line x1="95" y1="0" x2="100" y2="0" stroke="#ffffff" strokeWidth="0.2" opacity="0.5" />
      </svg>
      <div className={`hud-k absolute top-[8.5%] left-1/2 -translate-x-1/2 whitespace-nowrap ${dim < 1 ? 'hidden' : 'hidden lg:block'}`}>
        ROT <span ref={brg} className="hud-ice">000.0</span>°
      </div>
      {target && (
        <div className="hidden lg:block absolute bottom-[-7%] left-1/2 -translate-x-1/2 text-center whitespace-nowrap">
          <div className="hud-k">
            target {String(index).padStart(2, '0')}/{String(total).padStart(2, '0')}
          </div>
          <div className="hud-white text-[11px]">{target}</div>
        </div>
      )}
    </div>
  )
}

// ── Node crosshairs + coordinates, following the hologram nodes ──────────────

export function NodeMarkers({ nodes }: { nodes: HoloNode[] }) {
  const refs = useRef<Record<string, HTMLDivElement | null>>({})
  const coords = useRef<Record<string, HTMLSpanElement | null>>({})
  useFrameLoop(() => {
    for (const n of hudAnchor.nodes) {
      const el = refs.current[n.id]
      if (!el) continue
      el.style.transform = `translate(${n.x}px, ${n.y}px)`
      el.style.opacity = n.visible ? '1' : '0.15'
      const c = coords.current[n.id]
      if (c) c.textContent = `AZ ${n.az.toFixed(1).padStart(5, '0')}  EL ${n.el >= 0 ? '+' : '-'}${Math.abs(n.el).toFixed(1).padStart(4, '0')}`
    }
  })
  return (
    <div className="pointer-events-none absolute inset-0 z-[6]" aria-hidden>
      {nodes.map((n, i) => (
        <div key={n.id} ref={(el) => { refs.current[n.id] = el }} className="absolute top-0 left-0" style={{ opacity: 0, color: NODE_HEX[n.state] }}>
          <svg width="15" height="15" viewBox="-7.5 -7.5 15 15" className="absolute -top-[7.5px] -left-[7.5px] overflow-visible">
            <path d="M -7 -3 V -7 H -3 M 3 -7 H 7 V -3 M 7 3 V 7 H 3 M -3 7 H -7 V 3" fill="none" stroke="currentColor" strokeWidth="1" />
            <path d="M -1.5 0 H 1.5 M 0 -1.5 V 1.5" stroke="currentColor" strokeWidth="1" />
          </svg>
          <div className="absolute top-[-6px] left-[12px] whitespace-nowrap text-[10px] leading-[12px]">
            <span className="hud-white">N{String(i + 1).padStart(2, '0')}</span> <span>{n.label}</span>
            <br />
            <span ref={(el) => { coords.current[n.id] = el }} className="hud-dim" />
          </div>
        </div>
      ))}
    </div>
  )
}

// ── 1px tracking lines from hologram node → page element [data-lock=id] ──────

interface Seg {
  id: string
  sx: number
  sy: number
  x: number
  y: number
  w: number
  h: number
  color: string
}

export function TrackingLayer({ nodes, active }: { nodes: HoloNode[]; active: boolean }) {
  const [segs, setSegs] = useState<Seg[]>([])
  const last = useRef('')
  useFrameLoop(() => {
    if (!active) {
      if (last.current) {
        last.current = ''
        setSegs([])
      }
      return
    }
    const next: Seg[] = []
    const o = viewportOrigin() // node positions are viewport-relative; the rows are anywhere on the page
    for (const n of nodes) {
      const el = document.querySelector<HTMLElement>(`[data-lock="${CSS.escape(n.id)}"]`)
      const s = hudAnchor.nodes.find((h) => h.id === n.id)
      if (!el || !s) continue
      const r = el.getBoundingClientRect()
      next.push({ id: n.id, sx: Math.round(s.x + o.x), sy: Math.round(s.y + o.y), x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), color: NODE_HEX[n.state] })
    }
    const key = JSON.stringify(next)
    if (key !== last.current) {
      last.current = key
      setSegs(next)
    }
  })
  if (!active || !segs.length) return null
  return (
    <svg className="pointer-events-none fixed inset-0 z-[25] h-full w-full" aria-hidden>
      {segs.map((s, i) => {
        const tx = s.x + s.w + 4
        const ty = s.y + s.h / 2
        const elbow = tx + 28 + i * 10
        const c = 6
        const bx = s.x - 3
        const by = s.y - 3
        const bw = s.w + 6
        const bh = s.h + 6
        return (
          <g key={s.id} style={{ color: s.color }}>
            <polyline className="hud-track" points={`${s.sx},${s.sy} ${elbow},${ty} ${tx},${ty}`} fill="none" stroke="currentColor" strokeWidth="1" opacity="0.8" />
            <g className="hud-fade">
              <path d={`M ${bx} ${by + c} V ${by} H ${bx + c} M ${bx + bw - c} ${by} H ${bx + bw} V ${by + c} M ${bx + bw} ${by + bh - c} V ${by + bh} H ${bx + bw - c} M ${bx + c} ${by + bh} H ${bx} V ${by + bh - c}`} fill="none" stroke="currentColor" strokeWidth="1" />
              <rect x={tx - 2} y={ty - 2} width="4" height="4" fill="currentColor" />
            </g>
          </g>
        )
      })}
    </svg>
  )
}

// ── Event log: one line per real state change ────────────────────────────────

export interface HudEvent {
  id: number
  t: string // HH:MM:SS.mmm
  tag: string
  text: string
  tone?: 'ice' | 'warn' | 'crit' | 'ok' | 'dim'
}

export function EventLog({ events }: { events: HudEvent[] }) {
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    box.current?.scrollTo({ top: box.current.scrollHeight })
  }, [events.length])
  const tone = { ice: 'hud-ice', warn: 'hud-warn', crit: 'hud-crit', ok: 'hud-ok', dim: 'hud-dim' }
  return (
    <div ref={box} className="hud-scroll h-[252px] overflow-y-auto pr-1 text-[10px] leading-[14px]">
      {events.length === 0 && <div className="hud-dim">no events · designate a target</div>}
      {events.map((e) => (
        <motion.div key={e.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.25 }} className="grid grid-cols-[76px_40px_1fr] gap-x-1.5">
          <span className="hud-dim">{e.t}</span>
          <span className="hud-steel">{e.tag}</span>
          <span className={`truncate ${tone[e.tone ?? 'ice']}`} title={e.text}>
            {e.text}
          </span>
        </motion.div>
      ))}
    </div>
  )
}

// ── Fine gauges ──────────────────────────────────────────────────────────────

/** 0-100 CWM arc: 1px track, tick every 5, bands at 40 / 70, thin needle. */
export function CwmGauge({ score, severity }: { score: number; severity: 'Low' | 'High' | 'CRITICAL' }) {
  const r = 70
  const pt = (v: number, rad = r) => {
    const a = Math.PI * (1 - v / 100)
    return [Math.cos(a) * rad, -Math.sin(a) * rad] as const
  }
  const arc = (a: number, b: number, rad = r) => {
    const [x1, y1] = pt(a, rad)
    const [x2, y2] = pt(b, rad)
    return `M ${x1} ${y1} A ${rad} ${rad} 0 0 1 ${x2} ${y2}`
  }
  const color = severity === 'CRITICAL' ? '#ef4444' : severity === 'High' ? '#f97316' : '#10b981'
  const [nx, ny] = pt(Math.min(100, score), r - 6)
  return (
    <svg viewBox="-86 -82 172 96" className="w-full max-w-[260px]" role="img" aria-label={`CWM ${score} of 100, ${severity}`}>
      <path d={arc(0, 100)} fill="none" stroke="#4b5563" strokeWidth="0.75" />
      <path d={arc(40, 70, r + 3)} fill="none" stroke="#f97316" strokeWidth="0.75" opacity="0.6" />
      <path d={arc(70, 100, r + 3)} fill="none" stroke="#ef4444" strokeWidth="0.75" opacity="0.7" />
      {Array.from({ length: 21 }, (_, i) => i * 5).map((v) => {
        const [x1, y1] = pt(v, r)
        const [x2, y2] = pt(v, v % 25 === 0 ? r - 6 : r - 3)
        return <line key={v} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#577c95" strokeWidth={v % 25 === 0 ? 0.8 : 0.5} />
      })}
      {[0, 25, 50, 75, 100].map((v) => {
        const [x, y] = pt(v, r + 10)
        return <text key={v} x={x} y={y + 2} textAnchor="middle" fontSize="6" fill="#6b7785" fontFamily="Inter Variable, system-ui, sans-serif">{v}</text>
      })}
      <motion.path d={arc(0, 99.99)} fill="none" stroke={color} strokeWidth="1.5" initial={{ pathLength: 0 }} animate={{ pathLength: Math.min(1, score / 100) }} transition={{ duration: 0.9, ease: [0.2, 0, 0, 1] }} />
      <line x1="0" y1="0" x2={nx} y2={ny} stroke="#ffffff" strokeWidth="0.8" />
      <circle r="1.8" fill="#ffffff" />
      <text x="0" y="-18" textAnchor="middle" fontSize="15" fill="#ffffff" fontFamily="Inter Variable, system-ui, sans-serif">{score.toFixed(1)}</text>
      <text x="0" y="-8" textAnchor="middle" fontSize="6" letterSpacing="1.2" fill={color} fontFamily="Inter Variable, system-ui, sans-serif">{severity.toUpperCase()}</text>
    </svg>
  )
}

/** Tiny horizontal bar gauge. */
export function Bar({ value, max, color = '#67e8f9' }: { value: number; max: number; color?: string }) {
  return (
    <div className="relative h-[3px] w-full bg-[rgb(255_255_255/0.06)]">
      <div className="absolute inset-y-0 left-0" style={{ width: `${Math.min(100, (value / max) * 100)}%`, background: color }} />
    </div>
  )
}
