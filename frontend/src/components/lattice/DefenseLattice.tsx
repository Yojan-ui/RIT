import { Canvas } from '@react-three/fiber'
import { Component, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import * as THREE from 'three'
import { cn } from '@/lib/utils'
import { STATUS_TONE, VECTOR_ABBR, VECTOR_ORDER } from '@/lib/meta'
import type { ScanReport, VectorId } from '@/lib/types'
import { Lamp } from '../primitives'
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
        <div className="grid h-full place-items-center px-6 text-center text-[12.5px] text-ink-3">
          The 3D view needs WebGL, which is turned off in this browser.
        </div>
      )
    return this.props.children
  }
}

export default function DefenseLattice({
  report,
  dimmed = false,
  flyTo = null,
  flat = false,
  dark = false,
  onSelectVector,
}: {
  report: ScanReport
  dimmed?: boolean
  /** Vector the camera should fly to, driven by hovering DOM elements. */
  flyTo?: VectorId | null
  /** Flat solid colours, no bloom (the brutalist theme never glows). */
  flat?: boolean
  /** Black stage (dark theme) rather than white. */
  dark?: boolean
  onSelectVector: (id: VectorId) => void
}) {
  const nodes = useMemo<LatticeNode[]>(
    () =>
      VECTOR_ORDER.flatMap((id) => {
        const check = report.checks.find((c) => c.id === id)
        return check
          ? [{ id, abbr: VECTOR_ABBR[id], name: check.name, status: check.status, summary: check.summary }]
          : []
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
    <section className="flex h-full flex-col" aria-labelledby="lattice-heading">
      <div className="flex shrink-0 items-center justify-between gap-4 border-b border-line px-3 py-2 text-[11px] font-bold tracking-[0.12em]">
        <h2 id="lattice-heading" className="text-ink">
          3D DEFENSE LATTICE{' '}
          <span className={intact === nodes.length ? 'text-ok' : 'text-crit'}>
            [{intact}/{nodes.length} LINKS INTACT]
          </span>
        </h2>
        <p className="hidden shrink-0 text-ink-3 sm:block">DRAG TO ORBIT / CLICK A NODE</p>
      </div>

      <div ref={frameRef} className={cn('relative min-h-0 flex-1 transition-opacity', dimmed && 'opacity-40')}>
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
              flat={flat}
              dark={dark}
              onHover={setHovered}
              onSelect={onSelectVector}
            />
            <Controls
              autoRotate={!reducedMotion}
              focus={flyIndex >= 0 ? flyIndex : null}
              positions={positions}
              reducedMotion={reducedMotion}
            />
            {/* Unmounting hands rendering back to R3F's default (un-post-processed) loop. */}
            {!flat && <UnrealBloom strength={1.0} radius={0.3} threshold={0.8} />}
          </Canvas>
        </WebGLBoundary>

        {/* Readout for the hovered/focused node */}
        <div
          className="pointer-events-none absolute top-3 right-3 left-3 flex"
          aria-live="polite"
        >
          {focus && (
            <div className={cn('max-w-[26rem] border bg-surface px-3 py-2', STATUS_TONE[focus.status].border)}>
              <p className="flex items-center gap-2 text-[12px] font-bold">
                <span className="text-ink">{focus.name}</span>
                <span className={STATUS_TONE[focus.status].text}>
                  {STATUS_TONE[focus.status].label}
                </span>
              </p>
              <p className="mt-0.5 text-[12px] leading-snug text-ink-2">{focus.summary}</p>
            </div>
          )}
        </div>

        {/* Legend doubles as a keyboard-accessible way to inspect each node */}
        <div className="absolute inset-x-0 bottom-0 flex flex-wrap gap-1 px-3 pb-3">
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
                  'inline-flex h-6 items-center gap-1.5 border bg-surface px-2 text-[11px] font-bold tracking-[0.08em]',
                  hovered === n.id ? 'border-ink text-ink' : 'border-line text-ink-2 hover:text-ink',
                )}
              >
                <Lamp className={tone.bg} />
                {n.abbr}
              </button>
            )
          })}
        </div>
      </div>
    </section>
  )
}
