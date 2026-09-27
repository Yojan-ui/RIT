import type { ReactNode } from 'react'
import { api } from '@/api/client'
import type { ScanResult } from '@/api/types'
import { Panel } from '@/components/Panel'
import { cn } from '@/lib/cn'
import { CONTROL_LABEL, EXPOSURE_LABEL, EXPOSURE_TONE, GRADE_TONE, STATUS_LABEL, STATUS_TONE, TEXT, type Tone } from '@/lib/tone'

const BAR: Record<Tone, string> = {
  secure: 'bg-secure',
  partial: 'bg-partial',
  vulnerable: 'bg-vulnerable',
  unknown: 'bg-faint',
}

function Metric({ label, value, tone, sub }: { label: string; value: ReactNode; tone?: Tone; sub?: string }) {
  return (
    <div className="min-w-0 border-line px-3 py-2 not-first:border-l">
      <div className="label">{label}</div>
      <div className={cn('tabular mt-0.5 text-xl leading-7 text-ink', tone && TEXT[tone])}>
        {value}
        {sub && <span className="ml-0.5 text-xs text-dim">{sub}</span>}
      </div>
    </div>
  )
}

export function MetricStrip({ result, elapsedMs }: { result: ScanResult; elapsedMs: number }) {
  const count = (e: string) => result.attack_matrix.filter((p) => p.exposure === e).length
  return (
    <div className="grid grid-cols-3 border border-line bg-panel sm:grid-cols-6">
      <Metric label="Score" value={String(result.score.score).padStart(3, '0')} sub="/100" tone={GRADE_TONE[result.score.grade]} />
      <Metric label="Grade" value={result.score.grade} tone={GRADE_TONE[result.score.grade]} />
      <Metric label="Open" value={count('exposed')} tone={count('exposed') ? 'vulnerable' : undefined} />
      <Metric label="Partial" value={count('partial')} tone={count('partial') ? 'partial' : undefined} />
      <Metric label="Defended" value={count('mitigated')} tone={count('mitigated') ? 'secure' : undefined} />
      <Metric label={result.cached ? 'Cached' : 'Scan'} value={result.cached ? '—' : elapsedMs} sub={result.cached ? undefined : 'ms'} />
    </div>
  )
}

export function ChecksGrid({ result }: { result: ScanResult }) {
  return (
    <Panel title="Controls" right={<span className="tabular text-2xs text-dim">{result.checks.length} checks</span>}>
      <table className="w-full border-collapse text-left font-mono text-xs">
        <thead>
          <tr className="text-2xs text-dim">
            <th className="px-3 py-1.5 font-normal">CONTROL</th>
            <th className="px-3 py-1.5 font-normal">STATUS</th>
            <th className="px-3 py-1.5 text-right font-normal">PTS</th>
            <th className="px-3 py-1.5 font-normal">RESULT</th>
          </tr>
        </thead>
        <tbody>
          {result.checks.map((c) => {
            const tone = STATUS_TONE[c.status]
            const pts = result.score.components[c.name]
            return (
              <tr key={c.name} className="border-t border-line align-top hover:bg-raised">
                <td className="whitespace-nowrap px-3 py-1.5 text-ink">{CONTROL_LABEL[c.name] ?? c.name}</td>
                <td className={cn('whitespace-nowrap px-3 py-1.5', TEXT[tone])}>{STATUS_LABEL[c.status]}</td>
                <td className="tabular whitespace-nowrap px-3 py-1.5 text-right text-ink">{pts === undefined ? '—' : pts}</td>
                <td className="px-3 py-1.5 font-sans text-dim [overflow-wrap:anywhere]">{c.summary}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </Panel>
  )
}

export function AttackGrid({ result }: { result: ScanResult }) {
  return (
    <Panel title="Attack paths" right={<span className="tabular text-2xs text-dim">7 vectors</span>}>
      <ul>
        {result.attack_matrix.map((p) => {
          const tone = EXPOSURE_TONE[p.exposure]
          return (
            <li key={p.id} className="relative grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 border-t border-line py-1.5 pl-4 pr-3 first:border-t-0 hover:bg-raised">
              <span className={cn('absolute inset-y-0 left-0 w-0.5', BAR[tone])} aria-hidden="true" />
              <span className="min-w-0">
                <span className="text-ink">{p.title}</span>
                <span className="ml-2 font-mono text-2xs uppercase text-dim">{p.severity}</span>
                <span className="block text-xs text-dim [overflow-wrap:anywhere]">{p.reason}</span>
              </span>
              <span className={cn('font-mono text-xs font-semibold', TEXT[tone])}>{EXPOSURE_LABEL[p.exposure]}</span>
            </li>
          )
        })}
      </ul>
    </Panel>
  )
}

export function FixPanel({ result }: { result: ScanResult }) {
  const fix = result.one_fix
  return (
    <Panel
      title="Priority fix"
      right={fix && fix.score_gain > 0 ? <span className="tabular text-xs text-secure">+{fix.score_gain} pts</span> : undefined}
    >
      {fix ? (
        <div className="space-y-2 p-3">
          <p className="text-sm font-medium text-ink">{fix.title}</p>
          <p className="text-xs text-dim">{fix.action}</p>
          {fix.record && (
            <div className="border border-line bg-obsidian">
              <div className="border-b border-line px-2 py-1 font-mono text-2xs text-dim">
                {fix.record_type} <span className="text-ink">{fix.host}</span>
              </div>
              <pre className="whitespace-pre-wrap px-2 py-1.5 font-mono text-xs text-secure [overflow-wrap:anywhere]">{fix.record}</pre>
            </div>
          )}
        </div>
      ) : (
        <p className="p-3 text-xs text-secure">All seven attack paths are defended. Nothing to fix.</p>
      )}
      <div className="flex gap-2 border-t border-line px-3 py-2">
        <a className="border border-line px-2 py-0.5 font-mono text-2xs text-dim hover:border-line-strong hover:text-ink" href={api.exportUrl(result.domain, 'pdf')}>
          PDF
        </a>
        <a className="border border-line px-2 py-0.5 font-mono text-2xs text-dim hover:border-line-strong hover:text-ink" href={api.exportUrl(result.domain, 'json')}>
          JSON
        </a>
      </div>
    </Panel>
  )
}
