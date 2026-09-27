import { motion, useSpring, useTransform, type SpringOptions } from 'framer-motion'
import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

type SpotlightProps = {
  className?: string
  /** Diameter of the light in px. */
  size?: number
  springOptions?: SpringOptions
}

/**
 * A soft radial light that follows the pointer across its parent element.
 *
 * Until the pointer first enters, it rests wherever `className` places it
 * (e.g. "-top-40 left-0"); after that it glides to the cursor on a spring.
 * The parent must be `relative` (and ideally `overflow-hidden`).
 */
export function Spotlight({ className, size = 520, springOptions = { bounce: 0, stiffness: 120, damping: 22 } }: SpotlightProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [tracking, setTracking] = useState(false)
  const [hovered, setHovered] = useState(false)
  const x = useSpring(0, springOptions)
  const y = useSpring(0, springOptions)
  const left = useTransform(x, (v) => `${v - size / 2}px`)
  const top = useTransform(y, (v) => `${v - size / 2}px`)

  useEffect(() => {
    const parent = ref.current?.parentElement
    if (!parent) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const move = (e: PointerEvent) => {
      const r = parent.getBoundingClientRect()
      const px = e.clientX - r.left
      const py = e.clientY - r.top
      if (reduce) {
        x.jump(px)
        y.jump(py)
      } else {
        x.set(px)
        y.set(py)
      }
      setTracking(true)
    }
    const enter = (e: PointerEvent) => {
      const r = parent.getBoundingClientRect()
      // Start the spring at the cursor so the light doesn't sweep in from (0,0).
      x.jump(e.clientX - r.left)
      y.jump(e.clientY - r.top)
      setHovered(true)
      setTracking(true)
    }
    const leave = () => setHovered(false)
    parent.addEventListener('pointermove', move)
    parent.addEventListener('pointerenter', enter)
    parent.addEventListener('pointerleave', leave)
    return () => {
      parent.removeEventListener('pointermove', move)
      parent.removeEventListener('pointerenter', enter)
      parent.removeEventListener('pointerleave', leave)
    }
  }, [x, y])

  return (
    <motion.div
      ref={ref}
      aria-hidden
      className={cn(
        'pointer-events-none absolute z-0 rounded-full blur-3xl transition-opacity duration-300',
        'bg-[radial-gradient(circle_at_center,rgb(255_255_255/0.10),rgb(16_185_129/0.05)_40%,transparent_70%)]',
        tracking && !hovered ? 'opacity-40' : 'opacity-100',
        className,
      )}
      style={{ width: size, height: size, ...(tracking ? { left, top } : {}) }}
    />
  )
}
