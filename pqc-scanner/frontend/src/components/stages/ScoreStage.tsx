import { AnimatePresence, motion } from 'framer-motion'
import { Calculator, ShieldAlert, ShieldCheck, Timer } from 'lucide-react'
import { forwardRef, type ReactNode } from 'react'
import { BASE_YEAR, Z_YEARS, type MoscaResult } from '../../lib/mosca'
import { Card, Locked, NextButton, Stage, type StageStatus } from '../ui'

const VERDICT_STYLE = {
  safe: 'bg-emerald-400/10 text-emerald-300',
  window: 'bg-amber-400/10 text-amber-300',
  forgeable: 'bg-rose-500/15 text-rose-300',
  readable: 'bg-rose-500/15 text-rose-300',
} as const
const VERDICT_LABEL = { safe: 'SAFE', window: 'IN WINDOW', forgeable: 'FORGEABLE', readable: 'READABLE (HNDL)' } as const

function Slider({ label, hint, value, min, max, onChange, color }: { label: string; hint: string; value: number; min: number; max: number; onChange: (v: number) => void; color: string }) {
  return (
    <label className="block">
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-medium text-zinc-100">{label}</span>
        <span className="font-mono text-2xl font-semibold tabular-nums" style={{ color }}>
          {value}<span className="ml-1 text-sm text-zinc-500">yrs</span>
        </span>
      </div>
      <p className="text-xs text-zinc-500">{hint}</p>
      <input type="range" min={min} max={max} step={1} value={value} onChange={(e) => onChange(Number(e.target.value))} className="mt-2 w-full" style={{ accentColor: color }} />
    </label>
  )
}

/** Years on a line: migration (X) then shelf life (Y) from today, against the CRQC marker (Z). */
function Timeline({ m }: { m: MoscaResult }) {
  const span = Math.max(m.sum, m.z) + 2
  const pct = (years: number) => `${(years / span) * 100}%`
  return (
    <div className="mt-2">
      <div className="relative h-10 rounded-xl bg-white/[0.04]">
        <motion.div className="absolute inset-y-2 left-0 rounded-l-lg bg-sky-400/70" animate={{ width: pct(m.x) }} transition={{ type: 'spring', stiffness: 160, damping: 22 }} />
        <motion.div
          className="absolute inset-y-2 rounded-r-lg bg-violet-400/70"
          animate={{ left: pct(m.x), width: pct(m.y) }}
          transition={{ type: 'spring', stiffness: 160, damping: 22 }}
        />
        {m.exposedYears > 0 && (
          <motion.div
            className="absolute inset-y-0 rounded-r-xl bg-[repeating-linear-gradient(135deg,rgb(244_63_94/0.55)_0_6px,rgb(244_63_94/0.25)_6px_12px)] ring-1 ring-rose-400/60"
            animate={{ left: pct(m.z), width: pct(m.exposedYears) }}
            transition={{ type: 'spring', stiffness: 160, damping: 22 }}
          />
        )}
        <div className="absolute -top-1 -bottom-1 w-0.5 bg-rose-400 shadow-[0_0_10px_#f43f5e]" style={{ left: pct(m.z) }} />
      </div>
      <div className="relative mt-1 h-8 font-mono text-[11px]">
        <span className="absolute left-0 text-zinc-500">{BASE_YEAR}</span>
        <span className="absolute -translate-x-1/2 text-center text-rose-300" style={{ left: pct(m.z) }}>
          Z · CRQC
          <br />
          {BASE_YEAR + m.z}
        </span>
        <span className="absolute right-0 text-zinc-500">{BASE_YEAR + span}</span>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-zinc-400">
        <span><span className="mr-1 inline-block size-2 rounded-sm bg-sky-400/70" />X · migration</span>
        <span><span className="mr-1 inline-block size-2 rounded-sm bg-violet-400/70" />Y · shelf life</span>
        {m.exposedYears > 0 && <span className="text-rose-300"><span className="mr-1 inline-block size-2 rounded-sm bg-rose-500/60" />{m.exposedYears} years exposed after a CRQC</span>}
      </div>
    </div>
  )
}

