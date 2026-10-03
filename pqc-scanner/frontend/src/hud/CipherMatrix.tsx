import { useRef, type KeyboardEvent } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { CIPHER_SUITES, SUITE_ORDER, fmtBytes, handshakeBytes, levelText, type CipherSuite, type CipherSuiteId } from './cipherSuite'

// Landing-page cipher-suite matrix: three radio cards, then the trade-offs of the chosen suite against the
// classical baseline. Same onyx ground and neutral hairlines as the rest of the page; emerald stays on the CTA.

const NOTES: Record<string, [string, string]> = {
  'X25519': ['X25519', 'Elliptic-curve Diffie–Hellman. Tiny and fast, but Shor’s algorithm recovers the shared secret from a recorded handshake.'],
  'RSA-2048': ['RSA-2048', 'Factoring-based signature. Forgeable once a cryptographically relevant quantum computer exists.'],
  'ML-KEM': ['ML-KEM', 'Fast module-lattice key encapsulation (FIPS 203), replacing ECDH. Encapsulation runs in tens of microseconds.'],
  'ML-DSA': ['ML-DSA', 'The primary lattice-based digital signature (FIPS 204), replacing RSA and ECDSA in certificates.'],
  'SLH-DSA': ['SLH-DSA', 'Conservative, stateless hash-based fallback (FIPS 205). Rests only on SHA-2, at the cost of very large signatures.'],
  'Hybrid': ['Hybrid', 'Classical and post-quantum run side by side: an attacker must break both, so a flaw in either alone is not fatal.'],
}
const NOTE_KEYS: Record<CipherSuiteId, string[]> = {
  classical: ['X25519', 'RSA-2048'],
  hybrid: ['ML-KEM', 'ML-DSA', 'Hybrid'],
  max: ['ML-KEM', 'SLH-DSA'],
}

const BASE = CIPHER_SUITES.classical
const MSS = 1460 // bytes per TCP segment
const INITCWND = 10 * MSS // RFC 6928 initial congestion window
// log scale so a 32 B curve point and a 29 KB hash-based signature share one axis
const LOG_MAX = Math.log10(40_000)
const width = (b: number) => `${Math.max(2, (Math.log10(Math.max(b, 1)) / LOG_MAX) * 100)}%`

const metrics = (s: CipherSuite): [string, number][] => [
  ['Key exchange', s.kex.pk + s.kex.out],
  ['Public key', s.sig.pk],
  ['Signature', s.sig.out],
  ['Handshake', handshakeBytes(s)],
]

const fade = { initial: { opacity: 0, y: 6 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: -6 }, transition: { duration: 0.25, ease: [0.2, 0, 0, 1] } } as const

