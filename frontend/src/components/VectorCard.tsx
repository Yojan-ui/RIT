import { ChevronDown } from 'lucide-react'
import { useId } from 'react'
import { cn } from '@/lib/utils'
import { STATUS_TONE } from '@/lib/meta'
import type { CheckResult } from '@/lib/types'
import { Lamp, RawRecord } from './primitives'

// Keys already shown elsewhere on the card, or too noisy to list.
const HIDDEN_DETAILS = new Set(['state', 'records', 'mechanisms', 'reachable', 'duration_ms'])

function formatValue(value: unknown): string {
  if (typeof value === 'boolean') return value ? 'yes' : 'no'
  if (Array.isArray(value)) return value.length ? value.join(', ') : '—'
  if (value && typeof value === 'object')
    return Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => `${k}=${String(v)}`)
      .join('; ')
  return String(value)
}

function detailRows(details: Record<string, unknown>): [string, string][] {
  return Object.entries(details)
    .filter(([k, v]) => !HIDDEN_DETAILS.has(k) && v !== null && v !== undefined && v !== '')
    .map(([k, v]) => [k.replace(/_/g, ' '), formatValue(v)])
}

export function VectorCard({
  check,
  expanded,
  onToggle,
}: {
  check: CheckResult
  expanded: boolean
  onToggle: () => void
}) {
  const bodyId = useId()
  const tone = STATUS_TONE[check.status]
  const details = detailRows(check.details)

  return (
    <article id={`vector-${check.id}`} className={cn('panel scroll-mt-32', check.status === 'fail' && 'border-crit/30')}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-controls={bodyId}
        className="flex w-full flex-col gap-2 px-4 py-3 text-left hover:bg-raised"
      >
        <div className="flex w-full items-center gap-2.5">
          <Lamp className={tone.bg} />
          <h3 className="font-mono text-[13px] font-bold tracking-wide text-slate-100">{check.name}</h3>
          <span className={cn('font-mono text-[10px] tracking-wider', tone.text)}>{tone.label}</span>
          <span className="ml-auto font-mono text-[11px] text-slate-500 tabular-nums">
            {check.applicable ? (
              <>
                <span className="text-slate-300">{check.points.toFixed(1)}</span> / {check.weight}
              </>
            ) : (
              'NOT SCORED'
            )}
          </span>
          <ChevronDown
            className={cn('size-3.5 shrink-0 text-slate-500 transition-transform', expanded && 'rotate-180')}
            aria-hidden
          />
        </div>
        <div className="h-0.5 w-full overflow-hidden rounded-full bg-line light:bg-[#d4d4d4]" aria-hidden>
          {check.applicable && <div className={cn('h-full', tone.bg)} style={{ width: `${check.score * 100}%` }} />}
        </div>
        <p className={cn('text-[12.5px] text-slate-400', !expanded && 'line-clamp-2')}>{check.summary}</p>
      </button>

      {expanded && (
        <div id={bodyId} className="space-y-4 border-t border-line px-4 py-3">
          {check.findings.length > 0 && (
            <section>
              <h4 className="eyebrow mb-1.5">Findings</h4>
              <ul className="space-y-1 text-[12.5px] text-slate-300">
                {check.findings.map((f) => (
                  <li key={f} className="flex gap-2">
                    <span className={cn('font-mono', tone.text)} aria-hidden>
                      ›
                    </span>
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section>
            <h4 className="eyebrow mb-1.5">Raw records</h4>
            {check.records.length > 0 ? (
              <div className="space-y-1.5">
                {check.records.map((r, i) => (
                  <RawRecord key={`${i}-${r}`} value={r} label={`${check.name} record`} />
                ))}
              </div>
            ) : (
              <p className="rounded-sm border border-dashed border-line-strong px-2 py-2 font-mono text-[11px] text-slate-600">
                — no record published —
              </p>
            )}
          </section>

          {details.length > 0 && (
            <section>
              <h4 className="eyebrow mb-1.5">Parsed</h4>
              <dl className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] gap-x-3 gap-y-1 font-mono text-[11.5px]">
                {details.map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="truncate text-slate-500">{k}</dt>
                    <dd className="break-all text-slate-300">{v}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )}
        </div>
      )}
    </article>
  )
}
