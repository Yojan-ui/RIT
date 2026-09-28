import { useEffect, useRef, useState, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { Pause, Play, SkipBack, StepForward, TableProperties } from 'lucide-react'
import type { Qubit, SimResponse } from '../api'
import { BASIS_COLOR, RED, AMBER, VERDICT_COLOR, VERDICT_TEXT, basisGlyph, stateLabel, verdict } from '../lib/quantum'
import { playback, usePlayback } from '../playback'
import { IconButton } from './ui'

const SPEEDS = [0.5, 1, 2, 4]

/** Every photon as a hairline tick; played ones light up by outcome. */
function Timeline({ qubits, focus }: { qubits: Qubit[]; focus: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const el = ref.current
    if (!el || !width) return
    const dpr = window.devicePixelRatio || 1
    const h = 28
    el.width = Math.round(width * dpr)
    el.height = h * dpr
    const ctx = el.getContext('2d')
    if (!ctx) return
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, width, h)
    const n = qubits.length
    const w = width / Math.max(1, n)
    for (let i = 0; i < n; i++) {
      const played = i <= focus
      const v = verdict(qubits[i])
      ctx.globalAlpha = played ? (v === 'discarded' ? 0.35 : 0.95) : 0.12
      ctx.fillStyle = played ? VERDICT_COLOR[v] : '#a1a1aa'
      const tall = v !== 'discarded'
      const bh = tall ? 12 : 6
      ctx.fillRect(i * w, (h - bh) / 2, Math.max(1, w - (w > 3 ? 1 : 0)), bh)
    }
    ctx.globalAlpha = 1
    if (focus >= 0) {
      const x = (focus + 0.5) * w
      ctx.fillStyle = '#fafafa'
      ctx.fillRect(x - 0.75, 2, 1.5, h - 4)
    }
  }, [qubits, focus, width])

  return (
    <canvas
      ref={ref}
      className="h-7 w-full min-w-0 cursor-pointer"
      aria-label="Transmission timeline: click to jump to a photon"
      onClick={(e) => {
        const rect = e.currentTarget.getBoundingClientRect()
        const i = Math.floor(((e.clientX - rect.left) / rect.width) * qubits.length)
        playback.seek(Math.max(0, Math.min(qubits.length - 1, i)))
      }}
    />
  )
}

function Chip({ who, basis, state, tone }: { who: string; basis: Qubit['alice_basis']; state: string; tone?: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="text-zinc-500">{who}</span>
      <span className="font-mono" style={{ color: tone ?? BASIS_COLOR[basis] }}>
        {basisGlyph(basis)}
      </span>
      <span className="font-mono text-zinc-100">{state}</span>
    </span>
  )
}

/** What happened to the photon that just reached Bob. */
function Readout({ q, onOpen }: { q: Qubit | undefined; onOpen: (i: number) => void }) {
  if (!q) {
    return <div className="hud rounded-full px-4 py-2 text-xs text-zinc-500">Waiting for the first photon…</div>
  }
  const v = verdict(q)
  return (
    <motion.button
      key={q.index}
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18 }}
      onClick={() => onOpen(q.index)}
      className="hud pointer-events-auto flex max-w-full flex-wrap items-center justify-center gap-x-3 gap-y-1 rounded-full px-4 py-2 text-xs hover:border-white/20"
      title="Open Bloch sphere"
    >
      <span className="font-mono text-zinc-400">#{q.index}</span>
      <Chip who="A" basis={q.alice_basis} state={stateLabel(q.alice_bit, q.alice_basis)} />
      {q.intercepted && q.eve_basis && q.eve_bit !== null && (
        <>
          <span className="text-zinc-600">→</span>
          <Chip who="E" basis={q.eve_basis} state={stateLabel(q.eve_bit, q.eve_basis)} tone={q.state_disturbed ? RED : AMBER} />
        </>
      )}
      <span className="text-zinc-600">→</span>
      <span className="flex items-center gap-1.5">
        <span className="text-zinc-500">B</span>
        <span className="font-mono" style={{ color: BASIS_COLOR[q.bob_basis] }}>
          {basisGlyph(q.bob_basis)}
        </span>
        <span className="font-mono text-zinc-100">bit {q.bob_bit}</span>
      </span>
      <span className="flex items-center gap-1.5 rounded-full px-2 py-0.5" style={{ background: `${VERDICT_COLOR[v]}1f`, color: VERDICT_COLOR[v] }}>
        <span className="size-1.5 rounded-full" style={{ background: VERDICT_COLOR[v] }} />
        {VERDICT_TEXT[v]}
      </span>
    </motion.button>
  )
}

const WINDOW = 28

