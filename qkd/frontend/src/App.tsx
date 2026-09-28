import { useCallback, useEffect, useState } from 'react'
import { AnimatePresence, motion, useAnimate } from 'framer-motion'
import { AlertTriangle, X } from 'lucide-react'
import { getHealth, simulateAttack, simulateClean, type Health, type SimResponse } from './api'
import { QuantumScene } from './scene/QuantumScene'
import { ControlPanel, KeyPanel, Legend, MetricsPanel, QubitTrace, TopBar, type Controls } from './hud/Panels'

export default function App() {
  const [result, setResult] = useState<SimResponse | null>(null)
  const [health, setHealth] = useState<Health | null>(null)
  const [offline, setOffline] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState<'clean' | 'attack' | null>(null)
  const [collapseKey, setCollapseKey] = useState(0)
  const [controls, setControls] = useState<Controls>({ nQubits: 128, interceptRate: 1, noise: 0 })
  const [hud, animateHud] = useAnimate()

  const run = useCallback(
    async (kind: 'clean' | 'attack', seed?: number) => {
      setLoading(kind)
      setError(null)
      try {
        const params = { n_qubits: controls.nQubits, channel_noise: controls.noise, seed }
        const res =
          kind === 'clean'
            ? await simulateClean(params)
            : await simulateAttack({ ...params, intercept_rate: controls.interceptRate })
        setResult(res)
        setOffline(false)
        if (kind === 'attack') setCollapseKey((k) => k + 1)
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        setError(
          msg.includes('Failed to fetch') || msg.startsWith('50')
            ? 'Cannot reach the BB84 backend on :8100. Start it with: cd qkd && .venv/bin/uvicorn app.main:app --port 8100'
            : msg,
        )
        if (msg.includes('Failed to fetch') || msg.startsWith('50')) setOffline(true)
      } finally {
        setLoading(null)
      }
    },
    [controls],
  )

  useEffect(() => {
    getHealth().then(setHealth).catch(() => setOffline(true))
    // ?attack opens straight into the Eve scenario (handy when presenting).
    run(new URLSearchParams(window.location.search).has('attack') ? 'attack' : 'clean')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The HUD jolts when the collapse hits.
  useEffect(() => {
    if (collapseKey > 0 && hud.current) {
      animateHud(hud.current, { x: [0, -10, 8, -5, 3, 0], y: [0, 3, -2, 1, 0, 0] }, { duration: 0.5 })
    }
  }, [collapseKey, animateHud, hud])

  // Keep the same photons when Eve attacks, so the only change is her presence.
  const sameSeed = result && result.params.n_qubits === controls.nQubits ? result.seed : undefined

  return (
    <div className="relative h-full overflow-hidden">
      <div className="absolute inset-0">
        <QuantumScene qubits={result?.qubits ?? []} attack={result?.scenario === 'attack'} collapseKey={collapseKey} />
      </div>

      {collapseKey > 0 && <div key={collapseKey} className="collapse-overlay" />}

      <div ref={hud} className="pointer-events-none absolute inset-0 z-10 flex flex-col gap-4 overflow-y-auto p-4">
        <TopBar result={result} health={health} offline={offline} />

        <div className="grid flex-1 grid-cols-1 content-start gap-4 lg:grid-cols-[290px_minmax(0,1fr)_330px] lg:content-stretch">
          <div className="order-2 min-w-0 space-y-4 lg:order-1">
            <ControlPanel
              controls={controls}
              setControls={setControls}
              loading={loading}
              onClean={() => run('clean', sameSeed)}
              onAttack={() => run('attack', sameSeed)}
              onReset={() => run('clean')}
            />
            <div className="hidden lg:block">
              <Legend />
            </div>
          </div>
          {/* Leaves the centre of the canvas visible */}
          <div className="order-1 h-[42vh] lg:order-2 lg:h-auto" />
          <div className="order-3 min-w-0">
            <MetricsPanel result={result} />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
          <KeyPanel result={result} />
          <QubitTrace result={result} />
        </div>
        <div className="lg:hidden">
          <Legend />
        </div>
      </div>

      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="glass glass-danger fixed bottom-4 left-1/2 z-50 flex w-[min(560px,calc(100%-32px))] -translate-x-1/2 items-start gap-3 p-3 text-xs text-q-red"
            role="alert"
          >
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <span className="flex-1 break-words">{error}</span>
            <button onClick={() => setError(null)} aria-label="Dismiss" className="text-ink-dim hover:text-ink">
              <X size={14} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
