import { ChevronDown } from 'lucide-react'
import { useId } from 'react'
import { cn } from '@/lib/utils'
import { STATUS_TONE, VECTOR_PLAIN } from '@/lib/meta'
import { businessRisk, type Risk } from '@/lib/risk'
import type { CheckResult } from '@/lib/types'
import { RawRecord, StatusBadge } from './primitives'

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

function riskTone(kind: Risk['kind'], status: CheckResult['status']): string {
  if (kind === 'ok') return 'text-ink-2'
  if (kind === 'neutral') return 'text-ink-3'
  return status === 'fail' ? 'text-crit' : 'text-warn'
}

// The collapsed row answers "am I protected?" in plain English; opening it adds
// the technical summary and score, and the raw DNS evidence sits one level
// further down so it never crowds the first read.
export function VectorCard({
  check,
  expanded,
  onToggle,
  onAim,
}: {
  check: CheckResult
  expanded: boolean
  onToggle: () => void
  onAim?: (on: boolean) => void
}) {
  const bodyId = useId()
  const tone = STATUS_TONE[check.status]
  const details = detailRows(check.details)
  const risk = businessRisk(check)

  return (
    <li
      id={`vector-${check.id}`}
      className="scroll-mt-40"
      onMouseEnter={() => onAim?.(true)}
      onMouseLeave={() => onAim?.(false)}
    >
      <button
        type="button"
        onClick={onToggle}
        onFocus={() => onAim?.(true)}
        onBlur={() => onAim?.(false)}
        aria-expanded={expanded}
        aria-controls={bodyId}
        className="group grid w-full grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4 px-4 py-3 text-left transition-colors hover:bg-sunken sm:grid-cols-[6rem_minmax(0,1fr)_auto]"
      >
        <span className="hidden pt-0.5 sm:block">
          <StatusBadge status={check.status} />
        </span>
        <span className="min-w-0">
          <span className="flex flex-wrap items-baseline gap-x-2.5">
            <span className="text-[13px] font-bold text-ink">{check.name}</span>
            <span className="text-[12px] text-ink-3">{VECTOR_PLAIN[check.id]}</span>
          </span>
          <span className="mt-2 block sm:hidden">
            <StatusBadge status={check.status} />
          </span>
          <span className={cn('mt-1.5 block max-w-[62ch] text-[12.5px] leading-snug', riskTone(risk.kind, check.status))}>
            {risk.text}
          </span>
        </span>
        <ChevronDown
          className={cn(
            'mt-1 size-4.5 shrink-0 text-ink-3 transition-transform group-hover:text-ink',
            expanded && 'rotate-180',
          )}
          aria-hidden
        />
      </button>

      {expanded && (
        <div id={bodyId} className="space-y-4 px-4 pb-4 sm:pl-[8rem]">
          <div>
            <p className="max-w-[62ch] text-[12.5px] text-ink-2">{check.summary}</p>
            <div className="mt-4 flex items-center gap-3 text-[12px] text-ink-2">
              {check.applicable ? (
                <>
                  <span className="relative block h-2 w-40 overflow-hidden border border-line" aria-hidden>
                    <span className={cn('absolute inset-y-0 left-0', tone.bg)} style={{ width: `${check.score * 100}%` }} />
                  </span>
                  <span>
                    <span className="font-bold text-ink">{check.points.toFixed(1)}</span> of {check.weight} points
                  </span>
                </>
              ) : (
                <span>Not part of the score for this domain</span>
              )}
            </div>
          </div>

          <details className="group/adv border border-line bg-surface">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-[11px] font-bold tracking-[0.12em] text-ink-2 hover:text-ink [&::-webkit-details-marker]:hidden">
              ADVANCED DEBUG DATA
              <ChevronDown className="size-4 shrink-0 transition-transform group-open/adv:rotate-180" aria-hidden />
            </summary>

            <div className="space-y-4 border-t border-line px-4 py-3">
              {check.findings.length > 0 && (
                <section>
                  <h4 className="subhead mb-2">Findings</h4>
                  <ul className="space-y-1.5 text-[12.5px] text-ink-2">
                    {check.findings.map((f) => (
                      <li key={f} className="flex gap-2.5">
                        <span className={cn('mt-2 size-1.5 shrink-0', tone.bg)} aria-hidden />
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              <section>
                <h4 className="subhead mb-2">Raw records</h4>
                {check.records.length > 0 ? (
                  <div className="space-y-2">
                    {check.records.map((r, i) => (
                      <RawRecord key={`${i}-${r}`} value={r} label={`${check.name} record`} />
                    ))}
                  </div>
                ) : (
                  <p className="text-[12.5px] text-ink-3">No record is published.</p>
                )}
              </section>

              {details.length > 0 && (
                <section>
                  <h4 className="subhead mb-2">Parsed</h4>
                  <dl className="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-[12px]">
                    {details.map(([k, v]) => (
                      <div key={k} className="contents">
                        <dt className="truncate text-ink-3">{k}</dt>
                        <dd className="font-mono text-[11.5px] break-all text-ink">{v}</dd>
                      </div>
                    ))}
                  </dl>
                </section>
              )}
            </div>
          </details>
        </div>
      )}
    </li>
  )
}
