import { motion } from 'framer-motion'
import { ArrowRight, Lock } from 'lucide-react'
import { BASE_YEAR, Z_YEARS, type AlgoVerdict, type MoscaResult } from '../../lib/mosca'
import { Button, Callout, DataTable, Panel, StageHeader, StatusLabel, Td, Th, reveal, type Status } from '../ui'

const VERDICT: Record<AlgoVerdict, { status: Status; label: string }> = {
  safe: { status: 'safe', label: 'Safe' },
  window: { status: 'warn', label: 'Within window' },
  forgeable: { status: 'risk', label: 'Forgeable' },
  readable: { status: 'risk', label: 'Readable later' },
}

function Slider({ label, hint, value, min, max, onChange }: { label: string; hint: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <label className="block">
      <div className="flex items-baseline justify-between">
        <span className="text-[13px] text-zinc-200">{label}</span>
        <span className="font-mono text-[13px] text-white tabular-nums">{value} yrs</span>
      </div>
      <p className="mt-0.5 text-[12px] text-zinc-500">{hint}</p>
      <input type="range" min={min} max={max} step={1} value={value} onChange={(e) => onChange(Number(e.target.value))} className="mt-2" />
    </label>
  )
}

/** Hairline timeline: X then Y from today, against the CRQC marker at Z. */
function Timeline({ m }: { m: MoscaResult }) {
  const span = Math.max(m.sum, m.z) + 2
  const pct = (v: number) => `${(v / span) * 100}%`
  const t = { duration: 0.2, ease: [0.2, 0, 0, 1] as const }
  return (
    <div>
      <div className="relative h-6">
        <div className="absolute inset-x-0 top-1/2 h-px bg-white/10" />
        <motion.div className="absolute top-1/2 h-[3px] -translate-y-1/2 bg-zinc-300" animate={{ left: 0, width: pct(m.x) }} transition={t} />
        <motion.div className="absolute top-1/2 h-[3px] -translate-y-1/2 bg-zinc-500" animate={{ left: pct(m.x), width: pct(m.y) }} transition={t} />
        {m.exposedYears > 0 && (
          <motion.div className="absolute top-1/2 h-[3px] -translate-y-1/2 bg-risk" animate={{ left: pct(m.z), width: pct(m.exposedYears) }} transition={t} />
        )}
        <div className="absolute top-0 bottom-0 w-px bg-risk" style={{ left: pct(m.z) }} />
      </div>
      <div className="relative mt-1 h-4 font-mono text-[11px] text-zinc-500">
        <span className="absolute left-0">{BASE_YEAR}</span>
        <span className="absolute -translate-x-1/2 text-zinc-300" style={{ left: pct(m.z) }}>
          CRQC {BASE_YEAR + m.z}
        </span>
        <span className="absolute right-0">{BASE_YEAR + span}</span>
      </div>
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[12px] text-zinc-500">
        <span className="inline-flex items-center gap-2"><span className="h-[3px] w-3 bg-zinc-300" />X migration</span>
        <span className="inline-flex items-center gap-2"><span className="h-[3px] w-3 bg-zinc-500" />Y shelf life</span>
        {m.exposedYears > 0 && <span className="inline-flex items-center gap-2"><span className="h-[3px] w-3 bg-risk" />{m.exposedYears} years exposed</span>}
      </div>
    </div>
  )
}

export function ScoreStage({ x, y, setX, setY, preview, result, onCalculate, onNext, showNext }: {
  x: number
  y: number
  setX: (v: number) => void
  setY: (v: number) => void
  preview: MoscaResult
  result: MoscaResult | null
  onCalculate: () => void
  onNext: () => void
  showNext: boolean
}) {
  const m = result ?? preview
  return (
    <motion.div {...reveal}>
      <StageHeader
        n={2}
        title="Score"
        description="Mosca's inequality: if migration time plus the time data must stay protected exceeds the time until a quantum computer, classical cryptography fails while it still matters."
        action={
          result ? (
            showNext && <Button onClick={onNext} icon={<ArrowRight size={14} />}>Continue to defend</Button>
          ) : (
            <Button onClick={onCalculate}>Calculate risk</Button>
          )
        }
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_1.3fr]">
        <Panel title="Inputs">
          <div className="space-y-6">
            <Slider label="X · Migration time" hint="Years to move this endpoint to post-quantum cryptography" value={x} min={0} max={15} onChange={setX} />
            <Slider label="Y · Data shelf life" hint="Years signatures and data must remain trustworthy" value={y} min={0} max={30} onChange={setY} />
            <div className="flex items-baseline justify-between border-t border-white/[0.06] pt-4">
              <div>
                <div className="flex items-center gap-2 text-[13px] text-zinc-200">
                  Z · Years to a quantum computer <Lock size={11} className="text-zinc-500" />
                </div>
                <p className="mt-0.5 text-[12px] text-zinc-500">Fixed at the {BASE_YEAR + Z_YEARS} lower bound</p>
              </div>
              <span className="font-mono text-[13px] text-white">{Z_YEARS} yrs</span>
            </div>
          </div>
        </Panel>

        <Panel title="Inequality">
          <div className="font-mono text-2xl tracking-tight text-white tabular-nums">
            {m.x} <span className="text-zinc-600">+</span> {m.y} <span className="text-zinc-600">=</span> {m.sum}{' '}
            <span className={m.holds ? 'text-risk' : 'text-safe'}>{m.holds ? '>' : '≤'}</span> {m.z}
          </div>
          <p className="mt-1 text-[12px] text-zinc-500">X + Y {m.holds ? '>' : '≤'} Z</p>
          <div className="mt-6">
            <Timeline m={m} />
          </div>
        </Panel>
      </div>

      {result && (
        <div className="mt-6 space-y-5">
          {result.verdict === 'critical' ? (
            <Callout status="risk" title="Critical risk: forgeable">
              {result.x} + {result.y} = {result.sum} &gt; {result.z}. Cryptography deployed today must stay trustworthy until {BASE_YEAR + result.sum},{' '}
              {result.exposedYears} years after a {BASE_YEAR + result.z} quantum computer could break it.
            </Callout>
          ) : result.verdict === 'safe' ? (
            <Callout status="safe" title="Safe">Everything detected is already post-quantum; the inequality does not apply.</Callout>
          ) : (
            <Callout status="warn" title="Within the window">
              {result.sum} ≤ {result.z}: migration completes before a quantum computer, provided it starts now.
            </Callout>
          )}

          <Panel title="Per-algorithm verdict">
            <DataTable head={<><Th>Component</Th><Th>Algorithm</Th><Th>Verdict</Th><Th>Reason</Th></>}>
              {result.rows.map((r) => (
                <tr key={r.role}>
                  <Td>{r.role}</Td>
                  <Td mono>{r.algorithm}</Td>
                  <Td><StatusLabel status={VERDICT[r.verdict].status}>{VERDICT[r.verdict].label}</StatusLabel></Td>
                  <Td className="text-zinc-500!">{r.why}</Td>
                </tr>
              ))}
            </DataTable>
          </Panel>
        </div>
      )}
    </motion.div>
  )
}
