// Bento card: the one modular container every HUD module uses. Uniform hairline border, frosted glass,
// 24px padding, an icon + title header, and a spatial hover tilt capped at MAX_TILT so text stays
// readable. The tilt is a transform, so it never moves the card's grid cell.
import type { PointerEvent, ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'

const MAX_TILT = 1.5 // degrees
const REDUCED = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches

function tilt(e: PointerEvent<HTMLElement>) {
  if (REDUCED || e.pointerType !== 'mouse') return
  const el = e.currentTarget
  const r = el.getBoundingClientRect()
  const x = (e.clientX - r.left) / r.width
  const y = (e.clientY - r.top) / r.height
  el.style.setProperty('--rx', `${((0.5 - y) * 2 * MAX_TILT).toFixed(2)}deg`)
  el.style.setProperty('--ry', `${((x - 0.5) * 2 * MAX_TILT).toFixed(2)}deg`)
  el.style.setProperty('--gx', `${(x * 100).toFixed(1)}%`)
  el.style.setProperty('--gy', `${(y * 100).toFixed(1)}%`)
  el.dataset.tilt = ''
}

function untilt(e: PointerEvent<HTMLElement>) {
  const el = e.currentTarget
  el.style.setProperty('--rx', '0deg')
  el.style.setProperty('--ry', '0deg')
  delete el.dataset.tilt
}

export function Card({
  icon: Icon,
  title,
  right,
  tone,
  still = false,
  className = '',
  bodyClassName = '',
  children,
}: {
  icon: LucideIcon
  title: ReactNode
  right?: ReactNode
  tone?: 'warn' | 'ok'
  still?: boolean // no tilt (the 3D viewport: tilting it would skew orbit and raycast input)
  className?: string
  bodyClassName?: string
  children: ReactNode
}) {
  return (
    <section className={`bento-card ${tone ?? ''} ${className}`} onPointerMove={still ? undefined : tilt} onPointerLeave={still ? undefined : untilt}>
      <header className="bento-head">
        <h2 className="bento-title">
          <Icon size={15} strokeWidth={1.75} aria-hidden />
          {title}
        </h2>
        {right}
      </header>
      <div className={`bento-body ${bodyClassName}`}>{children}</div>
    </section>
  )
}
