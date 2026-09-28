import { motion } from 'framer-motion'
import {
  Activity,
  AlertTriangle,
  Cpu,
  Eye,
  KeyRound,
  Loader2,
  Radio,
  RotateCcw,
  ShieldCheck,
  ShieldAlert,
  Zap,
} from 'lucide-react'
import type { ReactNode } from 'react'
import type { Health, Qubit, SimResponse } from '../api'
import { QberGauge } from './QberGauge'

export function Panel({ title, icon, danger, className = '', children }: {
  title: string
  icon: ReactNode
  danger?: boolean
  className?: string
  children: ReactNode
}) {
  return (
    <section className={`glass min-w-0 ${danger ? 'glass-danger' : ''} pointer-events-auto p-4 transition-shadow duration-500 ${className}`}>
      <header className={`mb-3 flex items-center gap-2 ${danger ? 'text-q-red' : 'text-q-cyan'}`}>
        {icon}
        <h2 className="label text-current!">{title}</h2>
      </header>
      {children}
    </section>
  )
}

export function TopBar({ result, health, offline }: { result: SimResponse | null; health: Health | null; offline: boolean }) {
  const detected = result?.metrics.eavesdropper_detected
  return (
    <div className="pointer-events-auto flex flex-wrap items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">
        <div className="grid size-9 shrink-0 place-items-center rounded-lg border border-q-cyan/40 bg-q-cyan/10 shadow-[0_0_18px_-4px_#22d3ee]">
          <Radio size={18} className="text-q-cyan" />
        </div>
        <div>
          <h1 className="text-base font-extrabold tracking-[0.2em]">
            QKD<span className="text-q-violet">//</span>BB84
          </h1>
          <p className="label">quantum key distribution · live qiskit simulation</p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className="glass hidden items-center gap-2 px-3 py-1.5 text-[11px] sm:flex">
          <Cpu size={13} className={offline ? 'text-q-red' : 'text-q-green'} />
          {offline ? 'backend offline' : health ? `qiskit ${health.qiskit} · aer ${health.qiskit_aer}` : 'connecting…'}
        </span>
        <motion.span
          key={result ? (detected ? 'bad' : 'ok') : 'idle'}
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-semibold tracking-widest ${
            !result
              ? 'border-ink-dim/30 text-ink-dim'
              : detected
                ? 'danger-pulse border-q-red/60 bg-q-red/15 text-q-red'
                : 'border-q-green/50 bg-q-green/10 text-q-green'
          }`}
        >
          {!result ? <Activity size={13} /> : detected ? <ShieldAlert size={13} /> : <ShieldCheck size={13} />}
          {!result ? 'LINK IDLE' : detected ? 'EAVESDROPPER DETECTED' : 'CHANNEL SECURE'}
        </motion.span>
      </div>
    </div>
  )
}

export interface Controls {
  nQubits: number
  interceptRate: number
  noise: number
}

export function ControlPanel({ controls, setControls, loading, onClean, onAttack, onReset }: {
  controls: Controls
  setControls: (c: Controls) => void
  loading: 'clean' | 'attack' | null
  onClean: () => void
  onAttack: () => void
  onReset: () => void
}) {
  const slider = (label: string, key: keyof Controls, min: number, max: number, step: number, fmt: (v: number) => string) => (
    <label className="block">
      <div className="mb-1 flex justify-between text-[11px]">
        <span className="text-ink-dim">{label}</span>
        <span className="tabular-nums text-ink">{fmt(controls[key])}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={controls[key]}
        onChange={(e) => setControls({ ...controls, [key]: Number(e.target.value) })}
        className="w-full"
      />
    </label>
  )
  return (
    <Panel title="Transmission" icon={<Zap size={14} />}>
      <div className="space-y-3">
        {slider('Photons sent', 'nQubits', 16, 1024, 16, (v) => `${v}`)}
        {slider('Eve intercept rate', 'interceptRate', 0.1, 1, 0.05, (v) => `${Math.round(v * 100)}%`)}
        {slider('Channel noise', 'noise', 0, 0.1, 0.005, (v) => `${(v * 100).toFixed(1)}%`)}
      </div>
      <div className="mt-4 grid gap-2">
        <button
          onClick={onClean}
          disabled={loading !== null}
          className="flex items-center justify-center gap-2 rounded-lg border border-q-cyan/50 bg-q-cyan/10 px-3 py-2.5 text-xs font-semibold tracking-widest text-q-cyan transition hover:bg-q-cyan/20 hover:shadow-[0_0_20px_-4px_#22d3ee] disabled:opacity-50"
        >
          {loading === 'clean' ? <Loader2 size={14} className="animate-spin" /> : <KeyRound size={14} />}
          TRANSMIT CLEAN KEY
        </button>
        <button
          onClick={onAttack}
          disabled={loading !== null}
          className="flex items-center justify-center gap-2 rounded-lg border border-q-red/60 bg-gradient-to-r from-q-red/20 to-q-violet/20 px-3 py-2.5 text-xs font-semibold tracking-widest text-q-red transition hover:shadow-[0_0_24px_-4px_#f43f5e] disabled:opacity-50"
        >
          {loading === 'attack' ? <Loader2 size={14} className="animate-spin" /> : <Eye size={14} />}
          SIMULATE EVE INTERCEPTION
        </button>
        <button
          onClick={onReset}
          disabled={loading !== null}
          className="flex items-center justify-center gap-2 rounded-lg px-3 py-1.5 text-[11px] text-ink-dim transition hover:text-ink disabled:opacity-50"
        >
          <RotateCcw size={12} /> new photons (reseed)
        </button>
      </div>
    </Panel>
  )
}

export function Legend() {
  const states = [
    { s: '|0⟩', b: '+', c: '#22d3ee', d: '↑' },
    { s: '|1⟩', b: '+', c: '#22d3ee', d: '↓' },
    { s: '|+⟩', b: '×', c: '#a78bfa', d: '→' },
    { s: '|−⟩', b: '×', c: '#a78bfa', d: '←' },
  ]
  return (
    <Panel title="Photon states" icon={<Activity size={14} />}>
      <div className="grid grid-cols-4 gap-1.5 text-center">
        {states.map((x) => (
          <div key={x.s} className="rounded-md border border-white/5 bg-white/[0.03] py-1.5">
            <div className="text-lg leading-none" style={{ color: x.c }}>{x.d}</div>
            <div className="mt-1 text-xs font-semibold">{x.s}</div>
            <div className="text-[10px] text-ink-dim">basis {x.b}</div>
          </div>
        ))}
      </div>
      <ul className="mt-3 space-y-1 text-[11px] text-ink-dim">
        <li><span className="text-q-amber">■</span> Eve read it in the right basis (copied it, no trace)</li>
        <li><span className="text-q-red">■</span> Eve read it in the wrong basis, so the state collapsed</li>
      </ul>
    </Panel>
  )
}

function Stat({ label, value, sub, tone = 'ink' }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'ink' | 'red' | 'green' | 'violet' }) {
  const color = { ink: 'text-ink', red: 'text-q-red', green: 'text-q-green', violet: 'text-q-violet' }[tone]
  return (
    <div className="rounded-lg border border-white/5 bg-white/[0.03] px-2.5 py-2">
      <div className="label">{label}</div>
      <div className={`mt-0.5 text-lg font-semibold tabular-nums ${color}`}>{value}</div>
      {sub && <div className="text-[10px] text-ink-dim">{sub}</div>}
    </div>
  )
}

export function MetricsPanel({ result }: { result: SimResponse | null }) {
  const m = result?.metrics
  const detected = !!m?.eavesdropper_detected
  const n = result?.params.n_qubits ?? 0
  const matchRate = result ? (result.sifting.matching_bases / n) * 100 : 0
  return (
    <Panel title="Quantum bit error rate" icon={detected ? <AlertTriangle size={14} /> : <Activity size={14} />} danger={detected}>
      <QberGauge qber={m?.qber ?? 0} threshold={m?.threshold ?? 0.11} />
      <p className="mt-1 text-center text-[10px] text-ink-dim">
        <span className="text-q-amber">┆</span> abort threshold {((m?.threshold ?? 0.11) * 100).toFixed(0)}%
        {m && <> · expected {(m.expected_qber * 100).toFixed(1)}%</>}
      </p>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <Stat label="Basis match" value={`${matchRate.toFixed(1)}%`} sub={result ? `${result.sifting.matching_bases}/${n} photons` : '—'} tone="violet" />
        <Stat label="Sifted bits" value={result?.sifting.sifted_length ?? '—'} sub={m ? `${m.sample_size} revealed to check` : '—'} />
        <Stat label="Errors in check" value={m ? m.sample_errors : '—'} sub={m ? `of ${m.sample_size} compared` : '—'} tone={m && m.sample_errors > 0 ? 'red' : 'ink'} />
        <Stat
          label="Eve"
          value={result?.eve.active ? `${result.eve.intercepted_count}` : 'none'}
          sub={result?.eve.active ? `intercepted · ${result.eve.wrong_basis_count} collapsed` : 'no interception'}
          tone={result?.eve.active ? 'red' : 'green'}
        />
      </div>

      {result && (
          <motion.div
            key={detected ? 'bad' : 'ok'}
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            className={`mt-3 flex items-start gap-2 rounded-lg border p-2.5 text-[11px] leading-relaxed ${
              detected ? 'border-q-red/50 bg-q-red/10 text-q-red' : 'border-q-green/40 bg-q-green/10 text-q-green'
            }`}
          >
            {detected ? <ShieldAlert size={16} className="mt-0.5 shrink-0" /> : <ShieldCheck size={16} className="mt-0.5 shrink-0" />}
            <span>
              {detected
                ? `Error rate ${m!.qber_percent}% is above ${(m!.threshold * 100).toFixed(0)}%. Someone measured the photons in transit, so the key is discarded.`
                : `Error rate ${m!.qber_percent}% is below the ${(m!.threshold * 100).toFixed(0)}% limit. No eavesdropper detected; the key is safe to use.`}
            </span>
          </motion.div>
        )}
    </Panel>
  )
}

const BITS_SHOWN = 96

export function KeyPanel({ result }: { result: SimResponse | null }) {
  const k = result?.key
  const aborted = k?.status === 'aborted'
  const a = (k?.alice_key ?? '').slice(0, BITS_SHOWN)
  const b = (k?.bob_key ?? '').slice(0, BITS_SHOWN)
  return (
    <Panel title="Sifted key" icon={<KeyRound size={14} />} danger={aborted}>
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]">
        <span className={aborted ? 'font-semibold text-q-red' : 'font-semibold text-q-green'}>
          {k ? (aborted ? 'KEY DISCARDED' : 'KEY ESTABLISHED') : '—'}
        </span>
        {k && <span className="text-ink-dim">{k.length} bits · {k.mismatched_bits} mismatched</span>}
        {k && result?.eve.active && (
          <span className="text-ink-dim">Eve knows <span className="text-q-red">{result.eve.known_final_key_bits}</span> of them</span>
        )}
      </div>
      {(['ALICE', 'BOB'] as const).map((who) => {
        const bits = who === 'ALICE' ? a : b
        return (
          <div key={who} className="flex gap-2 text-[11px] leading-5">
            <span className={`w-11 shrink-0 ${who === 'ALICE' ? 'text-q-cyan' : 'text-q-violet'}`}>{who}</span>
            <code className={`break-all tracking-[0.12em] ${aborted ? 'opacity-70' : ''}`}>
              {bits.split('').map((bit, i) =>
                a[i] !== b[i] ? (
                  <span key={i} className="rounded-sm bg-q-red/30 text-q-red">{bit}</span>
                ) : (
                  <span key={i}>{bit}</span>
                ),
              )}
              {(k?.length ?? 0) > BITS_SHOWN && <span className="text-ink-dim">…</span>}
            </code>
          </div>
        )
      })}
      {k && !aborted && (
        <div className="mt-2 truncate text-[10px] text-ink-dim">
          hex <span className="text-q-green">{k.alice_key_hex}</span>
        </div>
      )}
    </Panel>
  )
}

const TRACE = 48

export function QubitTrace({ result }: { result: SimResponse | null }) {
  const qs: Qubit[] = result?.qubits.slice(0, TRACE) ?? []
  const basisColor = (b: string | null) => (b === '+' ? 'text-q-cyan' : b === 'x' ? 'text-q-violet' : 'text-ink-dim/40')
  const rows: { label: string; cell: (q: Qubit) => ReactNode }[] = [
    { label: 'A basis', cell: (q) => <span className={basisColor(q.alice_basis)}>{q.alice_basis === 'x' ? '×' : '+'}</span> },
    { label: 'A bit', cell: (q) => q.alice_bit },
    {
      label: 'Eve',
      cell: (q) =>
        q.intercepted ? (
          <span className={q.state_disturbed ? 'text-q-red' : 'text-q-amber'}>{q.eve_basis === 'x' ? '×' : '+'}</span>
        ) : (
          <span className="text-ink-dim/30">·</span>
        ),
    },
    { label: 'B basis', cell: (q) => <span className={basisColor(q.bob_basis)}>{q.bob_basis === 'x' ? '×' : '+'}</span> },
    { label: 'B bit', cell: (q) => <span className={q.error ? 'text-q-red font-bold' : ''}>{q.bob_bit}</span> },
  ]
  const roleBar = (q: Qubit) =>
    q.role === 'discarded' ? 'bg-ink-dim/15' : q.error ? 'bg-q-red' : q.role === 'sample' ? 'bg-q-amber/70' : 'bg-q-green'
  return (
    <Panel title={`Photon trace · first ${Math.min(TRACE, qs.length)}`} icon={<Activity size={14} />}>
      <div className="overflow-x-auto">
        <table className="border-separate border-spacing-0 text-center text-[11px] tabular-nums">
          <tbody>
            {rows.map((r) => (
              <tr key={r.label}>
                <th className="sticky left-0 bg-[#0b0f22]/90 pr-2 text-left font-normal whitespace-nowrap text-ink-dim">{r.label}</th>
                {qs.map((q) => (
                  <td key={q.index} className={`w-5 min-w-5 ${q.bases_match ? '' : 'opacity-40'}`}>{r.cell(q)}</td>
                ))}
              </tr>
            ))}
            <tr>
              <th className="sticky left-0 bg-[#0b0f22]/90 pr-2 text-left font-normal text-ink-dim">use</th>
              {qs.map((q) => (
                <td key={q.index} className="px-px pt-1">
                  <div className={`h-1.5 rounded-full ${roleBar(q)}`} />
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-ink-dim">
        <span><span className="text-q-green">■</span> key</span>
        <span><span className="text-q-amber">■</span> revealed to check</span>
        <span><span className="text-q-red">■</span> error</span>
        <span className="opacity-60">■ bases differ, discarded</span>
      </div>
    </Panel>
  )
}
