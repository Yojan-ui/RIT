import { motion } from 'framer-motion'
import type { ReactNode } from 'react'
import type { Tone } from '../api'

export type Status = 'safe' | 'risk' | 'warn' | 'idle'

export const TONE_STATUS: Record<Tone, Status> = { emerald: 'safe', amber: 'warn', crimson: 'risk' }

const DOT: Record<Status, string> = {
  safe: 'bg-safe',
  risk: 'bg-risk',
  warn: 'bg-warn',
  idle: 'bg-zinc-600',
}
const LINE: Record<Status, string> = {
  safe: 'border-safe',
  risk: 'border-risk',
  warn: 'border-warn',
  idle: 'border-zinc-700',
}

/** Snappy, non-bouncy reveal used everywhere. */
export const reveal = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.18, ease: [0.2, 0, 0, 1] as const },
}

export function Dot({ status, className = '' }: { status: Status; className?: string }) {
  return <span aria-hidden className={`inline-block size-1.5 shrink-0 rounded-full ${DOT[status]} ${className}`} />
}

export function StatusLabel({ status, children }: { status: Status; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 text-[13px] whitespace-nowrap text-zinc-300">
      <Dot status={status} />
      {children}
    </span>
  )
}

export const algoStatus = (quantumSafe: boolean): Status => (quantumSafe ? 'safe' : 'risk')

export function Panel({ title, action, children, className = '' }: { title?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-white/10 bg-black/40 backdrop-blur-md ${className}`}>
      {title && (
        <header className="flex items-center justify-between border-b border-white/10 px-5 py-3">
          <h4 className="text-[13px] font-medium text-white">{title}</h4>
          {action}
        </header>
      )}
      <div className="p-5">{children}</div>
    </section>
  )
}

export function KV({ label, children, mono }: { label: string; children: ReactNode; mono?: boolean }) {
  return (
    <div className="grid grid-cols-[140px_1fr] items-baseline gap-4 border-b border-white/[0.06] py-2.5 last:border-0">
      <dt className="text-[13px] text-zinc-500">{label}</dt>
      <dd className={`min-w-0 text-[13px] break-words text-zinc-100 ${mono ? 'font-mono text-[12.5px]' : ''}`}>{children}</dd>
    </div>
  )
}

/** Accent-line callout: status carried by a thin left border and a dot, not a coloured box. */
export function Callout({ status, title, children }: { status: Status; title: string; children?: ReactNode }) {
  return (
    <motion.div {...reveal} className={`border-l-2 py-1 pl-4 ${LINE[status]}`} role="status">
      <div className="flex items-center gap-2 text-sm font-medium text-white">
        <Dot status={status} />
        {title}
      </div>
      {children && <p className="mt-1 text-[13px] leading-relaxed text-zinc-400">{children}</p>}
    </motion.div>
  )
}

export function Button({ children, onClick, variant = 'primary', disabled, type = 'button', icon }: {
  children: ReactNode
  onClick?: () => void
  variant?: 'primary' | 'ghost'
  disabled?: boolean
  type?: 'button' | 'submit'
  icon?: ReactNode
}) {
  const style =
    variant === 'primary'
      ? 'bg-white text-black hover:bg-zinc-200'
      : 'border border-white/10 text-zinc-300 hover:border-white/20 hover:bg-white/[0.04] hover:text-white'
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex h-9 items-center justify-center gap-2 rounded-md px-3.5 text-[13px] font-medium transition-colors duration-150 focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-white/50 disabled:cursor-not-allowed disabled:opacity-40 ${style}`}
    >
      {icon}
      {children}
    </button>
  )
}

export function Th({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <th className={`px-3 py-2.5 text-left text-[11px] font-medium tracking-wide text-zinc-500 uppercase ${className}`}>{children}</th>
}
export function Td({ children, mono, className = '' }: { children: ReactNode; mono?: boolean; className?: string }) {
  return <td className={`px-3 py-2.5 align-top text-[13px] ${mono ? 'font-mono text-[12.5px] text-zinc-100' : 'text-zinc-300'} ${className}`}>{children}</td>
}

export function DataTable({ head, children, minWidth = 560 }: { head: ReactNode; children: ReactNode; minWidth?: number }) {
  return (
    <div className="-mx-5 overflow-x-auto">
      <table className="w-full border-collapse" style={{ minWidth }}>
        <thead className="border-b border-white/10">
          <tr>{head}</tr>
        </thead>
        <tbody className="[&>tr]:border-b [&>tr]:border-white/[0.06] [&>tr:last-child]:border-0 [&_td:first-child]:pl-5 [&_td:last-child]:pr-5 [&_th:first-child]:pl-5">
          {children}
        </tbody>
      </table>
    </div>
  )
}

/** Terminal-style block for commands and ledger output. */
export function Terminal({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-lg border border-white/10 bg-zinc-950">
      <div className="flex items-center gap-2 border-b border-white/10 px-4 py-2">
        <span className="size-2 rounded-full bg-zinc-700" />
        <span className="size-2 rounded-full bg-zinc-700" />
        <span className="size-2 rounded-full bg-zinc-700" />
        <span className="ml-2 font-mono text-[11px] text-zinc-500">{title}</span>
      </div>
      <pre className="overflow-x-auto p-4 font-mono text-[12px] leading-6 text-zinc-300">{children}</pre>
    </div>
  )
}

export function StageHeader({ n, title, description, action }: { n: number; title: string; description: string; action?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <div className="font-mono text-[11px] text-zinc-500">0{n}</div>
        <h3 className="mt-1 text-base font-medium text-white">{title}</h3>
        <p className="mt-1 max-w-xl text-[13px] leading-relaxed text-zinc-400">{description}</p>
      </div>
      {action}
    </div>
  )
}
