import { Check, Copy } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { STATUS_TONE } from '@/lib/meta'
import type { Status } from '@/lib/types'

export function Lamp({ className, pulse = false }: { className: string; pulse?: boolean }) {
  return (
    <span className="relative inline-flex size-2 shrink-0" aria-hidden>
      {pulse && <span className={cn('absolute inset-0 animate-ping rounded-full opacity-60', className)} />}
      <span className={cn('relative inline-block size-2 rounded-full', className)} />
    </span>
  )
}

export function PanelHeader({ label, children, hidden }: { label: string; children?: ReactNode; hidden?: boolean }) {
  return (
    <header
      className={cn(
        'flex min-h-9 shrink-0 items-center justify-between gap-3 border-b border-white/10 px-4 py-2',
        hidden && 'sr-only',
      )}
    >
      <h2 className="eyebrow">{label}</h2>
      {children}
    </header>
  )
}

export function CopyButton({ value, label, text = 'COPY' }: { value: string; label: string; text?: string }) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 1200)
    return () => clearTimeout(t)
  }, [copied])

  return (
    <button
      type="button"
      onClick={() =>
        navigator.clipboard?.writeText(value).then(
          () => setCopied(true),
          () => {},
        )
      }
      aria-label={copied ? `${label} copied` : `Copy ${label}`}
      className={cn(
        'inline-flex h-6 shrink-0 items-center gap-1 rounded-sm border px-1.5 font-mono text-[10px] tracking-wider',
        'transition-colors duration-75 active:translate-y-px',
        copied
          ? 'border-ok/50 text-ok'
          : 'border-line-strong text-slate-400 hover:border-slate-500 hover:text-slate-200',
      )}
    >
      {copied ? <Check className="size-3" aria-hidden /> : <Copy className="size-3" aria-hidden />}
      {copied ? 'COPIED' : text}
    </button>
  )
}

/** Monospace block for raw DNS strings; wraps anywhere so long keys never overflow. */
export function RawRecord({ value, label }: { value: string; label: string }) {
  return (
    <div className="group flex items-start gap-2 rounded-sm border border-line bg-obsidian p-2">
      <pre className="min-w-0 flex-1 font-mono text-[11.5px] leading-relaxed break-all whitespace-pre-wrap text-slate-300">
        {value}
      </pre>
      <CopyButton value={value} label={label} />
    </div>
  )
}

export function SeverityPips({ severity }: { severity: number }) {
  return (
    <span className="inline-flex gap-0.5" role="img" aria-label={`Severity ${severity} of 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <span
          key={n}
          className={cn(
            'h-2.5 w-1 rounded-[1px]',
            n <= severity ? 'bg-slate-300' : 'bg-line-strong light:bg-[#c8c8c8]',
          )}
        />
      ))}
    </span>
  )
}

// Severity reads from fill weight first, glyph second, colour third, so it
// survives light mode, colour blindness and greyscale print. text-black
// flips to white in light mode, where the fills drop to their 700 shades.
const BADGE: Record<Status, { glyph: string; label: string; meaning: string; className: string }> = {
  fail: { glyph: '✕', label: 'FAIL', meaning: 'exploitable now', className: 'border-crit bg-crit text-black' },
  warn: { glyph: '!', label: 'WARN', meaning: 'weakened', className: 'border-warn bg-warn text-black' },
  pass: { glyph: '✓', label: 'PASS', meaning: 'protected', className: 'border-ok text-ok' },
  info: { glyph: '–', label: 'N/A', meaning: 'not applicable', className: 'border-dashed border-na text-slate-500' },
  error: { glyph: '?', label: 'N/M', meaning: 'not measured', className: 'border-dashed border-na text-slate-500' },
}

/** Brutalist status badge: solid block for FAIL/WARN, 1px outline for PASS. */
export function StatusBadge({ status, compact = false }: { status: Status; compact?: boolean }) {
  const b = BADGE[status]
  return (
    <span
      title={`${b.label}: ${b.meaning}`}
      className={cn(
        'inline-flex shrink-0 items-center justify-center gap-1 border font-mono font-bold tracking-[0.12em]',
        compact ? 'h-5 w-10 text-[9px]' : 'h-5 min-w-[4.25rem] px-1.5 text-[10px]',
        b.className,
      )}
    >
      {!compact && <span aria-hidden>{b.glyph}</span>}
      {b.label}
      <span className="sr-only">, {b.meaning}</span>
    </span>
  )
}

/** One-line key for the badges, for readers who do not know the jargon. */
export function StatusLegend() {
  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[10px] text-slate-500">
      {(['fail', 'warn', 'pass'] as const).map((s) => (
        <span key={s} className="inline-flex items-center gap-1.5">
          <StatusBadge status={s} />
          {BADGE[s].meaning}
        </span>
      ))}
    </p>
  )
}

/** Minimal pill badge for a check's status. */
export function StatusPill({ status, className }: { status: Status; className?: string }) {
  const tone = STATUS_TONE[status]
  return (
    <span
      className={cn(
        'inline-flex h-5 shrink-0 items-center rounded-full border px-2 font-mono text-[9.5px] font-medium tracking-wider',
        PILL_FILL[status],
        tone.border,
        tone.text,
        className,
      )}
    >
      {status === 'error' ? 'N/M' : status === 'info' ? 'N/A' : tone.label}
    </span>
  )
}

const PILL_FILL: Record<Status, string> = {
  pass: 'bg-ok/10',
  warn: 'bg-warn/10',
  fail: 'bg-crit/10',
  info: 'bg-white/[0.03]',
  error: 'bg-white/[0.03]',
}
