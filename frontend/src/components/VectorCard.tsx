import { ChevronDown } from 'lucide-react'
import { useId } from 'react'
import { cn } from '@/lib/utils'
import { STATUS_TONE } from '@/lib/meta'
import type { CheckResult } from '@/lib/types'
import { businessRisk, type Risk } from '@/lib/risk'
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

// The collapsed row answers "am I protected?" in plain English; the expanded
// view adds the technical summary and score, and tucks the raw DNS evidence
// behind a second disclosure so it never crowds the executive read.
const RISK_LABEL: Record<Risk['kind'], string> = {
  risk: 'Business risk',
  ok: 'Protection status',
  neutral: 'Note',
}

function riskTone(kind: Risk['kind'], status: CheckResult['status']): string {
  if (kind === 'ok') return 'text-ok'
  if (kind === 'neutral') return 'text-slate-500'
  return status === 'fail' ? 'text-crit' : 'text-warn'
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
  const risk = businessRisk(check)

  return (
    <article
      id={`vector-${check.id}`}
      className={cn('panel scroll-mt-32', check.status === 'fail' && 'border-crit/40')}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-controls={bodyId}
        className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-5 gap-y-2 px-6 py-5 text-left transition-colors duration-75 hover:bg-raised"
      >
        <StatusBadge status={check.status} />
        <span className="min-w-0">
          <h3 className="font-mono text-[14px] font-bold tracking-wide text-slate-100">{check.name}</h3>
          <p className="mt-2 max-w-[70ch] text-[13px] leading-relaxed text-slate-300">
            <span className={cn('mr-2 font-bold', riskTone(risk.kind, check.status))}>{RISK_LABEL[risk.kind]}:</span>
            {risk.text}
          </p>
        </span>
        <ChevronDown
          className={cn('mt-0.5 size-4 shrink-0 text-slate-500 transition-transform', expanded && 'rotate-180')}
          aria-hidden
        />
      </button>

      {expanded && (
        <div id={bodyId} className="space-y-6 border-t border-line px-6 py-6">
          <section>
            <div className="mb-3 flex items-baseline justify-between gap-4">
              <h4 className="eyebrow">What we checked</h4>
              <span className="font-mono text-[11px] text-slate-500 tabular-nums">
                {check.applicable ? (
                  <>
                    SCORE <span className="text-slate-200">{check.points.toFixed(1)}</span> / {check.weight}
                  </>
                ) : (
                  'NOT SCORED'
                )}
              </span>
            </div>
            <div className="mb-4 h-px w-full bg-line light:bg-[#d4d4d4]" aria-hidden>
              {check.applicable && <div className={cn('h-px', tone.bg)} style={{ width: `${check.score * 100}%` }} />}
            </div>
            <p className="max-w-[70ch] text-[13px] leading-relaxed text-slate-400">{check.summary}</p>
          </section>

          <details className="group border border-line">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 hover:bg-raised [&::-webkit-details-marker]:hidden">
              <span className="eyebrow">Advanced debug data</span>
              <ChevronDown className="size-3.5 shrink-0 text-slate-500 transition-transform group-open:rotate-180" aria-hidden />
            </summary>

            <div className="space-y-6 border-t border-line px-4 py-5">
              {check.findings.length > 0 && (
                <section>
                  <h5 className="eyebrow mb-3">Findings</h5>
                  <ul className="space-y-2 text-[12.5px] leading-relaxed text-slate-300">
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
                <h5 className="eyebrow mb-3">Raw records</h5>
                {check.records.length > 0 ? (
                  <div className="space-y-2">
                    {check.records.map((r, i) => (
                      <RawRecord key={`${i}-${r}`} value={r} label={`${check.name} record`} />
                    ))}
                  </div>
                ) : (
                  <p className="border border-dashed border-line-strong px-3 py-3 font-mono text-[11px] text-slate-600">
                    — no record published —
                  </p>
                )}
              </section>

              {details.length > 0 && (
                <section>
                  <h5 className="eyebrow mb-3">Parsed</h5>
                  <dl className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] gap-x-4 gap-y-2 font-mono text-[11.5px]">
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
          </details>
        </div>
      )}
    </article>
  )
}
