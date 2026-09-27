import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { scanTranscript, tailEntry, type Channel, type Level, type LogEntry } from '@/lib/telemetry'
import type { ScanReport } from '@/lib/types'
import { Lamp, PanelHeader } from './primitives'

const MAX_LINES = 300

interface LogLine extends LogEntry {
  id: number
  ts: number
}

const LEVEL_TEXT: Record<Level, string> = {
  ok: 'text-ok',
  warn: 'text-warn',
  err: 'text-crit',
  info: 'text-slate-200',
  dim: 'text-slate-500',
}

const CHANNEL_TEXT: Record<Channel, string> = {
  SYS: 'text-slate-300',
  DNS: 'text-sky-400/80',
  HTTP: 'text-violet-400/80',
  SMTP: 'text-ok/80',
  TLS: 'text-teal-300/80',
}

const clock = (ts: number) => {
  const d = new Date(ts)
  return `${d.toLocaleTimeString('en-GB', { hour12: false })}.${String(d.getMilliseconds()).padStart(3, '0')}`
}

/**
 * Terminal-style feed. Replays the current scan's observations as a probe
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
    <section className={cn('panel relative flex h-full min-h-0 flex-col', className)} aria-labelledby="telemetry-heading">
      <PanelHeader label="Real-time telemetry">
        <div className="flex items-center gap-2">
          <span
            className="border border-white/10 px-1.5 py-px font-mono text-[9px] tracking-wider text-slate-500"
            title="Transcript replayed from the scan's observations; follow-on lines are simulated monitoring"
          >
            SIMULATED
          </span>
          <span className="inline-flex items-center gap-1.5 font-mono text-[10px] tracking-wider text-slate-400">
            <Lamp className={paused ? 'bg-warn' : 'bg-ok'} pulse={!paused} />
            {paused ? 'PAUSED' : 'LIVE'}
          </span>
          <button
            type="button"
            onClick={() => setPaused((p) => !p)}
            aria-pressed={paused}
            className="h-5 border border-white/10 px-2 font-mono text-[9px] tracking-wider text-slate-400 hover:border-white/30 hover:text-slate-200"
          >
            {paused ? 'RESUME' : 'PAUSE'}
          </button>
        </div>
      </PanelHeader>
      <h2 id="telemetry-heading" className="sr-only">
        Real-time telemetry
      </h2>

      <div
        ref={body}
        onScroll={onScroll}
        role="log"
        aria-live="off"
        aria-label="Probe log"
        className="min-h-0 flex-1 overflow-y-auto bg-black/30 px-3 py-2 font-mono text-[10.5px] leading-[1.6]"
      >
        {lines.map((l) => (
          <div key={l.id} className="grid grid-cols-[5.9rem_2.6rem_minmax(0,1fr)] gap-x-2">
            <span className="text-slate-600 tabular-nums">{clock(l.ts)}</span>
            <span className={CHANNEL_TEXT[l.ch]}>{l.ch}</span>
            <span className={cn('break-all', LEVEL_TEXT[l.level])}>{l.text}</span>
          </div>
        ))}
        <div className="grid grid-cols-[5.9rem_2.6rem_minmax(0,1fr)] gap-x-2" aria-hidden>
          <span />
          <span />
          <span className={cn('inline-block h-3 w-1.5 translate-y-0.5 bg-ok/80', !paused && 'animate-pulse')} />
        </div>
      </div>

      {!following && (
        <button
          type="button"
          onClick={() => setFollowing(true)}
          className="absolute right-3 bottom-3 border border-ok/40 bg-obsidian px-2.5 py-1 font-mono text-[10px] tracking-wider text-ok"
        >
          ↓ JUMP TO LIVE
        </button>
      )}
    </section>
  )
}
