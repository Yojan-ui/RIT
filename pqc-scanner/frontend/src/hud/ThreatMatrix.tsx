import { useRef, type KeyboardEvent } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { NECESSITY_ORDER, THREAT_LEVELS, fmtBytes, handshakeBytes, levelText, type SecurityNecessity, type ThreatLevel } from './necessity'

// Landing-page Dynamic Threat Matrix: three radio cards (necessity / threat level), then the chosen level's FIPS
// parameter sets and its overhead against Level 1. Same onyx ground and neutral hairlines as the rest of the page;
// emerald stays on the CTA.

const NOTES: Record<SecurityNecessity, string[]> = {
  enterprise: [
    'ML-KEM-512 replaces ECDH key agreement with the smallest module-lattice keys.',
    'ML-DSA-44 replaces RSA / ECDSA certificate signatures at category 2.',
    'Optimised for speed and bandwidth on high-volume enterprise traffic.',
  ],
  critical: [
    'ML-KEM-768 is the parameter set browsers and TLS libraries deploy by default.',
    'ML-DSA-65 signs certificates and handshakes at category 3.',
    'The recommended baseline for high-value targets and CII perimeters.',
  ],
  state: [
    'ML-KEM-1024 and ML-DSA-87, the largest finalized lattice parameter sets.',
    'SLH-DSA-SHA2-256s held in reserve: a stateless hash-based signature that survives even a break in lattice assumptions.',
    'For adversaries with state-level resources and data that must outlive the quantum horizon.',
  ],
}

const L1 = THREAT_LEVELS.enterprise
const L5 = THREAT_LEVELS.state
const MSS = 1460 // bytes per TCP segment
const INITCWND = 10 * MSS // RFC 6928 initial congestion window

const metrics = (t: ThreatLevel): [string, number][] => [
  ['Encapsulation', t.kex.pk + t.kex.out],
  ['Signing key', t.sig.pk],
  ['Signature', t.sig.out],
  ['Handshake', handshakeBytes(t)],
]
// each row is scaled to its Level 5 value, so the bars read directly as "share of the maximum"
const width = (b: number, row: number) => `${Math.max(2, (b / metrics(L5)[row][1]) * 100)}%`

const fade = { initial: { opacity: 0, y: 6 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: -6 }, transition: { duration: 0.25, ease: [0.2, 0, 0, 1] } } as const

function TradeOff({ t }: { t: ThreatLevel }) {
  const bytes = handshakeBytes(t)
  const x = (n: number) => `${n.toFixed(1)}×`
  if (t.id === 'enterprise')
    return (
      <>
        <span className="text-[#FAFAFA]">{fmtBytes(bytes)} per handshake</span>, {Math.ceil(bytes / MSS)} TCP segments: the lightest post-quantum
        footprint, at {t.equiv}-equivalent strength. Scaling to Level 5 buys {L5.equiv}-equivalent resilience but roughly doubles the lattice key
        material ({fmtBytes(handshakeBytes(L5))}, {x(handshakeBytes(L5) / bytes)}).
      </>
    )
  if (t.id === 'critical')
    return (
      <>
        <span className="text-[#FAFAFA]">{x(bytes / handshakeBytes(L1))} the bytes of Level 1</span> ({fmtBytes(bytes)} per handshake, still inside one
        TCP initial window) for {t.equiv}-equivalent resilience. The balance point between overhead and margin.
      </>
    )
  const fb = handshakeBytes(t, t.fallback)
  return (
    <>
      <span className="text-[#FAFAFA]">{x(bytes / handshakeBytes(L1))} the lattice key material of Level 1</span> ({fmtBytes(bytes)} per
      handshake) in exchange for {t.equiv}-equivalent quantum resilience, the highest NIST category. Falling back to SLH-DSA raises it to{' '}
      {fmtBytes(fb)}{fb > INITCWND ? ', past the initial congestion window, so one extra round trip' : ''}.
    </>
  )
}

