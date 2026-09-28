import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { AnimatePresence, motion, useAnimate } from 'framer-motion'
import { AlertTriangle, X } from 'lucide-react'
import { getHealth, simulateAttack, simulateClean, type Health, type SimResponse } from './api'
import { playback } from './playback'
import { QuantumScene } from './scene/QuantumScene'
import { TopBar } from './hud/TopBar'
import { ControlPill, type Controls, type Mode } from './hud/ControlPill'
import { MetricsCard } from './hud/MetricsCard'
import { OtpCard } from './hud/OtpCard'
import { PlaybackBar } from './hud/PlaybackBar'
import { BlochDrawer } from './hud/BlochDrawer'

const MAX_QUBITS = 2048
const OFFLINE_HINT = 'Cannot reach the BB84 backend on :8100. Start it with: cd qkd && .venv/bin/uvicorn app.main:app --port 8100'

function useMediaQuery(query: string) {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(query)
      m.addEventListener('change', cb)
      return () => m.removeEventListener('change', cb)
    },
    () => window.matchMedia(query).matches,
  )
}

/** ?photon=N jumps to photon N (paused); add &inspect to open its Bloch sphere. Applied once. */
let deepLinkPending = true
let openFromLink: ((i: number) => void) | null = null
function applyDeepLink(n: number) {
  if (!deepLinkPending) return
  deepLinkPending = false
  const q = new URLSearchParams(window.location.search)
  const k = Number(q.get('photon'))
  if (!q.has('photon') || !Number.isInteger(k) || k < 0 || k >= n) return
  playback.seek(k)
  if (q.has('inspect')) openFromLink?.(k)
}

export default function App() {
  const [result, setResult] = useState<SimResponse | null>(null)
  const [health, setHealth] = useState<Health | null>(null)
  const [offline, setOffline] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [mode, setMode] = useState<Mode>(() => (new URLSearchParams(window.location.search).has('attack') ? 'attack' : 'clean'))
  const [controls, setControls] = useState<Controls>({ nQubits: 768, interceptRate: 1, noise: 0 })
  const [collapseKey, setCollapseKey] = useState(0)
  const [selected, setSelected] = useState<number | null>(null)
  const [hud, animateHud] = useAnimate()
  const desktop = useMediaQuery('(min-width: 1024px)')
  // Cards start open only where they don't cover the optical bench.
  const roomy = useMediaQuery('(min-width: 1280px) and (min-height: 720px)')

  const run = useCallback(
    async (kind: Mode, seed?: number, nOverride?: number) => {
      setLoading(true)
      setError(null)
      try {
        const params = { n_qubits: nOverride ?? controls.nQubits, channel_noise: controls.noise, seed }
        const res = kind === 'clean' ? await simulateClean(params) : await simulateAttack({ ...params, intercept_rate: controls.interceptRate })
        setResult(res)
        setOffline(false)
        playback.load(res.qubits.length)
        setSelected((s) => (s !== null && s < res.qubits.length ? s : null))
        applyDeepLink(res.qubits.length)
        if (kind === 'attack') setCollapseKey((k) => k + 1)
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        const down = msg.includes('Failed to fetch') || /^50\d/.test(msg)
        setError(down ? OFFLINE_HINT : msg)
        if (down) setOffline(true)
      } finally {
        setLoading(false)
      }
    },
    [controls],
  )

  const booted = useRef(false)
  useEffect(() => {
    if (booted.current) return // StrictMode runs effects twice in dev
    booted.current = true
    getHealth().then(setHealth).catch(() => setOffline(true))
    run(mode)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The HUD jolts when the collapse lands.
  useEffect(() => {
    if (collapseKey > 0 && hud.current) {
      animateHud(hud.current, { x: [0, -8, 6, -4, 2, 0], y: [0, 2, -2, 1, 0, 0] }, { duration: 0.45 })
    }
  }, [collapseKey, animateHud, hud])

  // Same photons when only the mode changes, so Eve is the one variable.
  const sameSeed = result && result.params.n_qubits === controls.nQubits ? result.seed : undefined

  const onMode = (m: Mode) => {
    setMode(m)
    run(m, sameSeed)
  }
  const onNeedBits = (bits: number) => {
    // ~1/4 of photons survive sifting + the error-check sample; leave headroom.
    const n = Math.min(MAX_QUBITS, Math.ceil((bits * 4.6) / 64) * 64)
    setControls((c) => ({ ...c, nQubits: n }))
    run(mode, undefined, n)
  }
  const openPhoton = useCallback((i: number) => setSelected(i), [])
  openFromLink = openPhoton
  const selectedQubit = selected !== null ? result?.qubits[selected] : undefined

  const metrics = <MetricsCard result={result} defaultOpen={roomy} />
  const otp = <OtpCard result={result} onNeedBits={onNeedBits} loading={loading} defaultOpen={roomy} />

  return (
    <div className="relative h-full overflow-hidden">
      <div className="absolute inset-0">
        <QuantumScene
          qubits={result?.qubits ?? []}
          attack={result?.scenario === 'attack'}
          collapseKey={collapseKey}
          selected={selected}
          onSelect={openPhoton}
        />
      </div>

      {collapseKey > 0 && <div key={collapseKey} className="collapse-overlay" />}

      <div ref={hud} className="pointer-events-none absolute inset-0 z-10 flex flex-col gap-3 p-4">
        <TopBar result={result} health={health} offline={offline} />
        <div className="flex justify-center lg:absolute lg:top-4 lg:left-1/2 lg:-translate-x-1/2">
          <ControlPill
            mode={mode}
            onMode={onMode}
            controls={controls}
            setControls={setControls}
            loading={loading}
            onTransmit={() => run(mode, sameSeed)}
            onReseed={() => run(mode)}
          />
        </div>

        {desktop && (
          <>
            <div className="absolute top-20 left-4 w-[330px]">{otp}</div>
            <div className="absolute top-20 right-4 w-[300px]">{metrics}</div>
          </>
        )}

        <div className="mx-auto mt-auto flex w-full max-w-[980px] flex-col items-center gap-2">
          {!desktop && (
            <div className="pointer-events-none grid w-full gap-2 sm:grid-cols-2">
              {metrics}
              {otp}
            </div>
          )}
          <PlaybackBar result={result} selected={selected} onOpen={openPhoton} />
        </div>
      </div>

      <AnimatePresence>
        {selectedQubit && result && (
          <BlochDrawer
            key="bloch"
            qubit={selectedQubit}
            total={result.qubits.length}
            onClose={() => setSelected(null)}
            onNavigate={openPhoton}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="hud fixed top-20 left-1/2 z-50 flex w-[min(520px,calc(100%-32px))] -translate-x-1/2 items-start gap-3 rounded-2xl p-3 text-xs text-q-red"
            role="alert"
          >
            <AlertTriangle size={15} className="mt-px shrink-0" />
            <span className="flex-1 break-words">{error}</span>
            <button onClick={() => setError(null)} aria-label="Dismiss" className="text-zinc-500 hover:text-zinc-100">
              <X size={14} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
