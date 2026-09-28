import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { scanTranscript, tailEntry, type Channel, type Level, type LogEntry } from '@/lib/telemetry'
import type { ScanReport } from '@/lib/types'
import { Lamp } from './primitives'

const MAX_LINES = 300

interface LogLine extends LogEntry {
  id: number
  ts: number
}

const LEVEL_TEXT: Record<Level, string> = {
  ok: 'text-ok',
  warn: 'text-warn',
  err: 'text-crit',
  info: 'text-ink',
  dim: 'text-ink-3',
}

// Channels are told apart by weight, not a rainbow: the text column carries the colour.
const CHANNEL_TEXT: Record<Channel, string> = {
  SYS: 'text-ink-3',
  DNS: 'text-accent',
  HTTP: 'text-accent',
  SMTP: 'text-accent',
  TLS: 'text-accent',
}

const clock = (ts: number) => {
  const d = new Date(ts)
  return `${d.toLocaleTimeString('en-GB', { hour12: false })}.${String(d.getMilliseconds()).padStart(3, '0')}`
}

/**
 * Scan log. Replays the current scan's observations as a probe
 * transcript, then keeps appending simulated monitoring lines. Auto-follows
 * the tail unless the user scrolls up.
 */
export function Telemetry({
  report,
  pending,
  className,
}: {
  report: ScanReport
  pending?: string
  /** Merged onto the outer section, e.g. to drop the panel border when embedded. */
  className?: string
}) {
  const [lines, setLines] = useState<LogLine[]>([])
  const [paused, setPaused] = useState(false)
  const [following, setFollowing] = useState(true)
  const nextId = useRef(0)
  const pausedRef = useRef(paused)
  const body = useRef<HTMLDivElement>(null)

  useEffect(() => {
    pausedRef.current = paused
  }, [paused])

  const append = (entry: LogEntry) =>
    setLines((prev) => {
      const next = [...prev, { ...entry, id: ++nextId.current, ts: Date.now() }]
      return next.length > MAX_LINES ? next.slice(-MAX_LINES) : next
    })

  // Replay the transcript for each new report, then tail forever.
  useEffect(() => {
    const script = scanTranscript(report)
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let i = 0
    let timer: number
    setLines([])
    setFollowing(true)
    const tick = () => {
      if (i < script.length) {
        append(script[i++])
        timer = window.setTimeout(tick, reduce ? 0 : 25 + Math.random() * 70)
        return
      }
      if (!pausedRef.current && !document.hidden) append(tailEntry(report))
      timer = window.setTimeout(tick, reduce ? 2500 : 450 + Math.random() * 1100)
    }
    timer = window.setTimeout(tick, 120)
    return () => window.clearTimeout(timer)
  }, [report])

  useEffect(() => {
    if (pending) append({ ch: 'SYS', level: 'info', text: `dispatch scan target=${pending} …` })
  }, [pending])

  useLayoutEffect(() => {
    if (following && body.current) body.current.scrollTop = body.current.scrollHeight
  }, [lines, following])

  const onScroll = () => {
    const el = body.current
    if (el) setFollowing(el.scrollHeight - el.scrollTop - el.clientHeight < 24)
  }

  return (
    <div className={cn('relative flex h-full min-h-0 flex-col', className)}>
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3 text-[12px] text-ink-2">
        <span
          className="inline-flex items-center gap-2"
          title="Replayed from this scan's observations; later lines are simulated monitoring"
        >
          <Lamp className={paused ? 'bg-warn' : 'bg-ok'} pulse={!paused} />
          {paused ? 'Paused' : 'Streaming'} (replay of this scan, then simulated monitoring)
        </span>
        <button
          type="button"
          onClick={() => setPaused((p) => !p)}
          aria-pressed={paused}
          className="h-8 border border-line px-3 font-medium text-ink-2 hover:border-line-strong hover:text-ink"
        >
          {paused ? 'Resume' : 'Pause'}
        </button>
      </div>

      <div
        ref={body}
        onScroll={onScroll}
        role="log"
        aria-live="off"
        aria-label="Probe log"
        className="min-h-0 flex-1 overflow-y-auto bg-sunken px-4 py-3 font-mono text-[11px] leading-[1.7]"
      >
        {lines.map((l) => (
          <div key={l.id} className="grid grid-cols-[6.6rem_3rem_minmax(0,1fr)] gap-x-3">
            <span className="text-ink-3">{clock(l.ts)}</span>
            <span className={CHANNEL_TEXT[l.ch]}>{l.ch}</span>
            <span className={cn('break-all', LEVEL_TEXT[l.level])}>{l.text}</span>
          </div>
        ))}
      </div>

      {!following && (
        <button
          type="button"
          onClick={() => setFollowing(true)}
          className="absolute right-4 bottom-4 border border-line bg-surface px-3 py-1.5 text-[11.5px] font-medium text-accent"
        >
          Jump to latest
        </button>
      )}
    </div>
  )
}
