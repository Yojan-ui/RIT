// "Proof" widgets: the live telemetry terminal (backend log stream) and the measured
// performance impact of the post-quantum patch.
import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Terminal, Zap } from 'lucide-react'
import type { Bench, ScanResult } from '../api'
import { computePerf, fmtBytes, fmtUs, INITCWND_BYTES, LEGACY_SIGS } from '../lib/perf'
import { Card } from './bento'

// ── Live telemetry terminal ──────────────────────────────────────────────────

export interface TLine {
  id: number
  t: string // HH:MM:SS.mmm
  src: 'api' | 'sse' | 'ui'
  tag: string
  text: string
  level: 'INFO' | 'WARNING' | 'ERROR'
  tone?: 'ok' | 'warn' | 'crit' | 'dim'
}

export type StreamState = 'idle' | 'connecting' | 'open' | 'closed' | 'error'

const SRC = { api: 'hud-ice', sse: 'hud-steel', ui: 'hud-dim' } as const

const lineLen = (l: TLine) => l.src.length + 1 + Math.max(5, l.tag.length) + 1 + l.text.length

/** Coloured segments of one log line, cut to its first `n` characters. */
function Segments({ l, n }: { l: TLine; n: number }) {
  const textCls = l.tone === 'crit' || l.level === 'ERROR' ? 'hud-crit' : l.tone === 'warn' || l.level === 'WARNING' ? 'hud-warn' : l.tone === 'ok' ? 'hud-ok' : l.tone === 'dim' ? 'hud-dim' : 'text-[#c9d4de]'
  const segs: [string, string][] = [
    [l.src, SRC[l.src]],
    [' ', ''],
    [l.tag.padEnd(5), l.level === 'ERROR' ? 'hud-crit' : l.level === 'WARNING' ? 'hud-warn' : 'hud-steel'],
    [' ', ''],
    [l.text, textCls],
  ]
  let left = n
  return (
    <>
      {segs.map(([t, cls], i) => {
        if (left <= 0) return null
        const part = t.slice(0, left)
        left -= t.length
        return (
          <span key={i} className={cls}>
            {part}
          </span>
        )
      })}
    </>
  )
}

export function TelemetryTerminal({ lines, state, meta }: { lines: TLine[]; state: StreamState; meta: string }) {
  const box = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)
  // Serial-console playback: lines type out character by character with a jittery baud rate;
  // the rate rises with the backlog so a burst of events never falls far behind the live stream.
  const [pos, setPos] = useState({ id: -1, c: 0 })
  const cur = lines.find((l) => l.id >= pos.id)
  useEffect(() => {
    if (!cur) return
    const backlog = lines.reduce((a, l) => (l.id >= cur.id ? a + lineLen(l) : a), 0) - pos.c
    const step = 1 + Math.floor(backlog / 160) + (Math.random() < 0.3 ? 1 : 0)
    const delay = 7 + Math.random() * 20 + (Math.random() < 0.035 ? 70 : 0)
    const t = setTimeout(() => {
      setPos((p) => {
        const id = Math.max(p.id, cur.id)
        const c = (id === p.id ? p.c : 0) + step
        return c >= lineLen(cur) ? { id: cur.id + 1, c: 0 } : { id, c }
      })
    }, delay)
    return () => clearTimeout(t)
  }, [cur, pos, lines])
  useEffect(() => {
    const el = box.current
    if (el && pinned.current) el.scrollTop = el.scrollHeight
  }, [lines.length, pos])
  const chip = {
    idle: ['○ idle', 'hud-dim'],
    connecting: ['◌ connecting', 'hud-ice'],
    open: ['● streaming', 'hud-ice'],
    closed: ['✓ closed', 'hud-ok'],
    error: ['× error', 'hud-crit'],
  }[state]
  return (
    <Card
      icon={Terminal}
      title="Live Telemetry"
      className="grow"
      bodyClassName="flex min-h-0 flex-1 flex-col !p-0"
      right={
        <span className={`flex items-center gap-1.5 text-[10px] font-medium tracking-[0.08em] uppercase ${chip[1]}`}>
          {state === 'open' && <span className="hud-live" />}
          {chip[0]}
        </span>
      }
    >
      <div className="hud-dim hud-mono flex justify-between border-b border-[var(--line)] px-6 py-2 text-[9.5px]">
        <span>GET /api/scan/stream · text/event-stream</span>
        <span>{meta}</span>
      </div>
      <div
        ref={box}
        onScroll={(e) => {
          const el = e.currentTarget
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
        }}
        className="hud-scroll hud-mono min-h-0 flex-1 overflow-y-auto px-6 py-3 text-[10px] leading-[14px]"
        role="log"
        aria-live="polite"
      >
        {lines.length === 0 && <div className="hud-dim">$ awaiting target · backend log stream attaches on scan</div>}
        {lines.map((l) => {
          if (cur && l.id > cur.id) return null
          const typing = cur && l.id === cur.id
          return (
            <div key={l.id} className="grid grid-cols-[80px_1fr] gap-x-1.5 break-words">
              <span className="hud-dim">{l.t}</span>
              <span>
                <Segments l={l} n={typing ? (pos.id === l.id ? pos.c : 0) : Infinity} />
                {typing && <span className="hud-caret" />}
              </span>
            </div>
          )
        })}
      </div>
    </Card>
  )
}

