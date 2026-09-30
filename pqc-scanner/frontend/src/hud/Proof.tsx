// "Proof" widgets: the live telemetry terminal (backend log stream) and the measured
// performance impact of the post-quantum patch.
import { useEffect, useRef, useState } from 'react'
import { Terminal } from 'lucide-react'
import type { Bench, ScanResult } from '../api'
import { computePerf, fmtBytes, fmtUs, LEGACY_SIGS } from '../lib/perf'
import { Pane } from './pane'

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

export function TelemetryTerminal({ lines, state, meta, target }: { lines: TLine[]; state: StreamState; meta: string; target: string }) {
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
    <Pane
      icon={Terminal}
      title="Terminal · zsh"
      bodyClassName="flex min-h-0 flex-1 flex-col !p-0"
      right={
        <span className={`flex items-center gap-1.5 text-[10px] font-medium tracking-[0.08em] uppercase ${chip[1]}`}>
          {state === 'open' && <span className="hud-live" />}
          {chip[0]}
        </span>
      }
    >
      <div className="hud-mono flex justify-between gap-3 border-b border-[var(--line)] px-5 py-2 text-[10.5px]">
        <span className="truncate">
          <span className="hud-ok">➜</span> <span className="hud-ice">quantumledger</span> <span className="hud-steel">~/soc</span> <span className="hud-dim">%</span>{' '}
          <span className="text-[#e6edf3]">pqc-scan --stream {target || '<target>'}</span>
        </span>
        <span className="hud-dim flex-none">{meta}</span>
      </div>
      <div
        ref={box}
        onScroll={(e) => {
          const el = e.currentTarget
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
        }}
        className="hud-scroll hud-mono min-h-[220px] flex-1 overflow-y-auto px-5 py-3 text-[10.5px] leading-[15px] max-lg:max-h-[340px] lg:min-h-0"
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
    </Pane>
  )
}

// ── Legacy vs post-quantum comparison ────────────────────────────────────────

/** Side-by-side handshake cost: the site's legacy suite (or RSA-2048) against ML-DSA-65 + ML-KEM-768, measured on this host. */
export function Comparison({ r, bench, benchError, legacySig, setLegacySig }: { r: ScanResult | null; bench: Bench | null; benchError: boolean; legacySig: string | null; setLegacySig: (s: string | null) => void }) {
  if (!r || !bench) {
    return <p className="hud-dim text-[11.5px]">{benchError ? 'Benchmark unavailable · backend offline' : !bench ? 'Measuring handshake crypto on this host…' : 'Legacy vs post-quantum handshake cost appears after a scan.'}</p>
  }
  const p = computePerf(r, bench, legacySig ?? undefined)
  const site = r.certificate.public_key.name
  const choices = Array.from(new Set([LEGACY_SIGS.includes(site) ? site : 'RSA-2048', 'RSA-2048']))
  const oneRtt = p.extraRtt == null ? null : !p.extraRtt
  const rows: [string, string, string, string?][] = [
    ['Signature', p.legacy.sig, 'ML-DSA-65', 'FIPS 204'],
    ['Key exchange', p.legacy.kex, 'ML-KEM-768', 'X25519MLKEM768 · FIPS 203'],
    ['Crypto bytes', fmtBytes(p.legacy.wireBytes), fmtBytes(p.pqc.wireBytes), `+${fmtBytes(p.deltaBytes)}`],
    ['CPU / handshake', fmtUs(p.legacy.serverUs + p.legacy.clientUs), fmtUs(p.pqc.serverUs + p.pqc.clientUs), `${p.deltaMs >= 0 ? '+' : ''}${p.deltaMs.toFixed(2)} ms`],
    ...(p.rttMs != null ? [['Latency', `${p.rttMs.toFixed(0)} ms`, `${(p.rttMs + p.deltaMs).toFixed(1)} ms`, `+${p.pctOfRtt!.toFixed(1)}% of rtt`] as [string, string, string, string]] : []),
  ]
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="hud-k">Legacy vs post-quantum · measured on this host</span>
        <span className="flex gap-1">
          {choices.map((c) => (
            <button key={c} onClick={() => setLegacySig(c === site ? null : c)} className={`rounded px-1.5 text-[10px] ${p.legacy.sig === c ? 'hud-white border border-[var(--line-2)]' : 'hud-dim border border-transparent hover:text-white'}`}>
              {c}
            </button>
          ))}
        </span>
      </div>
      <table className="w-full text-[11.5px] leading-[20px]">
        <thead>
          <tr className="hud-k text-left">
            <th className="font-medium" />
            <th className="font-medium">Legacy</th>
            <th className="font-medium">Post-quantum</th>
            <th className="text-right font-medium">Δ</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([k, a, b, d]) => (
            <tr key={k} className="border-t border-[rgb(255_255_255/0.04)]">
              <td className="hud-dim pr-2">{k}</td>
              <td className="hud-crit pr-2">{a}</td>
              <td className="hud-okc pr-2">{b}</td>
              <td className="hud-dim text-right">{d}</td>
            </tr>
          ))}
          <tr className="border-t border-[rgb(255_255_255/0.04)]">
            <td className="hud-dim pr-2">Round trips</td>
            <td colSpan={3} className={oneRtt === false ? 'hud-warn' : 'hud-ok'}>{oneRtt === false ? '+1 possible (server flight exceeds initial cwnd)' : '0 added · fits the initial TCP window'}</td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}
