import { Suspense, lazy, useState } from 'react'
import { AnimatePresence, MotionConfig, motion } from 'framer-motion'
import { LandingPage } from './LandingPage'

// Root of the QuantumLedger variant. The 3D console (HudApp: R3F canvas, postprocessing, panes) is always in the
// tree, pinned behind everything at z-0 and dormant (one frame drawn, inert) until launch. The landing page is a
// translucent overlay above it; "Initialize" dissolves that overlay to reveal the already-running scene while the
// camera flies in. The canvas is never unmounted, so there is no remount or shader-compile hitch at the handoff.
const loadDashboard = () => import('./HudApp')
const HudApp = lazy(loadDashboard)

const DISSOLVE = { duration: 0.8, ease: 'easeInOut' } as const

export default function QuantumLedger() {
  const [awake, setAwake] = useState(false) // landing dismissed, console live

  // never dissolve onto an empty screen: wait for the console chunk (normally loaded long before the click)
  const launch = () => void loadDashboard().then(() => setAwake(true))

  return (
    <MotionConfig reducedMotion="user">
      <div className="min-h-dvh bg-neutral-950">
        {/* fixed + z-0 makes this a stacking context: the console's own z-indexed layers stay below the landing.
            No transform here, so its fixed layers keep the viewport as their containing block. */}
        <div className="fixed inset-0 z-0" inert={!awake}>
          <Suspense fallback={null}>
            <HudApp awake={awake} />
          </Suspense>
        </div>
        <AnimatePresence>
          {!awake && (
            // viewport-sized and scrolling internally, so the exit scales about the visible centre
            <motion.div
              key="landing"
              className="relative z-10 h-dvh overflow-y-auto overscroll-contain bg-neutral-950/90 backdrop-blur-md"
              exit={{ opacity: 0, filter: 'blur(10px)', scale: 1.05, transition: DISSOLVE }}
            >
              <LandingPage onLaunch={launch} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </MotionConfig>
  )
}
