import { forwardRef, useEffect, type ReactNode } from 'react'
import { motion, useSpring, useTransform } from 'framer-motion'
import { Eye, Loader2, Send } from 'lucide-react'

function StepCard({ step, title, accent, children }: { step: number; title: string; accent: string; children: ReactNode }) {
  return (
    <section className="pointer-events-auto flex flex-col rounded-3xl border border-white/10 bg-zinc-950/70 p-4 backdrop-blur-xl lg:p-5 [@media(max-height:820px)]:lg:p-4">
      <div className="flex items-center gap-2.5">
        <span className="grid size-7 place-items-center rounded-full text-sm font-black text-black" style={{ background: accent }}>
          {step}
        </span>
        <span className="text-xs font-bold tracking-[0.2em] text-zinc-400">STEP {step}</span>
      </div>
      <h2 className="mt-1.5 text-xl font-black tracking-tight text-white sm:text-2xl">{title}</h2>
      <div className="mt-2.5 flex flex-1 flex-col">{children}</div>
    </section>
  )
}

export function AliceStep({ onSend, busy, invite }: { onSend: () => void; busy: boolean; invite: boolean }) {
  return (
    <StepCard step={1} title="ALICE (SENDER)" accent="#38e1ff">
      <p className="mb-3 text-sm text-zinc-400 sm:text-base">Alice sends a secret key to Bob, one particle of light at a time.</p>
      <button
        onClick={onSend}
        disabled={busy}
        className={`mt-auto flex items-center justify-center gap-3 rounded-2xl bg-cyan-400 px-6 py-3.5 text-lg font-black tracking-wide text-black transition hover:bg-cyan-300 hover:shadow-[0_0_40px_-4px_#38e1ff] active:scale-[0.98] disabled:opacity-60 sm:text-xl ${
          invite ? 'send-pulse' : ''
        }`}
      >
        {busy ? <Loader2 className="animate-spin" size={22} /> : <Send size={22} strokeWidth={2.5} />}
        SEND SECURE KEY
      </button>
    </StepCard>
  )
}

/** Security risk: share of photons the spy disturbed. Springy, so the attack reads as a spike. */
function RiskGauge({ value }: { value: number }) {
  const spring = useSpring(0, { stiffness: 120, damping: 9 })
  useEffect(() => spring.set(value), [value, spring])
  const width = useTransform(spring, (v) => `${Math.min(100, Math.max(0, v * 100))}%`)
  const pct = useTransform(spring, (v) => `${Math.round(Math.max(0, v) * 100)}%`)
  const critical = value >= 0.11
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-bold tracking-[0.18em] text-zinc-400">SECURITY RISK</span>
        <span className={`text-lg font-black sm:text-2xl ${critical ? 'text-red-400' : 'text-emerald-300'}`}>
          <motion.span>{pct}</motion.span>{' '}
          <span className="text-sm font-bold sm:text-base">{critical ? '(CRITICAL - INTRUDER)' : '(Safe)'}</span>
        </span>
      </div>
      <div className="mt-1.5 h-3 overflow-hidden rounded-full bg-white/10">
        <motion.div
          className={`h-full rounded-full ${critical ? 'bg-gradient-to-r from-orange-500 to-red-500 shadow-[0_0_20px_#ff3b5c]' : 'bg-emerald-400'}`}
          style={{ width }}
        />
      </div>
    </div>
  )
}

export function ChannelStep({ progress, photons, risk, onSpy, busy, attack }: {
  progress: number
  photons: number
  risk: number
  onSpy: () => void
  busy: boolean
  attack: boolean
}) {
  const done = progress >= 1
  return (
    <StepCard step={2} title="THE QUANTUM CHANNEL" accent="#a1a1aa">
      <div>
        <div className="flex items-baseline justify-between">
          <span className="text-xs font-bold tracking-[0.18em] text-zinc-400">SPEED / DATA</span>
          <span className="text-lg font-black text-white sm:text-2xl">
            {done ? `${photons} photons sent` : `${Math.round(progress * 100)}%`}
          </span>
        </div>
        <div className="mt-1.5 h-3 overflow-hidden rounded-full bg-white/10">
          <div
            className={`h-full rounded-full ${attack ? 'bg-red-400/80' : 'bg-cyan-400'}`}
            style={{ width: `${progress * 100}%` }}
          />
        </div>
      </div>
      <div className="mt-3 mb-3">
        <RiskGauge value={risk} />
      </div>
      <button
        onClick={onSpy}
        disabled={busy}
        className="mt-auto flex items-center justify-center gap-2.5 rounded-2xl border-2 border-red-500/70 bg-red-600/15 px-5 py-3 text-base font-black tracking-wide text-red-300 transition hover:bg-red-600/30 hover:shadow-[0_0_36px_-6px_#ff3b5c] active:scale-[0.98] disabled:opacity-60 sm:text-lg"
      >
        <Eye size={20} strokeWidth={2.5} />
        SIMULATE EVE (THE SPY)
      </button>
    </StepCard>
  )
}

export function BobStep({ state }: { state: 'receiving' | 'safe' | 'corrupted' | 'idle' }) {
  return (
    <StepCard step={3} title="BOB (RECEIVER)" accent="#a78bfa">
      <p className="mb-3 text-sm text-zinc-400 sm:text-base">Bob catches the photons and checks them for tampering.</p>
      <div className="mt-auto">
        {state === 'receiving' || state === 'idle' ? (
          <div className="flex items-center gap-3 text-xl font-bold text-zinc-300 sm:text-2xl">
            {state === 'receiving' && <Loader2 className="animate-spin text-violet-300" size={26} />}
            {state === 'receiving' ? 'Receiving photons…' : 'Waiting for Alice…'}
          </div>
        ) : (
          <motion.p
            key={state}
            initial={{ opacity: 0, y: 10, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ type: 'spring', stiffness: 300, damping: 22 }}
            className={`text-xl leading-snug font-black sm:text-2xl ${state === 'safe' ? 'text-emerald-300' : 'text-red-400'}`}
          >
            {state === 'safe' ? '🎯 RESULT: Bob got 100% of the key. Key is safe to use!' : '❌ RESULT: Key is corrupted and discarded. Eve got nothing!'}
          </motion.p>
        )}
      </div>
    </StepCard>
  )
}

export const Steps = forwardRef<HTMLDivElement, { children: ReactNode }>(function Steps({ children }, ref) {
  return (
    <div ref={ref} className="grid w-full grid-cols-1 gap-3 md:grid-cols-3 md:gap-4">
      {children}
    </div>
  )
})

export function HelpBar() {
  return (
    <div className="pointer-events-auto flex items-center justify-center gap-3 rounded-2xl border border-white/10 bg-zinc-950/70 px-4 py-2.5 text-center text-sm text-zinc-300 backdrop-blur-xl sm:text-base">
      <span className="shrink-0 rounded-full bg-white/10 px-2.5 py-0.5 text-xs font-bold tracking-widest text-white">QUANTUM RULE</span>
      <span>If anyone spies on quantum particles, they change shape. Bob immediately sees the changes and alerts the system.</span>
    </div>
  )
}
