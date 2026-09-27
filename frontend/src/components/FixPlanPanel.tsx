import { ShieldCheck } from 'lucide-react'
import { cn } from '@/lib/utils'
import { EFFORT_INFO, VECTOR_ABBR, VECTOR_ORDER, formatMinutes, scoreTone } from '@/lib/meta'
import type { PlanStep, ScanReport, Status, VectorId } from '@/lib/types'
import { PanelHeader, StatusBadge } from './primitives'

function ScoreBlock({ label, score, grade, open }: { label: string; score: number; grade: string; open: number }) {
  return (
    <div className="flex-1 border border-white/10 px-4 py-3">
      <p className="eyebrow mb-1">{label}</p>
      <p className="flex items-baseline gap-2 font-mono leading-none tabular-nums">
        <span className={cn('text-4xl font-bold tracking-tight', scoreTone(score))}>{score}</span>
        <span className="text-sm text-slate-600">/ 100</span>
        <span className={cn('ml-1 border border-current px-1.5 text-base font-bold', scoreTone(score))}>{grade}</span>
      </p>
      <p className={cn('mt-2 font-mono text-[10.5px] tracking-wider', open ? 'text-crit' : 'text-ok')}>
        {open} OPEN ATTACK PATH{open === 1 ? '' : 'S'}
      </p>
    </div>
  )
}

/** 1px track: grey up to where the step starts, green for what it adds. */
function ScoreBar({ before, after }: { before: number; after: number }) {
  return (
    <span className="relative block h-2 w-full border border-white/10" aria-hidden>
      <span className="absolute inset-y-0 left-0 bg-slate-600" style={{ width: `${before}%` }} />
      <span className="absolute inset-y-0 bg-ok" style={{ left: `${before}%`, width: `${after - before}%` }} />
    </span>
  )
}

function StepRow({
  step,
  index,
  waitFirst,
  titles,
  onAim,
}: {
  step: PlanStep
  index: number
  waitFirst: boolean
  titles: Map<string, string>
  onAim?: (id: VectorId | null) => void
}) {
  const effort = EFFORT_INFO[step.effort]
  return (
    <li
      className="grid grid-cols-[2rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 border-b border-white/10 px-4 py-3 last:border-b-0 hover:bg-raised md:grid-cols-[2rem_minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)]"
      onMouseEnter={() => onAim?.(step.id)}
      onMouseLeave={() => onAim?.(null)}
    >
      <span className="font-mono text-[11px] text-slate-600 tabular-nums">{String(index + 1).padStart(2, '0')}</span>
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-2">
          <span
            className={cn(
              'border px-1.5 py-px font-mono text-[9.5px] tracking-wider',
              step.kind === 'server' ? 'border-warn/60 text-warn' : 'border-white/10 text-slate-400',
            )}
          >
            {step.kind === 'server' ? 'SERVER' : 'DNS'}
          </span>
          <span className="font-mono text-[11px] font-bold tracking-wider text-slate-100">{VECTOR_ABBR[step.id]}</span>
          <span className="text-[12.5px] text-slate-200">{step.title}</span>
        </p>
        <p className="mt-1 text-[11.5px] text-slate-500">
          {step.closes.length
            ? `Closes: ${step.closes.map((id) => titles.get(id) ?? id).join(', ')}.`
            : 'Closes no path on its own; tightens the policy for the remaining points.'}
          {waitFirst && <span className="text-warn"> Do this after 2 to 4 weeks of clean DMARC reports.</span>}
        </p>
      </div>
      <div className="col-start-2 md:col-start-auto">
        <p className="mb-1 font-mono text-[11px] tabular-nums">
          <span className="text-slate-400">{step.score_before}</span>
          <span className="text-slate-600"> → </span>
          <span className={scoreTone(step.score_after)}>{step.score_after}</span>
          <span className="text-slate-600"> ({step.grade_after})</span>
          <span className="ml-2 text-ok">+{step.score_after - step.score_before}</span>
        </p>
        <ScoreBar before={step.score_before} after={step.score_after} />
      </div>
      <p className="col-start-2 font-mono text-[11px] text-slate-400 md:col-start-auto">
        <span className="text-slate-100">{effort.time}</span> · {effort.who}
      </p>
    </li>
  )
}

/**
 * FIX PLAN: the backend applies the best fix, re-scores, and repeats, so every
 * "after" number here is a real re-run of the scoring engine, not an estimate.
 */
