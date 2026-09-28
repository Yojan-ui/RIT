import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { useAnimate } from 'framer-motion'
import { simulateAttack, simulateClean, type SimResponse } from './api'
import { transmission, useProgress } from './transmission'
import { QuantumScene, type Band } from './scene/QuantumScene'
import { Banner, type Status } from './hud/Banner'
import { AliceStep, BobStep, ChannelStep, HelpBar, Steps } from './hud/Steps'

type Mode = 'clean' | 'attack'

const PHOTONS = 512

/** Screen band between the banner and the step cards, where the 3D stage is framed. */
function useStageBand(banner: RefObject<HTMLElement | null>, steps: RefObject<HTMLElement | null>) {
  const [band, setBand] = useState<Band>({ top: 140, bottom: 520, columns: true })
  useLayoutEffect(() => {
    const measure = () => {
      const b = banner.current?.getBoundingClientRect()
      const s = steps.current?.getBoundingClientRect()
      if (!b || !s) return
      const columns = window.matchMedia('(min-width: 768px)').matches
      const top = b.bottom + 12
      // On stacked (mobile) layouts the cards may sit below the fold; keep a usable band.
      const bottom = Math.min(s.top - 8, window.innerHeight - 8)
      setBand((prev) =>
        prev.top === top && prev.bottom === bottom && prev.columns === columns ? prev : { top, bottom: Math.max(top + 160, bottom), columns },
      )
    }
    measure()
    const ro = new ResizeObserver(measure)
    if (banner.current) ro.observe(banner.current)
    if (steps.current) ro.observe(steps.current)
    window.addEventListener('resize', measure)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [banner, steps])
  return band
}

export default function App() {
  const [result, setResult] = useState<SimResponse | null>(null)
  const [offline, setOffline] = useState(false)
  const [loading, setLoading] = useState(false)
  const [runKey, setRunKey] = useState(0)
  const [collapseKey, setCollapseKey] = useState(0)
  const bannerRef = useRef<HTMLDivElement>(null)
  const stepsRef = useRef<HTMLDivElement>(null)
  const band = useStageBand(bannerRef, stepsRef)
  const progress = useProgress(runKey)
  const [hud, animateHud] = useAnimate()

  const run = useCallback(async (mode: Mode, seed?: number) => {
    setLoading(true)
    try {
      const params = { n_qubits: PHOTONS, channel_noise: 0, seed }
      const res = mode === 'clean' ? await simulateClean(params) : await simulateAttack({ ...params, intercept_rate: 1 })
      setResult(res)
      setOffline(false)
      transmission.start()
      setRunKey((k) => k + 1)
      if (mode === 'attack') setCollapseKey((k) => k + 1)
    } catch {
      setOffline(true)
    } finally {
      setLoading(false)
    }
  }, [])

  const booted = useRef(false)
  useEffect(() => {
    if (booted.current) return // StrictMode runs effects twice in dev
    booted.current = true
    run(new URLSearchParams(window.location.search).has('attack') ? 'attack' : 'clean')
  }, [run])

  // The whole interface jolts when the spy strikes.
  useEffect(() => {
    if (collapseKey > 0 && hud.current) {
      animateHud(hud.current, { x: [0, -10, 8, -5, 3, 0], y: [0, 3, -2, 1, 0, 0] }, { duration: 0.5 })
    }
  }, [collapseKey, animateHud, hud])

  const attack = result?.scenario === 'attack'
  const detected = !!result?.metrics.eavesdropper_detected
  const status: Status = offline && !result ? 'offline' : detected ? 'danger' : 'safe'
  // Share of photons the spy knocked into a different state (~50% for intercept-resend).
  const risk = attack && result ? result.eve.wrong_basis_count / result.params.n_qubits : 0
  const bobState = !result ? 'idle' : progress < 1 ? 'receiving' : detected ? 'corrupted' : 'safe'

  return (
    <div className="relative h-full overflow-hidden">
      <div className="absolute inset-0">
        <QuantumScene attack={attack} collapseKey={collapseKey} band={band} />
      </div>

      {collapseKey > 0 && <div key={collapseKey} className="collapse-overlay" />}

      <div ref={hud} className="pointer-events-none absolute inset-0 z-10 flex flex-col gap-3 overflow-y-auto p-3 sm:p-5">
        <Banner ref={bannerRef} status={status} />
        {/* the 3D stage shows through here */}
        <div className="min-h-[36vh] flex-1 md:min-h-[240px]" />
        <Steps ref={stepsRef}>
          <AliceStep onSend={() => run('clean')} busy={loading} invite={!loading && (progress >= 1 || !result)} />
          <ChannelStep
            progress={result ? progress : 0}
            photons={result?.params.n_qubits ?? PHOTONS}
            risk={risk}
            onSpy={() => run('attack', result?.seed)}
            busy={loading}
            attack={attack}
          />
          <BobStep state={bobState} />
        </Steps>
        <HelpBar />
      </div>
    </div>
  )
}