export const ScoreStage = forwardRef<HTMLElement, {
  status: StageStatus
  x: number
  y: number
  setX: (v: number) => void
  setY: (v: number) => void
  preview: MoscaResult
  result: MoscaResult | null
  onCalculate: () => void
  children?: ReactNode
}>(function ScoreStage({ status, x, y, setX, setY, preview, result, onCalculate, children }, ref) {
  const m = result ?? preview
  return (
    <Stage ref={ref} n={2} title="Score" subtitle="Mosca's inequality  X + Y > Z" status={status} accent="#a78bfa">
      <div className="grid gap-4 lg:grid-cols-[1fr_1.25fr]">
        <Card title="Inputs" icon={<Timer size={14} />}>
          <div className="space-y-5">
            <Slider label="X · Migration time" hint="Years to move this endpoint to post-quantum crypto" value={x} min={0} max={15} onChange={setX} color="#38bdf8" />
            <Slider label="Y · Data shelf life" hint="Years signatures and data must stay trustworthy" value={y} min={0} max={30} onChange={setY} color="#a78bfa" />
            <div className="flex items-center justify-between rounded-xl bg-white/[0.04] px-3 py-2.5">
              <div>
                <div className="text-sm font-medium text-zinc-100">Z · Years to a quantum computer</div>
                <div className="text-xs text-zinc-500">{BASE_YEAR + Z_YEARS} lower bound for a CRQC</div>
              </div>
              <div className="flex items-center gap-2">
                <Locked label="fixed" />
                <span className="font-mono text-2xl font-semibold text-rose-300">{Z_YEARS}<span className="ml-1 text-sm text-zinc-500">yrs</span></span>
              </div>
            </div>
          </div>
        </Card>

        <Card title="Mosca timeline" icon={<Calculator size={14} />}>
          <div className="flex items-baseline justify-center gap-3 font-mono text-2xl font-semibold sm:text-3xl">
            <span className="text-sky-300">{m.x}</span>
            <span className="text-zinc-600">+</span>
            <span className="text-violet-300">{m.y}</span>
            <span className="text-zinc-600">=</span>
            <span className="text-white">{m.sum}</span>
            <span className={m.holds ? 'text-rose-400' : 'text-emerald-300'}>{m.holds ? '>' : '≤'}</span>
            <span className="text-rose-300">{m.z}</span>
          </div>
          <Timeline m={m} />
          {!result && (
            <div className="mt-4 flex justify-center">
              <NextButton onClick={onCalculate} tone="white" icon={<Calculator size={18} />}>Calculate Risk</NextButton>
            </div>
          )}
        </Card>
      </div>

      <AnimatePresence>
        {result && (
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ type: 'spring', stiffness: 160, damping: 20 }}>
            {result.verdict === 'critical' ? (
              <div className="mt-4 flex items-center gap-4 rounded-2xl bg-rose-600/15 p-5 ring-2 ring-rose-500/70 [animation:alarm_1.2s_ease-in-out_infinite]">
                <ShieldAlert className="shrink-0 text-rose-400" size={36} />
                <div>
                  <div className="text-xl font-black tracking-tight text-rose-300 sm:text-2xl">CRITICAL RISK: FORGEABLE</div>
                  <p className="mt-1 text-sm text-rose-200/80">
                    X + Y = {result.sum} &gt; Z = {result.z}. Crypto deployed today must stay trustworthy until {BASE_YEAR + result.sum}, {result.exposedYears} years past a {BASE_YEAR + result.z} quantum computer.
                  </p>
                </div>
              </div>
            ) : result.verdict === 'safe' ? (
              <div className="mt-4 flex items-center gap-4 rounded-2xl bg-emerald-400/10 p-5 ring-2 ring-emerald-400/60">
                <ShieldCheck className="shrink-0 text-emerald-300" size={36} />
                <div>
                  <div className="text-xl font-black tracking-tight text-emerald-300 sm:text-2xl">SAFE</div>
                  <p className="mt-1 text-sm text-emerald-100/80">Everything detected is already post-quantum; Mosca's inequality doesn't apply.</p>
                </div>
              </div>
            ) : (
              <div className="mt-4 flex items-center gap-4 rounded-2xl bg-amber-400/10 p-5 ring-2 ring-amber-400/50">
                <Timer className="shrink-0 text-amber-300" size={36} />
                <div>
                  <div className="text-xl font-black tracking-tight text-amber-300 sm:text-2xl">WITHIN THE WINDOW</div>
                  <p className="mt-1 text-sm text-amber-100/80">X + Y = {result.sum} ≤ Z = {result.z}: migration completes before a CRQC, but only if it starts now.</p>
                </div>
              </div>
            )}

            <div className="mt-4 -mx-1 overflow-x-auto">
              <table className="w-full min-w-[560px] text-left text-sm">
                <thead>
                  <tr className="text-[11px] tracking-wider text-zinc-500 uppercase">
                    <th className="px-1 pb-2 font-medium">Detected</th>
                    <th className="px-1 pb-2 font-medium">Algorithm</th>
                    <th className="px-1 pb-2 font-medium">Mosca verdict</th>
                    <th className="px-1 pb-2 font-medium">Why</th>
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((r, i) => (
                    <motion.tr key={r.role} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.15 + i * 0.1 }} className="border-t border-white/[0.05] align-top">
                      <td className="px-1 py-2.5 text-zinc-300">{r.role}</td>
                      <td className="px-1 py-2.5 font-mono text-[13px] text-zinc-100">{r.algorithm}</td>
                      <td className="px-1 py-2.5">
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold whitespace-nowrap ${VERDICT_STYLE[r.verdict]}`}>{VERDICT_LABEL[r.verdict]}</span>
                      </td>
                      <td className="px-1 py-2.5 text-xs text-zinc-400">{r.why}</td>
                    </motion.tr>
                  ))}
                </tbody>
              </table>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {children}
    </Stage>
  )
})