export function FixPlanPanel({ report, onAim }: { report: ScanReport; onAim?: (id: VectorId | null) => void }) {
  const plan = report.fix_plan
  if (!plan) return null // report cached before plans existed

  const titles = new Map(report.attack_paths.map((p) => [p.id, p.title]))
  const now = new Map<VectorId, Status>(report.checks.map((c) => [c.id, c.status]))
  const after = plan.steps.length ? plan.steps[plan.steps.length - 1].statuses_after : Object.fromEntries(now)
  const minutes = plan.steps.reduce((sum, s) => sum + EFFORT_INFO[s.effort].minutes, 0)
  const serverMinutes = plan.steps
    .filter((s) => s.kind === 'server')
    .reduce((sum, s) => sum + EFFORT_INFO[s.effort].minutes, 0)
  const remaining = report.attack_paths.filter((p) => plan.remaining.includes(p.id))

  return (
    <section className="panel" aria-labelledby="plan-heading">
      <PanelHeader label="Fix plan · how it looks after fixing">
        <span id="plan-heading" className="font-mono text-[10px] tracking-wider text-slate-500">
          {plan.steps.length} STEP{plan.steps.length === 1 ? '' : 'S'} · {minutes ? formatMinutes(minutes) : '0 min'}{' '}
          HANDS-ON
        </span>
      </PanelHeader>

      {plan.steps.length === 0 ? (
        <p className="flex items-center gap-2 px-4 py-4 font-mono text-[11px] tracking-wider text-ok">
          <ShieldCheck className="size-4" aria-hidden />
          NOTHING TO FIX: {report.domain.toUpperCase()} ALREADY SCORES {report.score}
        </p>
      ) : (
        <>
          <div className="grid gap-3 border-b border-white/10 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
            <div className="flex items-stretch gap-2">
              <ScoreBlock label="Now" score={report.score} grade={report.grade} open={plan.open_before} />
              <span className="self-center font-mono text-lg text-slate-600" aria-hidden>
                →
              </span>
              <ScoreBlock
                label="After the plan"
                score={plan.final_score}
                grade={plan.final_grade}
                open={plan.open_after}
              />
            </div>
            <div className="overflow-x-auto border border-white/10">
              <table className="w-full min-w-[26rem] border-collapse text-center font-mono text-[10px]">
                <thead>
                  <tr className="border-b border-white/10 text-slate-500">
                    <th scope="col" className="w-16 px-2 py-1.5 text-left font-medium" />
                    {VECTOR_ORDER.map((v) => (
                      <th key={v} scope="col" className="px-1 py-1.5 font-medium tracking-wider">
                        {VECTOR_ABBR[v]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(
                    [
                      ['NOW', (v: VectorId) => now.get(v)],
                      ['AFTER', (v: VectorId) => after[v]],
                    ] as const
                  ).map(([label, status]) => (
                    <tr key={label} className="border-b border-white/10 last:border-b-0">
                      <th scope="row" className="px-2 py-1.5 text-left font-medium tracking-wider text-slate-400">
                        {label}
                      </th>
                      {VECTOR_ORDER.map((v) => {
                        const s = status(v)
                        return (
                          <td key={v} className="px-1 py-1.5">
                            {s ? <StatusBadge status={s} compact /> : <span className="text-slate-600">—</span>}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <p className="border-b border-white/10 px-4 py-2 text-[11.5px] text-slate-400">
            Ordered by impact: each step closes the most severe open attack paths first, then gains the most points,
            then needs the least work. Every score is the scanner re-run on top of the steps before it. The One Fix is
            the best single DNS change, so the plan can start elsewhere when a server step closes a worse path.
            {serverMinutes > 0 && (
              <>
                {' '}
                DNS steps take <span className="text-slate-100">{formatMinutes(minutes - serverMinutes)}</span>; the
                server step needs about <span className="text-slate-100">{formatMinutes(serverMinutes)}</span> of mail
                server work.
              </>
            )}
          </p>

          <ol>
            {plan.steps.map((step, i) => (
              <StepRow
                key={`${step.id}-${i}`}
                step={step}
                index={i}
                // A second DMARC step tightens quarantine to reject, which needs weeks of reports first.
                waitFirst={step.id === 'dmarc' && plan.steps.slice(0, i).some((s) => s.id === 'dmarc')}
                titles={titles}
                onAim={onAim}
              />
            ))}
          </ol>

          {remaining.length > 0 && (
            <div className="border-t border-white/10 px-4 py-3">
              <p className="eyebrow mb-1.5">Still open after the plan · needs manual work</p>
              <ul className="space-y-1 text-[12px]">
                {remaining.map((p) => (
                  <li key={p.id} className="flex gap-2">
                    <span className="font-mono text-crit" aria-hidden>
                      ×
                    </span>
                    <span>
                      <span className="text-slate-100">{p.title}:</span>{' '}
                      <span className="text-slate-400">{p.remedy}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  )
}