// ── Performance impact ───────────────────────────────────────────────────────

function Pair({ label, a, b, fa, fb, note }: { label: string; a: number; b: number; fa: string; fb: string; note?: string }) {
  const max = Math.max(a, b) || 1
  return (
    <div className="py-1">
      <div className="flex justify-between">
        <span className="hud-k">{label}</span>
        {note && <span className="hud-dim text-[10px]">{note}</span>}
      </div>
      {[
        [a, fa, 'legacy', '#ef4444'],
        [b, fb, 'pqc', '#06b6d4'],
      ].map(([v, f, k, c]) => (
        <div key={k as string} className="mt-1 grid grid-cols-[40px_1fr_66px] items-center gap-2 text-[10px]">
          <span className="hud-dim">{k}</span>
          <div className="relative h-[3px] bg-[rgb(255_255_255/0.06)]">
            <motion.div className="absolute inset-y-0 left-0" style={{ background: c as string }} initial={{ width: 0 }} animate={{ width: `${Math.max(1.5, ((v as number) / max) * 100)}%` }} transition={{ duration: 0.8, ease: [0.2, 0, 0, 1] }} />
          </div>
          <span className="text-right text-[#c9d4de]">{f}</span>
        </div>
      ))}
    </div>
  )
}

export function PerfImpact({ r, bench, benchError, legacySig, setLegacySig }: { r: ScanResult | null; bench: Bench | null; benchError: boolean; legacySig: string | null; setLegacySig: (s: string | null) => void }) {
  if (!r || !bench) {
    return (
      <Card icon={Zap} title="Performance Impact">
        <div className="hud-dim text-[11px]">{benchError ? 'Benchmark unavailable · backend offline' : !bench ? 'Measuring handshake crypto on this host…' : 'Legacy vs post-quantum handshake cost appears after a scan.'}</div>
      </Card>
    )
  }
  const p = computePerf(r, bench, legacySig ?? undefined)
  const site = r.certificate.public_key.name
  const choices = Array.from(new Set([LEGACY_SIGS.includes(site) ? site : 'RSA-2048', 'RSA-2048']))
  const serverLegacy = p.serverFlight?.legacy ?? null
  const serverPqc = p.serverFlight?.pqc ?? null
  const oneRtt = p.extraRtt == null ? null : !p.extraRtt
  return (
    <Card
      icon={Zap}
      title="Performance Impact"
      right={
        <span className="flex gap-1">
          {choices.map((c) => (
            <button key={c} onClick={() => setLegacySig(c === site ? null : c)} className={`px-1.5 text-[9.5px] ${p.legacy.sig === c ? 'hud-white border border-[var(--line-2)]' : 'hud-dim border border-transparent hover:text-white'}`}>
              {c}
            </button>
          ))}
        </span>
      }
    >
      <div>
        <div className="mb-1 flex justify-between text-[10px]">
          <span className="hud-crit">{p.legacy.kex} + {p.legacy.sig}</span>
          <span className="hud-okc">X25519MLKEM768 + ML-DSA-65</span>
        </div>
        <Pair label="crypto bytes on wire" a={p.legacy.wireBytes} b={p.pqc.wireBytes} fa={fmtBytes(p.legacy.wireBytes)} fb={fmtBytes(p.pqc.wireBytes)} note={`+${fmtBytes(p.deltaBytes)}`} />
        <Pair label="cpu · server + client" a={p.legacy.serverUs + p.legacy.clientUs} b={p.pqc.serverUs + p.pqc.clientUs} fa={fmtUs(p.legacy.serverUs + p.legacy.clientUs)} fb={fmtUs(p.pqc.serverUs + p.pqc.clientUs)} note={`${p.deltaMs >= 0 ? '+' : ''}${p.deltaMs.toFixed(2)} ms`} />
        {p.rttMs != null && (
          <Pair label="handshake latency" a={p.rttMs} b={p.rttMs + p.deltaMs} fa={`${p.rttMs.toFixed(0)} ms`} fb={`${(p.rttMs + p.deltaMs).toFixed(1)} ms`} note={`+${p.pctOfRtt!.toFixed(1)}% of live rtt`} />
        )}
        <div className="mt-1.5 grid grid-cols-2 gap-x-3 border-t border-[var(--line)] pt-1.5 text-[10px]">
          <span className="hud-k">round trips added</span>
          <span className={`text-right ${oneRtt === false ? 'hud-warn' : 'hud-ok'}`}>{oneRtt === false ? '+1 possible' : '0'}</span>
          {serverLegacy != null && serverPqc != null && (
            <>
              <span className="hud-k">server flight (est.)</span>
              <span className="text-right text-[#c9d4de]">
                {fmtBytes(serverLegacy)} → {fmtBytes(serverPqc)} <span className="hud-dim">/ {fmtBytes(INITCWND_BYTES)} cwnd</span>
              </span>
            </>
          )}
        </div>
        <div className="hud-dim mt-1.5 truncate text-[9px] leading-[12px]" title={bench.library}>per handshake · measured on this host · {bench.library}</div>
      </div>
    </Card>
  )
}
