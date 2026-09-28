import { useEffect, useRef } from 'react'

export const COLLAPSE_SECONDS = 1.8

/**
 * Tracks the "quantum collapse" envelope in scene time.
 * Each bump of `key` restarts it; the returned sampler gives
 * { g: 1 → 0 intensity, d: seconds since start } for the current frame.
 */
export function useCollapse(key: number) {
  const start = useRef<number | null>(null)
  const pending = useRef(false)

  useEffect(() => {
    if (key > 0) pending.current = true
  }, [key])

  return (t: number) => {
    if (pending.current) {
      start.current = t
      pending.current = false
    }
    if (start.current === null) return { g: 0, d: Infinity }
    const d = t - start.current
    if (d > COLLAPSE_SECONDS) return { g: 0, d }
    return { g: Math.pow(1 - d / COLLAPSE_SECONDS, 1.6), d }
  }
}