function TraceStrip({ qubits, focus, selected, onOpen }: { qubits: Qubit[]; focus: number; selected: number | null; onOpen: (i: number) => void }) {
  const end = Math.min(qubits.length, Math.max(WINDOW, focus + 4))
  const start = Math.max(0, end - WINDOW)
  const shown = qubits.slice(start, end)
  const rows: { label: string; cell: (q: Qubit, played: boolean) => ReactNode }[] = [
    { label: 'Alice', cell: (q) => <span style={{ color: BASIS_COLOR[q.alice_basis] }}>{basisGlyph(q.alice_basis)}</span> },
    { label: 'bit', cell: (q) => q.alice_bit },
    {
      label: 'Eve',
      cell: (q) =>
        q.intercepted ? <span style={{ color: q.state_disturbed ? RED : AMBER }}>{basisGlyph(q.eve_basis)}</span> : <span className="text-zinc-700">·</span>,
    },
    { label: 'Bob', cell: (q) => <span style={{ color: BASIS_COLOR[q.bob_basis] }}>{basisGlyph(q.bob_basis)}</span> },
    { label: 'bit', cell: (q, played) => (played ? <span className={q.error ? 'text-q-red' : ''}>{q.bob_bit}</span> : <span className="text-zinc-700">·</span>) },
  ]
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="hud pointer-events-auto w-full overflow-x-auto rounded-2xl px-3 py-2.5"
    >
      <table className="mx-auto border-separate border-spacing-0 font-mono text-[11px] tabular-nums">
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri}>
              <th className="pr-3 text-left font-sans text-[11px] font-normal whitespace-nowrap text-zinc-500">{r.label}</th>
              {shown.map((q) => {
                const played = q.index <= focus
                return (
                  <td
                    key={q.index}
                    onClick={() => onOpen(q.index)}
                    className={`h-5 w-6 min-w-6 cursor-pointer text-center transition-colors hover:bg-white/10 ${
                      q.index === focus ? 'bg-white/[0.08]' : ''
                    } ${q.index === selected ? 'outline outline-1 -outline-offset-1 outline-white/40' : ''} ${
                      !played ? 'opacity-35' : q.bases_match ? 'text-zinc-100' : 'text-zinc-500'
                    } ${ri === 0 ? 'rounded-t-md' : ''}`}
                  >
                    {r.cell(q, played)}
                  </td>
                )
              })}
            </tr>
          ))}
          <tr>
            <th className="pr-3 text-left font-sans text-[11px] font-normal text-zinc-500">use</th>
            {shown.map((q) => (
              <td key={q.index} className="px-[3px] pt-1.5" onClick={() => onOpen(q.index)}>
                <div
                  className="h-1 rounded-full"
                  style={{ background: q.index <= focus ? VERDICT_COLOR[verdict(q)] : '#27272a', opacity: q.index <= focus ? 1 : 0.6 }}
                />
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </motion.div>
  )
}

export function PlaybackBar({ result, selected, onOpen }: { result: SimResponse | null; selected: number | null; onOpen: (i: number) => void }) {
  const { playing, focus, speed } = usePlayback()
  // The trace table is open by default only where there's room for it.
  const [trace, setTrace] = useState(() => window.innerWidth >= 1024 && window.innerHeight >= 1050)
  const qubits = result?.qubits ?? []
  const n = qubits.length

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return
      if (e.code === 'Space') {
        e.preventDefault()
        playback.toggle()
      } else if (e.code === 'ArrowRight') {
        e.preventDefault()
        playback.step()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="pointer-events-none flex w-full flex-col items-center gap-2">
      {trace && n > 0 && <TraceStrip qubits={qubits} focus={focus} selected={selected} onOpen={onOpen} />}
      <div className="pointer-events-auto max-w-full">
        <Readout q={qubits[focus]} onOpen={onOpen} />
      </div>
      <div className="hud pointer-events-auto flex w-full items-center gap-1 rounded-full py-1 pr-2 pl-1">
        <IconButton label="Restart" onClick={() => playback.restart()} disabled={!n}>
          <SkipBack size={14} />
        </IconButton>
        <button
          aria-label={playing ? 'Pause' : 'Play'}
          title={playing ? 'Pause (space)' : 'Play (space)'}
          onClick={() => playback.toggle()}
          disabled={!n}
          className="grid size-9 shrink-0 place-items-center rounded-full bg-zinc-100 text-zinc-900 transition hover:bg-white disabled:opacity-40"
        >
          {playing ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" className="translate-x-px" />}
        </button>
        <IconButton label="Step one photon (→)" onClick={() => playback.step()} disabled={!n}>
          <StepForward size={15} />
        </IconButton>
        <div className="mx-2 min-w-0 flex-1">
          <Timeline qubits={qubits} focus={focus} />
        </div>
        <span className="hidden w-[84px] shrink-0 text-right font-mono text-[11px] text-zinc-400 tabular-nums sm:block">
          {Math.max(0, focus + 1)} / {n}
        </span>
        <button
          onClick={() => playback.setSpeed(SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length])}
          className="w-10 shrink-0 rounded-full py-1 font-mono text-[11px] text-zinc-400 transition hover:bg-white/[0.06] hover:text-zinc-100"
          title="Playback speed"
        >
          {speed}×
        </button>
        <IconButton label="Photon trace" onClick={() => setTrace(!trace)} active={trace}>
          <TableProperties size={14} />
        </IconButton>
      </div>
    </div>
  )
}
