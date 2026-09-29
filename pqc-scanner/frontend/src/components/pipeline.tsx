import { useEffect, useState, type ReactNode } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { Check } from 'lucide-react'

export const STEPS = ['Detect', 'Score', 'Defend', 'Prove', 'Rescan'] as const
export const ease = [0.2, 0, 0, 1] as const

/** Staggered children reveal. */
export const stagger = {
  hidden: {},
  show: { transition: { staggerChildren: 0.07, delayChildren: 0.05 } },
}
export const item = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { duration: 0.35, ease } },
}

// ── Stepper ──────────────────────────────────────────────────────────────────

export function Stepper({ current, reached, onSelect }: { current: number; reached: number; onSelect: (n: number) => void }) {
  return (
    <nav aria-label="Pipeline" className="relative">
      <div className="absolute top-[15px] right-[10%] left-[10%] h-px bg-white/10" aria-hidden />
      <motion.div
        className="absolute top-[15px] left-[10%] h-px bg-white/60"
        initial={false}
        animate={{ width: `${(Math.max(0, reached - 1) / (STEPS.length - 1)) * 80}%` }}
        transition={{ duration: 0.6, ease }}
        aria-hidden
      />
      <ol className="relative grid grid-cols-5">
        {STEPS.map((name, i) => {
          const n = i + 1
          const done = n < reached || (n === reached && n === STEPS.length && current === n)
          const active = n === current
          const locked = n > reached
          return (
            <li key={name} className="flex justify-center">
              <button
                disabled={locked}
                onClick={() => onSelect(n)}
                aria-current={active ? 'step' : undefined}
                className="group flex flex-col items-center gap-2 disabled:cursor-default"
              >
                <span className="relative grid size-[30px] place-items-center">
                  {active && (
                    <motion.span layoutId="step-active" className="absolute inset-0 rounded-full bg-white" transition={{ type: 'spring', stiffness: 420, damping: 36 }} />
                  )}
                  <span
                    className={`relative z-10 grid size-[30px] place-items-center rounded-full border font-mono text-[12px] transition-colors ${
                      active ? 'border-transparent text-black' : done ? 'border-white/20 bg-zinc-950 text-white' : 'border-white/10 bg-zinc-950 text-zinc-600'
                    }`}
                  >
                    {done && !active ? <Check size={13} strokeWidth={2.5} /> : n}
                  </span>
                </span>
                <span className={`text-[12px] font-medium transition-colors ${active ? 'text-white' : locked ? 'text-zinc-600' : 'text-zinc-400 group-hover:text-zinc-200'}`}>{name}</span>
              </button>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

// ── Cards and chips ──────────────────────────────────────────────────────────

export function Glass({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-white/5 bg-zinc-950/60 backdrop-blur-lg ${className}`}>{children}</div>
}

export interface Algo {
  role: 'Signature' | 'Key exchange'
  name: string
  safe: boolean
  note: string
}

/** Shares a layoutId per role, so the chip glides between steps and morphs on patch. */
export function AlgoChip({ algo, delay = 0 }: { algo: Algo; delay?: number }) {
  return (
    <motion.div
      layout
      layoutId={`chip-${algo.role}`}
      transition={{ layout: { duration: 0.5, ease } }}
      className="flex items-center justify-between gap-4 rounded-xl border border-white/5 bg-black/40 px-4 py-3.5"
    >
      <div className="min-w-0">
        <div className="text-[11px] font-medium tracking-wide text-zinc-500 uppercase">{algo.role}</div>
        <motion.div
          key={algo.name}
          initial={{ opacity: 0, y: 6, filter: 'blur(4px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          transition={{ duration: 0.4, delay, ease }}
          className="mt-0.5 font-mono text-[17px] text-white"
        >
          {algo.name}
        </motion.div>
        <div className="mt-0.5 text-[12px] text-zinc-500">{algo.note}</div>
      </div>
      <motion.span
        key={`${algo.name}-state`}
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.3, delay }}
        className="inline-flex shrink-0 items-center gap-2 rounded-full border border-white/5 px-2.5 py-1 text-[12px] text-zinc-300"
      >
        <span className={`size-1.5 rounded-full ${algo.safe ? 'bg-safe' : 'bg-risk'}`} />
        {algo.safe ? 'Quantum-safe' : 'Vulnerable'}
      </motion.span>
    </motion.div>
  )
}

// ── CWM risk gauge ───────────────────────────────────────────────────────────

/** Semicircle 0..100 with Low / High / CRITICAL bands (40, 70). The arc fills to the CWM score. */
export function RiskGauge({ score, severity }: { score: number; severity: 'Low' | 'High' | 'CRITICAL' }) {
  const r = 86
  const cx = 110
  const cy = 104
  const pt = (f: number, rad = r) => [cx + rad * Math.cos(Math.PI * (1 - f)), cy - rad * Math.sin(Math.PI * (1 - f))]
  const arc = (from: number, to: number) => {
    const [x1, y1] = pt(from)
    const [x2, y2] = pt(to)
    return `M ${x1} ${y1} A ${r} ${r} 0 0 1 ${x2} ${y2}`
  }
  const color = severity === 'CRITICAL' ? '#ef4444' : severity === 'High' ? '#f59e0b' : '#10b981'
  return (
    <div className="relative mx-auto w-full max-w-[320px]">
      <svg viewBox="0 0 220 124" className="w-full" role="img" aria-label={`CWM risk score ${score} of 100: ${severity}`}>
        <defs>
          <linearGradient id="riskfill" x1="0" x2="1">
            <stop offset="0%" stopColor="#10b981" />
            <stop offset="36%" stopColor="#10b981" />
            <stop offset="44%" stopColor="#f59e0b" />
            <stop offset="66%" stopColor="#f59e0b" />
            <stop offset="74%" stopColor="#ef4444" />
            <stop offset="100%" stopColor="#ef4444" />
          </linearGradient>
        </defs>
        <path d={arc(0, 0.4)} stroke="rgb(16 185 129 / 0.18)" strokeWidth="12" fill="none" />
        <path d={arc(0.4, 0.7)} stroke="rgb(245 158 11 / 0.18)" strokeWidth="12" fill="none" />
        <path d={arc(0.7, 1)} stroke="rgb(239 68 68 / 0.18)" strokeWidth="12" fill="none" />
        <motion.path
          d={arc(0, 0.9999)}
          stroke="url(#riskfill)"
          strokeWidth="12"
          fill="none"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: Math.min(1, score / 100) }}
          transition={{ duration: 1.2, ease }}
        />
        {[0.4, 0.7].map((f) => {
          const [x1, y1] = pt(f, r - 10)
          const [x2, y2] = pt(f, r + 10)
          const [tx, ty] = pt(f, r + 18)
          return (
            <g key={f}>
              <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#fafafa" strokeWidth="1" opacity="0.6" />
              <text x={tx} y={ty} textAnchor="middle" fontSize="7.5" fill="#71717a" fontFamily="JetBrains Mono Variable, monospace">
                {f * 100}
              </text>
            </g>
          )
        })}
      </svg>
      <div className="absolute inset-x-0 bottom-0 text-center">
        <motion.div key={severity} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.9, duration: 0.3 }} className="font-mono text-[13px] font-semibold tracking-[0.2em]" style={{ color }}>
          {severity.toUpperCase()}
        </motion.div>
        <div className="font-mono text-2xl text-white tabular-nums">
          {score}
          <span className="text-sm text-zinc-500"> / 100</span>
        </div>
      </div>
    </div>
  )
}

/** "Validate Math": hover or focus reveals the formula with this asset's values. */
export function ValidateMath({ lines }: { lines: { label: string; value: string }[]; }) {
  const [open, setOpen] = useState(false)
  return (
    <span className="relative inline-block" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button
        type="button"
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-describedby="validate-math"
        className="font-mono text-[12px] text-zinc-400 underline decoration-white/20 underline-offset-4 transition-colors hover:text-white hover:decoration-white/60"
      >
        Validate Math
      </button>
      {open && (
        <motion.span
          id="validate-math"
          role="tooltip"
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.15 }}
          className="absolute top-full left-1/2 z-40 mt-2 block w-[min(460px,85vw)] -translate-x-1/2 rounded-xl border border-white/15 bg-black p-4 text-left shadow-2xl"
        >
          {lines.map((l) => (
            <span key={l.label} className="mt-2 block first:mt-0">
              <span className="block text-[10.5px] font-medium tracking-wide text-zinc-500 uppercase">{l.label}</span>
              <span className="mt-0.5 block font-mono text-[12.5px] leading-relaxed break-words text-white">{l.value}</span>
            </span>
          ))}
        </motion.span>
      )}
    </span>
  )
}

// ── Typing terminal ──────────────────────────────────────────────────────────

export interface TermLine {
  text: string
  tone?: 'dim' | 'ok' | 'bad' | 'strong'
}

/** Types lines out character by character; calls onDone once finished. */
export function TypeTerminal({ lines, title, cps = 520, onDone }: { lines: TermLine[]; title: string; cps?: number; onDone?: () => void }) {
  const reduced = useReducedMotion()
  const total = lines.reduce((n, l) => n + l.text.length + 1, 0)
  const [shown, setShown] = useState(reduced ? total : 0)
  useEffect(() => {
    if (reduced) {
      onDone?.()
      return
    }
    setShown(0)
    const start = performance.now()
    let raf = 0
    const tick = (now: number) => {
      const n = Math.min(total, Math.floor(((now - start) / 1000) * cps))
      setShown(n)
      if (n < total) raf = requestAnimationFrame(tick)
      else onDone?.()
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [total, reduced])

  let left = shown
  const tone = { dim: 'text-zinc-500', ok: 'text-safe', bad: 'text-risk', strong: 'text-white' }
  return (
    <div className="overflow-hidden rounded-xl border border-white/5 bg-black/60">
      <div className="flex items-center gap-1.5 border-b border-white/5 px-4 py-2.5">
        <span className="size-2 rounded-full bg-zinc-700" />
        <span className="size-2 rounded-full bg-zinc-700" />
        <span className="size-2 rounded-full bg-zinc-700" />
        <span className="ml-2 font-mono text-[11px] text-zinc-500">{title}</span>
      </div>
      <pre className="min-h-[220px] overflow-x-auto p-4 font-mono text-[11.5px] leading-6 text-zinc-300">
        {lines.map((l, i) => {
          if (left <= 0) return null
          const part = l.text.slice(0, left)
          left -= l.text.length + 1
          const typing = left < 0
          return (
            <div key={i} className={l.tone ? tone[l.tone] : ''}>
              {part}
              {typing && <span className="ml-px inline-block h-3.5 w-1.5 translate-y-0.5 animate-pulse bg-zinc-300" />}
            </div>
          )
        })}
      </pre>
    </div>
  )
}

// ── Before / after impact ────────────────────────────────────────────────────

export interface ImpactSide {
  signature: string
  kex: string
  kexPq: boolean
  cwm: number
  severity: 'Low' | 'High' | 'CRITICAL'
  pqcScore: number
  vulnerable: number
}

function Metric({ label, value, tone }: { label: string; value: ReactNode; tone: 'risk' | 'safe' | 'warn' }) {
  return (
    <div className="flex items-baseline justify-between border-t border-white/5 py-2 text-[13px]">
      <span className="text-zinc-500">{label}</span>
      <span className="flex items-center gap-2 font-mono text-white">
        <span className={`size-1.5 rounded-full ${tone === 'risk' ? 'bg-risk' : tone === 'warn' ? 'bg-warn' : 'bg-safe'}`} />
        {value}
      </span>
    </div>
  )
}

const sevTone = (s: ImpactSide['severity']) => (s === 'CRITICAL' ? 'risk' : s === 'High' ? 'warn' : 'safe')

export function ImpactPanel({ before, after, domain }: { before: ImpactSide; after: ImpactSide; domain: string }) {
  return (
    <motion.section variants={stagger} initial="hidden" animate="show" className="mt-6">
      <motion.h3 variants={item} className="text-[13px] font-medium tracking-wide text-zinc-400 uppercase">
        Quantum safety impact · {domain}
      </motion.h3>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <motion.div variants={item}>
          <Glass className="h-full p-6">
            <div className="flex items-center gap-2 text-[12px] font-medium text-zinc-400">
              <span className="size-1.5 rounded-full bg-risk" /> Before · classical
            </div>
            <div className="mt-3 font-mono text-[15px] text-white">
              {before.signature} <span className="text-zinc-600">+</span> {before.kex}
            </div>
            <p className="mt-3 text-[14px] leading-relaxed text-zinc-300">
              <span className="font-mono text-[13px] text-zinc-100">{before.signature}</span>: vulnerable to Shor's algorithm. A cryptographically relevant quantum computer (CRQC)
              could forge signatures to impersonate your servers{before.kexPq ? '.' : ', and decrypt traffic recorded today.'}
            </p>
            <div className="mt-4">
              <Metric label="CWM risk" value={`${before.cwm} · ${before.severity}`} tone={sevTone(before.severity)} />
              <Metric label="PQC score" value={`${before.pqcScore} / 100`} tone="risk" />
              <Metric label="Quantum-vulnerable algorithms" value={before.vulnerable} tone={before.vulnerable ? 'risk' : 'safe'} />
            </div>
          </Glass>
        </motion.div>
        <motion.div variants={item}>
          <Glass className="h-full border-safe/20! p-6">
            <div className="flex items-center gap-2 text-[12px] font-medium text-zinc-400">
              <span className="size-1.5 rounded-full bg-safe" /> After · post-quantum
            </div>
            <div className="mt-3 font-mono text-[15px] text-white">
              {after.signature} <span className="text-zinc-600">+</span> {after.kex}
            </div>
            <p className="mt-3 text-[14px] leading-relaxed text-zinc-300">
              <span className="font-mono text-[13px] text-zinc-100">ML-DSA</span> &amp; <span className="font-mono text-[13px] text-zinc-100">ML-KEM</span>: built on lattice
              problems (Module-LWE) with no known efficient quantum attack, standardized by NIST in FIPS 204 and FIPS 203. They keep signatures and key exchange secure
              against future CRQCs.
            </p>
            <div className="mt-4">
              <Metric label="CWM risk" value={`${after.cwm} · ${after.severity}`} tone={sevTone(after.severity)} />
              <Metric label="PQC score" value={`${after.pqcScore} / 100 · PQC-ready`} tone="safe" />
              <Metric label="Quantum-vulnerable algorithms" value={after.vulnerable} tone={after.vulnerable ? 'risk' : 'safe'} />
            </div>
          </Glass>
        </motion.div>
      </div>
    </motion.section>
  )
}
