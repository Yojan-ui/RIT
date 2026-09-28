import { motion } from 'framer-motion'
import { Check, Lock, ShieldAlert, ShieldCheck } from 'lucide-react'
import { forwardRef, type ReactNode } from 'react'
import type { Tone } from '../api'

export const TONE: Record<Tone, { text: string; bg: string; ring: string; hex: string }> = {
  emerald: { text: 'text-emerald-300', bg: 'bg-emerald-400/10', ring: 'ring-emerald-400/40', hex: '#34d399' },
  amber: { text: 'text-amber-300', bg: 'bg-amber-400/10', ring: 'ring-amber-400/40', hex: '#fbbf24' },
  crimson: { text: 'text-rose-300', bg: 'bg-rose-500/10', ring: 'ring-rose-400/50', hex: '#f43f5e' },
}

export function Card({ title, icon, children, className = '' }: { title: string; icon: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl border border-white/[0.08] bg-white/[0.03] p-5 ${className}`}>
      <h4 className="mb-3 flex items-center gap-2 text-[11px] font-semibold tracking-[0.14em] text-zinc-400 uppercase">
        <span className="text-zinc-500">{icon}</span>
        {title}
      </h4>
      {children}
    </section>
  )
}

export function Field({ label, children, mono }: { label: string; children: ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-white/[0.05] py-2 last:border-0">
      <dt className="shrink-0 text-xs text-zinc-500">{label}</dt>
      <dd className={`min-w-0 text-right text-sm break-words text-zinc-100 ${mono ? 'font-mono text-[13px]' : ''}`}>{children}</dd>
    </div>
  )
}

export function Verdict({ safe }: { safe: boolean }) {
  return safe ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-400/10 px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap text-emerald-300">
      <ShieldCheck size={12} /> Quantum-safe
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/10 px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap text-rose-300">
      <ShieldAlert size={12} /> Shor-vulnerable
    </span>
  )
}

/** Shows `now`; when `was` differs it is struck through beside the new value, marked simulated. */
export function Changed({ was, now, migrated }: { was: string; now: string; migrated: boolean }) {
  if (!migrated || was === now) return <span>{now}</span>
  return (
    <motion.span initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="inline-flex flex-wrap items-baseline justify-end gap-x-2">
      <span className="text-zinc-500 line-through decoration-rose-400/70">{was}</span>
      <span className="text-emerald-300">{now}</span>
    </motion.span>
  )
}

export function ScoreRing({ score, tone, grade, size = 'size-32' }: { score: number; tone: Tone; grade: string; size?: string }) {
  const r = 46
  const c = 2 * Math.PI * r
  return (
    <div className={`relative shrink-0 ${size}`}>
      <svg viewBox="0 0 120 120" className="size-full -rotate-90">
        <circle cx="60" cy="60" r={r} fill="none" stroke="rgb(255 255 255 / 0.08)" strokeWidth="9" />
        <motion.circle
          cx="60" cy="60" r={r} fill="none" stroke={TONE[tone].hex} strokeWidth="9" strokeLinecap="round" strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: c * (1 - score / 100), stroke: TONE[tone].hex }}
          transition={{ duration: 1.2, ease: [0.22, 1, 0.36, 1] }}
          style={{ filter: `drop-shadow(0 0 8px ${TONE[tone].hex})` }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <motion.span key={score} initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="text-3xl font-semibold tracking-tight text-white tabular-nums">
          {score}
        </motion.span>
        <span className="text-[10px] tracking-widest text-zinc-500 uppercase">PQC score</span>
        <span className="mt-0.5 text-[11px] font-semibold text-zinc-300">Grade {grade}</span>
      </div>
    </div>
  )
}

export type StageStatus = 'active' | 'done'

/** One chapter of the Detect → Score → Defend → Prove story. Slides in when unlocked. */
export const Stage = forwardRef<HTMLElement, { n: number; title: string; subtitle: string; status: StageStatus; accent: string; children: ReactNode }>(
  function Stage({ n, title, subtitle, status, accent, children }, ref) {
    return (
      <motion.section
        ref={ref}
        initial={{ opacity: 0, y: 40, filter: 'blur(6px)' }}
        animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
        transition={{ type: 'spring', stiffness: 120, damping: 20 }}
        className="relative scroll-mt-24 rounded-3xl border border-white/10 bg-zinc-950/60 p-4 shadow-[0_40px_120px_-40px_rgb(0_0_0/0.9)] backdrop-blur-2xl sm:p-6"
      >
        <header className="mb-5 flex items-center gap-3">
          <span
            className="grid size-9 shrink-0 place-items-center rounded-full text-sm font-bold text-zinc-950"
            style={{ background: accent, boxShadow: `0 0 24px -4px ${accent}` }}
          >
            {status === 'done' ? <Check size={18} strokeWidth={3} /> : n}
          </span>
          <div>
            <div className="text-[11px] font-semibold tracking-[0.2em] text-zinc-500 uppercase">Stage {n}</div>
            <h3 className="text-lg font-semibold tracking-tight text-white sm:text-xl">
              {title} <span className="font-normal text-zinc-500">· {subtitle}</span>
            </h3>
          </div>
        </header>
        {children}
      </motion.section>
    )
  },
)

export function NextButton({ onClick, children, tone = 'white', disabled, icon }: { onClick: () => void; children: ReactNode; tone?: 'white' | 'rose' | 'emerald' | 'sky'; disabled?: boolean; icon?: ReactNode }) {
  const styles = {
    white: 'bg-white text-zinc-950 hover:bg-zinc-100',
    rose: 'bg-rose-500 text-white hover:bg-rose-400 shadow-[0_0_40px_-8px_#f43f5e]',
    emerald: 'bg-emerald-400 text-emerald-950 hover:bg-emerald-300 shadow-[0_0_40px_-8px_#34d399]',
    sky: 'bg-sky-400 text-sky-950 hover:bg-sky-300 shadow-[0_0_40px_-8px_#38bdf8]',
  }[tone]
  return (
    <motion.button
      whileHover={{ scale: disabled ? 1 : 1.02 }}
      whileTap={{ scale: disabled ? 1 : 0.98 }}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center justify-center gap-2 rounded-2xl px-5 py-3 text-sm font-bold tracking-wide transition disabled:cursor-not-allowed disabled:opacity-50 sm:text-base ${styles}`}
    >
      {icon}
      {children}
    </motion.button>
  )
}

export function Locked({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-white/[0.06] px-2 py-0.5 text-[11px] font-medium text-zinc-400">
      <Lock size={11} /> {label}
    </span>
  )
}
