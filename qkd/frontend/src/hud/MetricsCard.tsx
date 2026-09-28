import { useEffect } from 'react'
import { motion, useSpring, useTransform } from 'framer-motion'
import { Activity } from 'lucide-react'
import type { SimResponse } from '../api'
import { Card, Row } from './ui'

const SCALE = 0.5 // meter full scale = 50% QBER (pure guessing)

export function MetricsCard({ result, defaultOpen }: { result: SimResponse | null; defaultOpen?: boolean }) {
  const m = result?.metrics
  const qber = m?.qber ?? 0
  const threshold = m?.threshold ?? 0.11
  const detected = !!m?.eavesdropper_detected
  // Underdamped spring: the number and bar overshoot, so an attack reads as a spike.
  const spring = useSpring(0, { stiffness: 110, damping: 9 })
  useEffect(() => spring.set(qber), [qber, spring])
  const pct = useTransform(spring, (v) => (Math.max(0, v) * 100).toFixed(1))
  const width = useTransform(spring, (v) => `${Math.min(100, Math.max(0, (v / SCALE) * 100))}%`)
  const n = result?.params.n_qubits ?? 0
  const accent = detected ? 'text-q-red' : 'text-zinc-50'

  return (
    <Card
      title="Channel"
      icon={<Activity size={14} />}
      danger={detected}
      defaultOpen={defaultOpen}
      summary={<span className={`font-mono ${detected ? 'text-q-red' : 'text-zinc-200'}`}>QBER {(qber * 100).toFixed(1)}%</span>}
    >
      <div className="flex items-end justify-between">
        <div>
          <div className="eyebrow">Quantum bit error rate</div>
          <div className={`mt-1 flex items-baseline gap-0.5 font-mono ${accent}`}>
            <motion.span className="text-4xl font-medium tracking-tight tabular-nums">{pct}</motion.span>
            <span className="text-lg text-zinc-500">%</span>
          </div>
        </div>
        {m && (
          <div className="pb-1.5 text-right text-[11px] text-zinc-500">
            expected
            <div className="font-mono text-zinc-300">{(m.expected_qber * 100).toFixed(1)}%</div>
          </div>
        )}
      </div>

      <div className="relative mt-3 h-[3px] rounded-full bg-white/10">
        <motion.div
          className={`absolute inset-y-0 left-0 rounded-full ${detected ? 'bg-q-red shadow-[0_0_12px_#ff4d6a]' : 'bg-q-green'}`}
          style={{ width }}
        />
        <div className="absolute -top-1 h-[11px] w-px bg-q-amber" style={{ left: `${(threshold / SCALE) * 100}%` }} />
      </div>
      <div className="relative mt-1.5 h-3 font-mono text-[10px] text-zinc-500">
        <span className="absolute left-0">0</span>
        <span className="absolute -translate-x-1/2 text-q-amber/80" style={{ left: `${(threshold / SCALE) * 100}%` }}>
          {Math.round(threshold * 100)}% abort
        </span>
        <span className="absolute right-0">50</span>
      </div>

      <dl className="mt-3 divide-y divide-white/[0.06]">
        <Row label="Basis match">{result ? `${((result.sifting.matching_bases / n) * 100).toFixed(1)}%` : '—'}</Row>
        <Row label="Sifted bits">{result ? `${result.sifting.sifted_length} / ${n}` : '—'}</Row>
        <Row label="Error check">
          {m ? (
            <span className={m.sample_errors ? 'text-q-red' : ''}>
              {m.sample_errors} of {m.sample_size}
            </span>
          ) : '—'}
        </Row>
        <Row label="Sifted key">
          {result ? (
            <span className={result.key.status === 'aborted' ? 'text-q-red' : 'text-q-green'}>
              {result.key.length} bits · {result.key.status === 'aborted' ? 'discarded' : 'established'}
            </span>
          ) : '—'}
        </Row>
        <Row label="Eve">
          {result?.eve.active ? (
            <span className="text-q-red">
              {result.eve.intercepted_count} tapped · {result.eve.wrong_basis_count} collapsed
            </span>
          ) : (
            <span className="text-zinc-500">none</span>
          )}
        </Row>
      </dl>

    </Card>
  )
}
