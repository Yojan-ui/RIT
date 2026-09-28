import { ArrowRight, ShieldCheck } from 'lucide-react'
import { cn } from '@/lib/utils'
import { EFFORT_INFO, VECTOR_ABBR, VECTOR_ORDER, formatMinutes, scoreTone } from '@/lib/meta'
import type { PlanStep, ScanReport, Status, VectorId } from '@/lib/types'
import { SectionHeader, StatusBadge } from './primitives'

function ScoreBlock({ label, score, grade, open }: { label: string; score: number; grade: string; open: number }) {
  return (
    <div className="min-w-0 flex-1">
      <p className="text-[10.5px] font-bold tracking-[0.12em] text-ink-3 uppercase">{label}</p>
      <p className="mt-1 flex items-baseline gap-2 leading-none">
        <span className={cn('text-[28px] font-bold tracking-[-0.02em]', scoreTone(score))}>{score}</span>
        <span className="text-[13px] text-ink-3">/ 100, grade {grade}</span>
      </p>
      <p className={cn('mt-2 text-[12px]', open ? 'text-crit' : 'text-ok')}>
        {open} open attack path{open === 1 ? '' : 's'}
      </p>
    </div>
  )
}

/** Track: grey up to where the step starts, green for what it adds. */
function ScoreBar({ before, after }: { before: number; after: number }) {
  return (
    <span className="relative block h-2 w-full overflow-hidden border border-line" aria-hidden>
      <span className="absolute inset-y-0 left-0 bg-ink-3" style={{ width: `${before}%` }} />
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
      className="grid grid-cols-[2.25rem_minmax(0,1fr)] gap-x-4 gap-y-3 px-4 py-3 md:grid-cols-[2.25rem_minmax(0,1.7fr)_minmax(0,1fr)_minmax(0,0.8fr)] md:items-start"
      onMouseEnter={() => onAim?.(step.id)}
      onMouseLeave={() => onAim?.(null)}
    >
      {/* The plan really is a sequence, so the steps are numbered. */}
      <span className="grid size-8 place-items-center border border-line text-[12.5px] font-bold text-ink-2">
        {index + 1}
      </span>
      <div className="min-w-0">
        <p className="text-[13px] font-medium text-ink">{step.title}</p>
        <p className="mt-1 text-[12.5px] text-ink-2">
          {step.closes.length
            ? `Closes ${step.closes.map((id) => titles.get(id)?.toLowerCase() ?? id).join(', ')}.`
            : 'Tightens the policy for the remaining points.'}
          {waitFirst && <span className="text-warn"> Wait for 2 to 4 weeks of clean DMARC reports first.</span>}
        </p>
      </div>
      <div className="col-start-2 md:col-start-auto">
        <p className="mb-2 text-[12.5px] text-ink-2">
          {step.score_before} <ArrowRight className="inline size-3.5 text-ink-3" aria-label="to" />{' '}
          <span className={cn('font-bold', scoreTone(step.score_after))}>{step.score_after}</span>
          <span className="ml-2 text-ok">+{step.score_after - step.score_before}</span>
        </p>
        <ScoreBar before={step.score_before} after={step.score_after} />
      </div>
      <p className="col-start-2 text-[12.5px] text-ink-2 md:col-start-auto md:text-right">
        <span className="font-medium text-ink">{effort.time}</span>
        <br />
        {effort.who}
        {step.kind === 'server' && <span className="block text-warn">Server change</span>}
      </p>
    </li>
  )
}

/**
 * The backend applies the best fix, re-scores, and repeats, so every "after"
 * number here is a real re-run of the scoring engine, not an estimate.
 */
export function FixPlanPanel({ report, onAim }: { report: ScanReport; onAim?: (id: VectorId | null) => void }) {
  const plan = report.fix_plan
  if (!plan) return null // report cached before plans existed

  const titles = new Map(report.attack_paths.map((p) => [p.id, p.title]))
  const now = new Map<VectorId, Status>(report.checks.map((c) => [c.id, c.status]))
  const after = plan.steps.length ? plan.steps[plan.steps.length - 1].statuses_after : Object.fromEntries(now)
  const minutes = plan.steps.reduce((sum, s) => sum + EFFORT_INFO[s.effort].minutes, 0)
  const remaining = report.attack_paths.filter((p) => plan.remaining.includes(p.id))

  return (
    <section aria-labelledby="plan-heading">
      <SectionHeader
        id="plan-heading"
        title="The fix plan"
        lede={
          plan.steps.length
            ? `${plan.steps.length} step${plan.steps.length === 1 ? '' : 's'}, about ${formatMinutes(minutes).replace('~', '')} of hands-on work. Ordered so the most dangerous gaps close first; every score is the scanner re-run on top of the steps before it.`
            : undefined
        }
      />

      {plan.steps.length === 0 ? (
        <p className="card flex items-center gap-3 px-4 py-3 text-[13px] text-ok">
          <ShieldCheck className="size-5" aria-hidden />
          Nothing to fix. {report.domain} already scores {report.score}.
        </p>
      ) : (
        <div className="card overflow-hidden">
          <div className="grid gap-5 border-b border-line p-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] lg:items-center">
            <div className="flex items-center gap-6">
              <ScoreBlock label="Today" score={report.score} grade={report.grade} open={plan.open_before} />
              <ArrowRight className="size-5 shrink-0 text-ink-3" aria-hidden />
              <ScoreBlock
                label="After the plan"
                score={plan.final_score}
                grade={plan.final_grade}
                open={plan.open_after}
              />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[24rem] border-collapse text-center text-[11.5px]">
                <caption className="sr-only">Protection status today and after the plan</caption>
                <thead>
                  <tr className="text-ink-3">
                    <th scope="col" className="w-20" />
                    {VECTOR_ORDER.map((v) => (
                      <th key={v} scope="col" className="px-1 pb-2 font-medium">
                        {VECTOR_ABBR[v]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(
                    [
                      ['Today', (v: VectorId) => now.get(v)],
                      ['After', (v: VectorId) => after[v]],
                    ] as const
                  ).map(([label, status]) => (
                    <tr key={label} className="border-t border-line">
                      <th scope="row" className="py-2.5 pr-2 text-left font-medium text-ink-2">
                        {label}
                      </th>
                      {VECTOR_ORDER.map((v) => {
                        const s = status(v)
                        return (
                          <td key={v} className="px-1 py-2.5">
                            {s ? <StatusBadge status={s} compact /> : <span className="text-ink-3">—</span>}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <ol className="divide-y divide-line">
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
            <div className="border-t border-line bg-sunken px-4 py-3">
              <p className="subhead">Still open after the plan</p>
              <ul className="mt-2 space-y-1.5 text-[12.5px]">
                {remaining.map((p) => (
                  <li key={p.id}>
                    <span className="font-medium text-ink">{p.title}.</span>{' '}
                    <span className="text-ink-2">{p.remedy}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
