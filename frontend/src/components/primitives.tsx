import { Check, Copy } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import type { Status } from '@/lib/types'

export function Lamp({ className, pulse = false }: { className: string; pulse?: boolean }) {
  return (
    <span className="relative inline-flex size-2 shrink-0" aria-hidden>
      {pulse && <span className={cn('absolute inset-0 animate-ping opacity-60', className)} />}
      <span className={cn('relative inline-block size-2', className)} />
    </span>
  )
}

/** Section opener: a title, one plain sentence on what it is for, and optional controls. */
export function SectionHeader({
  id,
  title,
  lede,
  children,
}: {
  id: string
  title: string
  lede?: ReactNode
  children?: ReactNode
}) {
  return (
    <header className="mb-3 flex flex-wrap items-end justify-between gap-x-6 gap-y-2 border-b border-line pb-2">
      <div className="min-w-0">
        <h2 id={id} className="section-title">
          {title}
        </h2>
        {lede && <p className="section-lede">{lede}</p>}
      </div>
      {children}
    </header>
  )
}

export function CopyButton({ value, label, text = 'COPY' }: { value: string; label: string; text?: string }) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 1400)
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
        'inline-flex h-6 shrink-0 items-center gap-1.5 border px-2 text-[10.5px] font-bold tracking-[0.08em] active:translate-y-px',
        copied ? 'border-ok bg-ok text-accent-ink' : 'border-line text-ink-2 hover:border-ink hover:text-ink',
      )}
    >
      {copied ? <Check className="size-3" aria-hidden /> : <Copy className="size-3" aria-hidden />}
      {copied ? 'COPIED' : text}
    </button>
  )
}

/** Literal DNS/config text: monospace, wraps anywhere so long keys never overflow. */
export function RawRecord({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex items-start gap-3 border border-line bg-sunken p-3">
      <pre className="min-w-0 flex-1 font-mono text-[11.5px] leading-relaxed break-all whitespace-pre-wrap text-ink">
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
          className={cn('h-3 w-1', n <= severity ? (severity >= 4 ? 'bg-crit' : 'bg-warn') : 'bg-line')}
        />
      ))}
    </span>
  )
}

// Flat, solid fills with a glyph, so severity survives colour blindness and
// greyscale print. N/A and N/M are dashed outlines: not a verdict.
const BADGE: Record<Status, { glyph: string; label: string; meaning: string; className: string }> = {
  fail: { glyph: '✕', label: 'FAIL', meaning: 'exploitable now', className: 'border-crit bg-crit text-accent-ink' },
  warn: { glyph: '!', label: 'WARN', meaning: 'weakened', className: 'border-warn bg-warn text-accent-ink' },
  pass: { glyph: '✓', label: 'PASS', meaning: 'protected', className: 'border-ok bg-ok text-accent-ink' },
  info: { glyph: '–', label: 'N/A', meaning: 'not applicable', className: 'border-dashed border-na text-ink-3' },
  error: { glyph: '?', label: 'N/M', meaning: 'not measured', className: 'border-dashed border-na text-ink-3' },
}

/** Square status block: glyph + label. `compact` is a 16px glyph cell for matrices. */
export function StatusBadge({ status, compact = false }: { status: Status; compact?: boolean }) {
  const b = BADGE[status]
  return (
    <span
      title={`${b.label}: ${b.meaning}`}
      className={cn(
        'inline-flex shrink-0 items-center justify-center border font-bold',
        compact ? 'size-4 text-[10px]' : 'h-5 min-w-[4.5rem] gap-1.5 px-1.5 text-[10.5px] tracking-[0.1em]',
        b.className,
      )}
    >
      <span aria-hidden>{b.glyph}</span>
      {!compact && b.label}
      <span className="sr-only">
        {compact ? b.label : ''}, {b.meaning}
      </span>
    </span>
  )
}