export function ThreatMatrix({ value, onChange }: { value: SecurityNecessity; onChange: (id: SecurityNecessity) => void }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const t = THREAT_LEVELS[value]
  const vsBase = t.id !== L1.id // the Level 1 baseline bar only when there is something to compare it with

  // roving focus: arrow keys move through the radio group
  const onKey = (e: KeyboardEvent, i: number) => {
    const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
    if (!d) return
    e.preventDefault()
    const n = (i + d + NECESSITY_ORDER.length) % NECESSITY_ORDER.length
    onChange(NECESSITY_ORDER[n])
    refs.current[n]?.focus()
  }

  return (
    <div className="max-w-4xl">
      <div className="flex items-baseline justify-between gap-4">
        <p id="necessity-label" className="font-mono text-[11px] tracking-[0.14em] text-neutral-500 uppercase">Necessity / threat level</p>
        <p className="hidden font-mono text-[11px] text-neutral-600 sm:block">FIPS 203 · 204 · 205</p>
      </div>

      <div role="radiogroup" aria-labelledby="necessity-label" className="mt-4 grid gap-px overflow-hidden border border-neutral-800 bg-neutral-800 sm:grid-cols-3">
        {NECESSITY_ORDER.map((id, i) => {
          const c = THREAT_LEVELS[id]
          const on = id === value
          return (
            <button
              key={id}
              ref={(el) => { refs.current[i] = el }}
              role="radio"
              aria-checked={on}
              tabIndex={on ? 0 : -1}
              onClick={() => onChange(id)}
              onKeyDown={(e) => onKey(e, i)}
              className={`relative flex flex-col items-start p-5 text-left transition-colors focus-visible:z-10 focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-[#FAFAFA] ${on ? 'bg-[#111113]' : 'bg-[#09090B] hover:bg-[#0d0d0f]'}`}
            >
              {on && <motion.span layoutId="necessity-mark" className="absolute inset-x-0 top-0 h-px bg-[#FAFAFA]" transition={{ type: 'spring', visualDuration: 0.35, bounce: 0.1 }} />}
              <span className="flex w-full items-baseline justify-between gap-3">
                <span className={`font-display text-[15px] font-semibold tracking-[-0.01em] ${on ? 'text-[#FAFAFA]' : 'text-neutral-300'}`}>{c.label}</span>
                <span className="font-mono text-[10px] tracking-[0.12em] text-neutral-500 uppercase">{c.equiv}</span>
              </span>
              <span className="mt-4 flex items-baseline gap-2">
                <span className={`font-display text-3xl font-semibold tracking-[-0.03em] tabular-nums ${on ? 'text-[#FAFAFA]' : 'text-neutral-400'}`}>L{c.level}</span>
                <span className="font-mono text-[11px] text-neutral-500">NIST level</span>
              </span>
              <span className="mt-4 font-mono text-[12px] leading-relaxed text-neutral-400">
                {c.kex.name}
                <br />
                {c.sig.name}
                {c.fallback && (
                  <>
                    <br />
                    <span className="text-neutral-500">+ {c.fallback.name}</span>
                  </>
                )}
              </span>
            </button>
          )
        })}
      </div>

      <div className="border-x border-b border-neutral-800 p-5 sm:p-6">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={value} {...fade} className="grid gap-8 lg:min-h-[19rem] lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] lg:gap-10">
            <div>
              <p className="font-mono text-[11px] tracking-[0.12em] text-neutral-500 uppercase">
                Targets {levelText(t)} · {t.equiv} equivalent
              </p>
              <ul className="mt-4 space-y-2 font-mono text-[12px]">
                {[t.kex, t.sig, ...(t.fallback ? [t.fallback] : [])].map((a, i) => (
                  <li key={a.name} className="flex items-baseline gap-3">
                    <span className="w-16 shrink-0 text-neutral-500">{a.std}</span>
                    <span className="text-[#FAFAFA]">{a.name}</span>
                    {i === 2 && <span className="text-neutral-500">fallback</span>}
                  </li>
                ))}
              </ul>
              <ul className="mt-5 space-y-2 border-t border-neutral-800 pt-4 text-[13px] leading-relaxed text-neutral-400">
                {NOTES[value].map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            </div>

            <div>
              <div className="grid grid-cols-[6.5rem_minmax(0,1fr)_4.5rem] items-center gap-x-3 gap-y-2.5 font-mono text-[11px]">
                <span />
                <span className="flex gap-4 text-neutral-600">
                  {vsBase && <span className="flex items-center gap-1.5"><i className="inline-block h-1 w-3 bg-neutral-700" />level 1</span>}
                  <span className="flex items-center gap-1.5"><i className="inline-block h-1 w-3 bg-neutral-200" />level {t.level}</span>
                </span>
                <span />
                {metrics(t).map(([k, b], i) => (
                  <div key={k} className="contents">
                    <span className="text-neutral-500">{k}</span>
                    <span className="flex flex-col gap-1" aria-hidden>
                      {vsBase && <span className="h-1 bg-neutral-700" style={{ width: width(metrics(L1)[i][1], i) }} />}
                      <motion.span className="h-1 bg-neutral-200" initial={false} animate={{ width: width(b, i) }} transition={{ type: 'spring', visualDuration: 0.5, bounce: 0 }} />
                    </span>
                    <span className="text-right text-neutral-300 tabular-nums">{fmtBytes(b)}</span>
                  </div>
                ))}
                {t.fallback && (
                  <>
                    <span className="text-neutral-500">SLH-DSA sig</span>
                    <span className="text-neutral-600">fallback · off the bar scale</span>
                    <span className="text-right text-neutral-300 tabular-nums">{fmtBytes(t.fallback.out)}</span>
                  </>
                )}
              </div>
              <p className="mt-5 border-t border-neutral-800 pt-4 text-[12.5px] leading-relaxed text-neutral-400">
                <TradeOff t={t} />
              </p>
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  )
}
