import { cn } from '@/lib/utils'
import { STATUS_TONE, VECTOR_ABBR, scoreBg, scoreTone } from '@/lib/meta'
import type { ScanReport } from '@/lib/types'
import { PanelHeader } from './primitives'

const utcTime = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'UTC' })

export function ScorePanel({ report }: { report: ScanReport }) {
  const scored = report.checks.filter((c) => c.applicable)
  const possible = scored.reduce((sum, c) => sum + c.weight, 0)
  const counts = { open: 0, closed: 0, not_applicable: 0 }
  for (const path of report.attack_paths) counts[path.state] += 1

  return (
    <section className="panel flex h-full flex-col" aria-labelledby="score-heading">
      <PanelHeader label="Security posture">
        <span
          className={cn(
            'rounded-sm border px-1.5 py-0.5 font-mono text-[10px] tracking-wider',
            report.mode === 'live' ? 'border-ok/40 text-ok' : 'border-line-strong text-slate-400',
          )}
        >
          {report.mode === 'live' ? 'LIVE' : 'DEMO DATA'}
        </span>
      </PanelHeader>

      <div className="flex flex-1 flex-col gap-5 p-4">
        <div>
          <p className="truncate font-mono text-sm text-slate-200" title={report.domain}>
            {report.domain}
          </p>
          <div className="mt-2 flex items-end gap-3" id="score-heading">
            <span className={cn('font-mono text-7xl leading-none font-bold tabular-nums', scoreTone(report.score))}>
              {report.score}
            </span>
            <span className="pb-1.5 font-mono text-sm text-slate-600">/100</span>
            <span
              className={cn(
                'ml-auto mb-1 grid size-10 place-items-center rounded-sm border font-mono text-xl font-bold',
                scoreTone(report.score),
                'border-current/40',
              )}
              aria-label={`Grade ${report.grade}`}
            >
              {report.grade}
            </span>
          </div>
          <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-line" aria-hidden>
            <div className={cn('h-full', scoreBg(report.score))} style={{ width: `${report.score}%` }} />
          </div>
          <p className="mt-3 text-[13px] text-slate-300">{report.summary}</p>
        </div>

        {/* Each segment is one vector: width = its share of the score, fill = how much it earned */}
        <div>
          <p className="eyebrow mb-2">Contribution by vector</p>
          <div className="flex h-5 gap-px" role="list">
            {scored.map((c) => (
              <div
                key={c.id}
                role="listitem"
                className="relative h-full overflow-hidden rounded-[1px] bg-line"
                style={{ width: `${(c.weight / possible) * 100}%` }}
                title={`${c.name}: ${c.points.toFixed(1)} / ${c.weight}`}
                aria-label={`${c.name}: ${c.points.toFixed(1)} of ${c.weight} points`}
              >
                <div className={cn('h-full opacity-80', STATUS_TONE[c.status].bg)} style={{ width: `${c.score * 100}%` }} />
              </div>
            ))}
          </div>
          <div className="mt-1 flex gap-px font-mono text-[9px] text-slate-500" aria-hidden>
            {scored.map((c) => (
              <span key={c.id} className="truncate" style={{ width: `${(c.weight / possible) * 100}%` }}>
                {VECTOR_ABBR[c.id]}
              </span>
            ))}
          </div>
        </div>

        <dl className="grid grid-cols-3 gap-px overflow-hidden rounded-sm border border-line bg-line">
          {(
            [
              ['Open paths', counts.open, counts.open ? 'text-crit' : 'text-slate-500'],
              ['Closed', counts.closed, 'text-ok'],
              ['N/A', counts.not_applicable, 'text-slate-500'],
            ] as const
          ).map(([label, value, tone]) => (
            <div key={label} className="bg-panel px-3 py-2">
              <dt className="eyebrow">{label}</dt>
              <dd className={cn('mt-1 font-mono text-2xl font-bold tabular-nums', tone)}>{value}</dd>
            </div>
          ))}
        </dl>
      </div>

      <footer className="flex justify-between border-t border-line px-4 py-2 font-mono text-[10px] text-slate-500">
        <span>SCANNED {utcTime(report.scanned_at)} UTC</span>
        <span>{report.duration_ms.toLocaleString()} MS</span>
      </footer>
    </section>
  )
}
