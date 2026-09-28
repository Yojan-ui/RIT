import { useEffect, useState } from 'react'

/** A transmission is a short wave of big photon spheres from Alice to Bob. */
export const SPHERES = 6
export const GAP = 0.85 // seconds between spheres leaving Alice
export const CROSS = 3.6 // seconds for one sphere to reach Bob
export const TOTAL = (SPHERES - 1) * GAP + CROSS

let startedAt = -Infinity

export const transmission = {
  start() {
    startedAt = performance.now()
  },
  /** Seconds since the current transmission started. */
  elapsed() {
    return (performance.now() - startedAt) / 1000
  },
}

/** 0 → 1 as the wave of photons reaches Bob. Updates at ~30 fps while running. */
export function useProgress(runKey: number) {
  const [p, setP] = useState(0)
  useEffect(() => {
    let raf = 0
    let last = 0
    const loop = (now: number) => {
      const v = Math.min(1, Math.max(0, transmission.elapsed() / TOTAL))
      if (now - last > 33 || v === 1) {
        last = now
        setP(v)
      }
      if (v < 1) raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [runKey])
  return p
}