export function CipherMatrix({ value, onChange }: { value: CipherSuiteId; onChange: (id: CipherSuiteId) => void }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const s = CIPHER_SUITES[value]
  const total = handshakeBytes(s)
  const segs = Math.ceil(total / MSS)
  const vsBase = s.id !== BASE.id // the baseline bar only when there is something to compare it with

  // roving focus: arrow keys move through the radio group
  const onKey = (e: KeyboardEvent, i: number) => {
    const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
    if (!d) return
    e.preventDefault()
    const n = (i + d + SUITE_ORDER.length) % SUITE_ORDER.length
    onChange(SUITE_ORDER[n])
    refs.current[n]?.focus()
  }

  return (
    <div className="max-w-4xl">
      <div className="flex items-baseline justify-between gap-4">
        <p id="suite-label" className="font-mono text-[11px] tracking-[0.14em] text-neutral-500 uppercase">Cipher suite under test</p>
        <p className="hidden font-mono text-[11px] text-neutral-600 sm:block">FIPS 203 · 204 · 205</p>
      </div>

      <div role="radiogroup" aria-labelledby="suite-label" className="mt-4 grid gap-px overflow-hidden border border-neutral-800 bg-neutral-800 sm:grid-cols-3">
        {SUITE_ORDER.map((id, i) => {
          const c = CIPHER_SUITES[id]
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
              {on && <motion.span layoutId="suite-mark" className="absolute inset-x-0 top-0 h-px bg-[#FAFAFA]" transition={{ type: 'spring', visualDuration: 0.35, bounce: 0.1 }} />}
              <span className="flex w-full items-baseline justify-between gap-3">
                <span className={`font-display text-[15px] font-semibold tracking-[-0.01em] ${on ? 'text-[#FAFAFA]' : 'text-neutral-300'}`}>{c.label}</span>
                <span className="font-mono text-[10px] tracking-[0.12em] text-neutral-500 uppercase">{c.tag}</span>
              </span>
              <span className="mt-3 font-mono text-[12px] leading-relaxed text-neutral-400">
                {c.kex.name}
                <br />
                {c.sig.name}
              </span>
              <span className={`mt-4 font-mono text-[11px] ${c.level ? 'text-neutral-300' : 'text-neutral-600'}`}>{levelText(c)}</span>
            </button>
          )
        })}
      </div>

      <div className="border-x border-b border-neutral-800 p-5 sm:p-6">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={value} {...fade} className="grid gap-8 lg:min-h-[15.75rem] lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] lg:gap-10">
            <ul className="space-y-4">
              {NOTE_KEYS[value].map((k) => {
                const [name, text] = NOTES[k]
                return (
                  <li key={k} className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-3 text-[13px] leading-relaxed">
                    <span className="font-mono text-[12px] text-[#FAFAFA]">{name}</span>
                    <span className="text-neutral-400">{text}</span>
                  </li>
                )
              })}
            </ul>

            <div>
              <div className="grid grid-cols-[6rem_minmax(0,1fr)_4.5rem] items-center gap-x-3 gap-y-2.5 font-mono text-[11px]">
                <span />
                <span className="flex gap-4 text-neutral-600">
                  {vsBase && <span className="flex items-center gap-1.5"><i className="inline-block h-1 w-3 bg-neutral-700" />classical</span>}
                  <span className="flex items-center gap-1.5"><i className="inline-block h-1 w-3 bg-neutral-200" />{s.label.toLowerCase()}</span>
                </span>
                <span />
                {metrics(s).map(([k, b], i) => {
                  const base = metrics(BASE)[i][1]
                  return (
                    <div key={k} className="contents">
                      <span className="text-neutral-500">{k}</span>
                      <span className="flex flex-col gap-1" aria-hidden>
                        {vsBase && <span className="h-1 bg-neutral-700" style={{ width: width(base) }} />}
                        <motion.span className="h-1 bg-neutral-200" initial={false} animate={{ width: width(b) }} transition={{ type: 'spring', visualDuration: 0.5, bounce: 0 }} />
                      </span>
                      <span className="text-right text-neutral-300 tabular-nums">{fmtBytes(b)}</span>
                    </div>
                  )
                })}
              </div>
              <p className="mt-5 border-t border-neutral-800 pt-4 text-[12.5px] leading-relaxed text-neutral-400">
                {s.level ? (
                  <>
                    <span className="text-[#FAFAFA]">{(total / handshakeBytes(BASE)).toFixed(0)}× the classical bytes</span> per handshake
                    ({segs} TCP segments{total > INITCWND ? ', past the initial congestion window, so one extra round trip' : ''}) in exchange for{' '}
                    <span className="text-[#FAFAFA]">{levelText(s)}</span> resilience
                    {s.level === 5 ? ', equivalent to AES-256' : ', equivalent to AES-192'}. An Ed25519 signature is 64 B; {s.sig.name} is {s.sig.out.toLocaleString('en-US')} B.
                  </>
                ) : (
                  <>
                    <span className="text-[#FAFAFA]">{fmtBytes(total)} per handshake</span>, one TCP segment. Smallest and fastest, but every session recorded today
                    is readable once a quantum adversary exists.
                  </>
                )}
              </p>
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  )
}
