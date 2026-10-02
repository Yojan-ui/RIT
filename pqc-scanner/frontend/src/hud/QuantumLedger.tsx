import { Suspense, lazy, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { LandingPage } from './LandingPage'

// Root of the QuantumLedger variant: the landing page is the gateway, and the 3D console
// (HudApp: WebGL scene, postprocessing, panes) is only fetched and mounted once the operator asks for it.
const loadDashboard = () => import('./HudApp')
const HudApp = lazy(loadDashboard)

function Booting() {
  return (
    <div className="grid h-dvh place-items-center bg-[#09090B] font-mono text-[11px] tracking-[0.14em] text-neutral-500 uppercase">
      Initializing diagnostics…
    </div>
  )
}

export default function QuantumLedger() {
  const [isDashboardActive, setIsDashboardActive] = useState(false)

  const launch = () => {
    void loadDashboard()
    setIsDashboardActive(true)
  }

  return (
    <div className="min-h-dvh bg-[#09090B]">
      {/* the landing fades out completely before the console mounts */}
      <AnimatePresence mode="wait" onExitComplete={() => window.scrollTo(0, 0)}>
        {isDashboardActive ? (
          // opacity only: a transform here would become the containing block for the console's fixed layers
          <motion.div key="dashboard" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.7, ease: [0.2, 0, 0, 1] }}>
            <Suspense fallback={<Booting />}>
              <HudApp />
            </Suspense>
          </motion.div>
        ) : (
          <motion.div key="landing" exit={{ opacity: 0 }} transition={{ duration: 0.5, ease: [0.4, 0, 1, 1] }}>
            {/* warm the console chunk on hover/focus so the hand-off has no visible load */}
            <LandingPage onLaunch={launch} onIntent={() => void loadDashboard()} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
