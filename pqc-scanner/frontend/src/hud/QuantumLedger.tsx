import { Suspense, lazy, useEffect, useState } from 'react'
import { AnimatePresence, MotionConfig, motion } from 'framer-motion'
import { LandingPage } from './LandingPage'

// Root of the QuantumLedger variant. The 3D console (HudApp: WebGL scene, postprocessing, panes) is mounted
// dormant behind the landing page as soon as the page is idle; "Initialize" wakes it and dissolves the landing
// over the already-running scene while the camera flies in.
const loadDashboard = () => import('./HudApp')
const HudApp = lazy(loadDashboard)

// the curtain: the landing pushes toward the viewer and fades while its onyx ground clears to the console
const CURTAIN = { duration: 0.8, ease: 'easeInOut' } as const

export default function QuantumLedger() {
  const [mounted, setMounted] = useState(false) // console in the tree, dormant behind the landing
  const [awake, setAwake] = useState(false) // landing dismissed, console live

  const warm = () => void loadDashboard().then(() => setMounted(true))
  useEffect(() => {
    if ('requestIdleCallback' in window) {
      const id = requestIdleCallback(warm, { timeout: 2000 })
      return () => cancelIdleCallback(id)
    }
    const id = setTimeout(warm, 800)
    return () => clearTimeout(id)
  }, [])

  const launch = () => {
    setMounted(true)
    // never dissolve onto an empty screen: wait for the console chunk (normally already warm)
    void loadDashboard().then(() => setAwake(true))
  }

  return (
    <MotionConfig reducedMotion="user">
      <div className="min-h-dvh bg-[#09090B]">
        {mounted && (
          // no transform on this wrapper: it would become the containing block for the console's fixed layers
          <div inert={!awake}>
            <Suspense fallback={null}>
              <HudApp awake={awake} />
            </Suspense>
          </div>
        )}
        <AnimatePresence>
          {!awake && (
            <motion.div key="landing" className="fixed inset-0 z-50 overflow-hidden bg-[#09090B]" exit={{ backgroundColor: 'rgba(9, 9, 11, 0)' }} transition={CURTAIN}>
              {/* the landing scrolls inside this viewport-sized box, so the exit scales about the visible centre */}
              <motion.div className="h-full overflow-y-auto overscroll-contain" exit={{ opacity: 0, scale: 1.05 }} transition={CURTAIN}>
                <LandingPage onLaunch={launch} onIntent={warm} />
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </MotionConfig>
  )
}
