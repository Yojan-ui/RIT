import { Canvas } from '@react-three/fiber'
import { Component, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import * as THREE from 'three'
import { cn } from '@/lib/utils'
import { STATUS_TONE, VECTOR_ABBR, VECTOR_ORDER } from '@/lib/meta'
import type { ScanReport, VectorId } from '@/lib/types'
import { Lamp, PanelHeader } from '../primitives'
import { Controls } from './Controls'
import { Lattice, type LatticeNode } from './Lattice'
import { UnrealBloom } from './UnrealBloom'

function useReducedMotion() {
  const query = '(prefers-reduced-motion: reduce)'
  const [reduced, setReduced] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const mq = window.matchMedia(query)
    const onChange = () => setReduced(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return reduced
}

/** Stop rendering frames while the panel is scrolled out of view. */
function useInView<T extends Element>() {
  const ref = useRef<T>(null)
  const [inView, setInView] = useState(true)
  useEffect(() => {
    if (!ref.current) return
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { rootMargin: '100px' })
    observer.observe(ref.current)
    return () => observer.disconnect()
  }, [])
  return [ref, inView] as const
}

class WebGLBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    if (this.state.failed)
      return (
        <div className="grid h-full place-items-center font-mono text-[11px] tracking-wider text-slate-500">
          3D VIEW UNAVAILABLE (WEBGL DISABLED)
        </div>
      )
    return this.props.children
  }
}

export default function DefenseLattice({
  report,
  dimmed = false,
  flyTo = null,
  embedded = false,
  onSelectVector,
}: {
  report: ScanReport
  dimmed?: boolean
  /** Render borderless and headerless, filling the parent (host supplies the chrome). */
  embedded?: boolean
  /** Vector the camera should fly to, driven by hovering DOM elements. */
  flyTo?: VectorId | null
  onSelectVector: (id: VectorId) => void
}) {
  const nodes = useMemo<LatticeNode[]>(
    () =>
      VECTOR_ORDER.flatMap((id) => {
        const check = report.checks.find((c) => c.id === id)
        return check ? [{ id, abbr: VECTOR_ABBR[id], name: check.name, status: check.status, summary: check.summary }] : []
      }),
    [report],
  )
  const [hovered, setHovered] = useState<VectorId | null>(null)
  const reducedMotion = useReducedMotion()
  const [frameRef, inView] = useInView<HTMLDivElement>()
  // Shared between the scene (writes each frame) and the camera rig (reads).
  const positions = useMemo(() => VECTOR_ORDER.map(() => new THREE.Vector3()), [])
  const flyIndex = flyTo ? nodes.findIndex((n) => n.id === flyTo) : -1
  const intact = nodes.filter((n) => n.status !== 'fail').length
  const focus = nodes.find((n) => n.id === (flyTo ?? hovered))

  return (
    <section
      className={cn('flex h-full flex-col overflow-hidden', !embedded && 'panel')}
      aria-labelledby="lattice-heading"
    >
      <PanelHeader label="Defense lattice" hidden={embedded}>
        <span id="lattice-heading" className="font-mono text-[10px] tracking-wider">
          <span className={intact === nodes.length ? 'text-ok' : 'text-crit'}>
            {intact}/{nodes.length} LINKS INTACT
          </span>
        </span>
      </PanelHeader>

      <div
        ref={frameRef}
        className={cn(
          embedded ? 'relative min-h-0 flex-1' : 'relative h-[340px] sm:h-[440px] xl:h-auto xl:min-h-0 xl:flex-1',
          'transition-opacity',
          dimmed && 'opacity-40',
        )}
      >
        <WebGLBoundary>
          <Canvas
            flat
            frameloop={inView ? 'always' : 'never'}
            dpr={[1, 2]}
            camera={{ position: [0, 3.4, 10], fov: 42 }}
            gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
            onPointerMissed={() => setHovered(null)}
            aria-hidden
          >
            <Lattice
              nodes={nodes}
              score={report.score}
              hovered={hovered}
              focus={flyIndex >= 0 ? flyTo : null}
              positions={positions}
              reducedMotion={reducedMotion}
              onHover={setHovered}
              onSelect={onSelectVector}
            />
            <Controls
              autoRotate={!reducedMotion}
              focus={flyIndex >= 0 ? flyIndex : null}
              positions={positions}
              reducedMotion={reducedMotion}
            />
            <UnrealBloom strength={1.0} radius={0.3} threshold={0.8} />
          </Canvas>
        </WebGLBoundary>

        {/* Readout for the hovered/focused node */}
        <div className="pointer-events-none absolute top-3 left-4 max-w-[min(22rem,calc(100%-2rem))]" aria-live="polite">
          {focus ? (
            <div
              className={cn(
                'rounded-sm border bg-obsidian/85 px-3 py-2 backdrop-blur-sm',
                flyTo ? STATUS_TONE[focus.status].border : 'border-line-strong',
              )}
            >
              {flyTo && <p className="eyebrow mb-1 text-slate-400">▸ Target lock</p>}
              <p className="flex items-center gap-2 font-mono text-[11px] tracking-wider">
                <span className="text-slate-100">{focus.name}</span>
                <span className={STATUS_TONE[focus.status].text}>{STATUS_TONE[focus.status].label}</span>
              </p>
              <p className="mt-1 text-[12px] text-slate-400">{focus.summary}</p>
            </div>
          ) : (
            <p className="font-mono text-[10px] tracking-wider text-slate-600">
              CORE · <span className="text-slate-400">{report.domain}</span>
            </p>
          )}
        </div>

        {/* Legend doubles as a keyboard-accessible way to inspect each node */}
        <div className="absolute inset-x-0 bottom-0 flex flex-wrap items-center gap-1 px-3 pb-3">
          {nodes.map((n) => {
            const tone = STATUS_TONE[n.status]
            return (
              <button
                key={n.id}
                type="button"
                onMouseEnter={() => setHovered(n.id)}
                onMouseLeave={() => setHovered(null)}
                onFocus={() => setHovered(n.id)}
                onBlur={() => setHovered(null)}
                onClick={() => onSelectVector(n.id)}
                aria-label={`${n.name}: ${tone.label}. Show details`}
                className={cn(
                  'inline-flex h-6 items-center gap-1.5 rounded-sm border bg-obsidian/80 px-1.5 font-mono text-[10px] tracking-wider',
                  hovered === n.id ? 'border-slate-400 text-slate-100' : 'border-line text-slate-400',
                )}
              >
                <Lamp className={tone.bg} />
                {n.abbr}
              </button>
            )
          })}
          <span className="ml-auto hidden font-mono text-[10px] tracking-wider text-slate-600 sm:inline">
            DRAG TO ORBIT · CLICK A NODE
          </span>
        </div>
      </div>
    </section>
  )
}
