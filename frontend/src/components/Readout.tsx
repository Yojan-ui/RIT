import { useState, type ReactNode } from 'react'
import { api } from '@/api/client'
import type { AttackPath, CheckResult, ScanResult } from '@/api/types'
import { CopyButton } from '@/components/CopyButton'
import { Panel } from '@/components/Panel'
import { cn } from '@/lib/cn'
import { CONTROL_LABEL, EXPOSURE_LABEL, EXPOSURE_TONE, GRADE_TONE, SEVERITY_TONE, STATUS_LABEL, STATUS_TONE, TEXT, type Tone } from '@/lib/tone'

const BG: Record<Tone, string> = { secure: 'bg-secure', partial: 'bg-partial', vulnerable: 'bg-vulnerable', unknown: 'bg-faint' }
// Matrix columns: the controls that defend attack paths (MX defends none).
const MATRIX_CONTROLS = ['dmarc', 'spf', 'dkim', 'mta_sts', 'tls_rpt', 'transport'] as const

function Chevron({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 12 12" aria-hidden="true" className={cn('size-2.5 shrink-0 text-dim transition-transform', open && 'rotate-90')}>
      <path d="M4 2l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}

/** Toggles a set of open ids; `initial` opens rows such as failing checks up front. */
function useOpen(initial: string[] = []) {
  const [open, setOpen] = useState(() => new Set(initial))
  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev)
      if (!next.delete(id)) next.add(id)
      return next
    })
  return { isOpen: (id: string) => open.has(id), toggle }
}

// -- Metric strip ------------------------------------------------------------------------------
function Metric({ label, value, tone, sub }: { label: string; value: ReactNode; tone?: Tone; sub?: string }) {
  return (
    <div className="min-w-0 border-line px-3 py-2 not-first:border-l max-sm:nth-[4]:border-l-0 max-sm:nth-[n+4]:border-t">
      <div className="label">{label}</div>
      <div className={cn('tabular mt-0.5 truncate text-xl leading-7 text-ink', tone && TEXT[tone])}>
        {value}
        {sub && <span className="ml-0.5 text-xs text-dim">{sub}</span>}
      </div>
    </div>
  )
}

export function MetricStrip({ result, elapsedMs, isDemo }: { result: ScanResult; elapsedMs: number; isDemo: boolean }) {
  const count = (e: string) => result.attack_matrix.filter((p) => p.exposure === e).length
  const scanned = new Date(result.scanned_at)
  const notAssessed = result.score.not_assessed.map((n) => CONTROL_LABEL[n] ?? n)
  return (
    <div className="border border-line bg-panel">
      <div className="grid grid-cols-3 sm:grid-cols-6">
        <Metric label="Score" value={String(result.score.score).padStart(3, '0')} sub="/100" tone={GRADE_TONE[result.score.grade]} />
        <Metric label="Grade" value={result.score.grade} tone={GRADE_TONE[result.score.grade]} />
        <Metric label="Open" value={count('exposed')} tone={count('exposed') ? 'vulnerable' : undefined} />
        <Metric label="Partial" value={count('partial')} tone={count('partial') ? 'partial' : undefined} />
        <Metric label="Defended" value={count('mitigated')} tone={count('mitigated') ? 'secure' : undefined} />
        <Metric
          label={result.cached ? 'Cached scan' : 'Scan time'}
          value={result.cached ? scanned.toISOString().slice(11, 16) : elapsedMs}
          sub={result.cached ? 'UTC' : 'ms'}
        />
      </div>
      {(isDemo || notAssessed.length > 0) && (
        <div className="space-y-1 border-t border-line px-3 py-2 text-xs">
          {isDemo && (
            <p className="text-dim">
              <span className="font-mono text-signal">DEMO</span> Built-in demo domain: its DNS records, MTA-STS policy and mail server are
              simulated, so the result is the same every time.
            </p>
          )}
          {notAssessed.length > 0 && (
            <p className="text-dim">
              <span className="font-mono text-unknown">N/A</span> Not measurable from this network, so left out of the score (not counted
              as failures): <span className="text-ink">{notAssessed.join(', ')}</span>.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

// -- Attack matrix -----------------------------------------------------------------------------
function cellTone(path: AttackPath, control: string, statuses: Map<string, CheckResult['status']>): Tone {
  const specific = path.control_exposure[control]
  if (specific) return EXPOSURE_TONE[specific]
  return STATUS_TONE[statuses.get(control) ?? 'not_assessed']
}

function Dot({ tone, big }: { tone: Tone; big?: boolean }) {
  return tone === 'unknown' ? (
    <span className={cn('inline-block rounded-full border border-dim', big ? 'size-2.5' : 'size-2')} aria-hidden="true" />
  ) : (
    <span className={cn('inline-block rounded-full', BG[tone], big ? 'size-2.5' : 'size-2')} aria-hidden="true" />
  )
}

export function AttackMatrix({ result }: { result: ScanResult }) {
  const statuses = new Map(result.checks.map((c) => [c.name, c.status]))
  const { isOpen, toggle } = useOpen()
  const cols = 'md:grid-cols-[minmax(0,1fr)_repeat(6,3.5rem)_5.5rem]'
  return (
    <Panel
      title="Attack matrix"
      right={
        <span className="hidden items-center gap-3 font-mono text-2xs text-dim sm:flex">
          <span className="flex items-center gap-1"><Dot tone="secure" />defends</span>
          <span className="flex items-center gap-1"><Dot tone="partial" />weak</span>
          <span className="flex items-center gap-1"><Dot tone="vulnerable" />fails</span>
          <span className="flex items-center gap-1"><Dot tone="unknown" />n/a</span>
        </span>
      }
    >
      <div role="table" aria-label="Attack paths by defending control">
        <div role="row" className={cn('hidden border-b border-line px-3 py-1.5 font-mono text-2xs text-dim md:grid md:gap-x-2', cols)}>
          <span role="columnheader">VECTOR</span>
          {MATRIX_CONTROLS.map((c) => (
            <span role="columnheader" key={c} className="text-center">{CONTROL_LABEL[c]}</span>
          ))}
          <span role="columnheader" className="text-right">EXPOSURE</span>
        </div>
        {result.attack_matrix.map((p) => {
          const tone = EXPOSURE_TONE[p.exposure]
          const open = isOpen(p.id)
          return (
            <div key={p.id} role="row" className="relative border-t border-line first:border-t-0 md:first-of-type:border-t-0">
              <span className={cn('absolute inset-y-0 left-0 w-0.5', BG[tone])} aria-hidden="true" />
              <div className={cn('grid grid-cols-[minmax(0,1fr)_auto] gap-x-2 gap-y-1.5 py-2 pl-4 pr-3 md:items-center', cols)}>
                {/* Pinned to column 1: row-locked cells are auto-placed before unpinned ones, so an
                    unpinned title would be pushed behind the six control columns. */}
                <div role="cell" className="min-w-0 md:col-start-1 md:row-start-1">
                  <button type="button" onClick={() => toggle(p.id)} aria-expanded={open} className="flex items-center gap-1.5 text-left">
                    <Chevron open={open} />
                    <span className="text-ink">{p.title}</span>
                    <span className="font-mono text-2xs uppercase text-dim">{p.severity}</span>
                  </button>
                  <p className="pl-4 text-xs text-dim [overflow-wrap:anywhere]">{p.reason}</p>
                </div>
                {/* Cells: chips on mobile (defending controls only), one column each from md up. */}
                <div className="col-span-2 row-start-2 flex flex-wrap gap-1.5 pl-4 md:contents">
                  {MATRIX_CONTROLS.map((c) => {
                    const defends = p.enabled_by.includes(c)
                    const cell = cellTone(p, c, statuses)
                    return (
                      <div
                        key={c}
                        role="cell"
                        className={cn(
                          'items-center gap-1.5 border border-line px-1.5 py-0.5 font-mono text-2xs text-dim md:row-start-1 md:justify-center md:border-0 md:p-0',
                          defends ? 'flex' : 'hidden md:flex',
                        )}
                      >
                        {defends ? <Dot tone={cell} big /> : <span className="size-1 bg-line" aria-hidden="true" />}
                        <span className="md:sr-only">{defends ? `${CONTROL_LABEL[c]}` : `${CONTROL_LABEL[c]}: not relevant`}</span>
                      </div>
                    )
                  })}
                </div>
                <div role="cell" className={cn('col-start-2 row-start-1 text-right font-mono text-xs font-semibold md:col-start-8', TEXT[tone])}>
                  {EXPOSURE_LABEL[p.exposure]}
                </div>
              </div>
              {open && (
                <p className="max-w-[72ch] px-8 pb-3 text-xs text-ink">{p.description.replaceAll('<domain>', result.domain)}</p>
              )}
            </div>
          )
        })}
      </div>
    </Panel>
  )
}

// -- Controls ----------------------------------------------------------------------------------
export function ChecksGrid({ result }: { result: ScanResult }) {
  const { isOpen, toggle } = useOpen(result.checks.filter((c) => c.status === 'fail' || c.status === 'missing').map((c) => c.name))
  return (
    <Panel title="Controls" right={<span className="tabular text-2xs text-dim">{result.checks.length} checks</span>}>
      <div className="hidden grid-cols-[7rem_5.5rem_3rem_minmax(0,1fr)] gap-x-3 border-b border-line px-3 py-1.5 font-mono text-2xs text-dim sm:grid">
        <span>CONTROL</span>
        <span>STATUS</span>
        <span className="text-right">PTS</span>
        <span>RESULT</span>
      </div>
      <ul>
        {result.checks.map((c) => {
          const open = isOpen(c.name)
          const pts = result.score.components[c.name]
          const detail = c.records.length > 0 || c.findings.length > 0
          return (
            <li key={c.name} className="border-t border-line first:border-t-0">
              <button
                type="button"
                onClick={() => detail && toggle(c.name)}
                aria-expanded={detail ? open : undefined}
                className="grid w-full grid-cols-[1rem_minmax(0,1fr)_auto] items-baseline gap-x-2 px-3 py-1.5 text-left hover:bg-raised sm:grid-cols-[1rem_6rem_5.5rem_3rem_minmax(0,1fr)] sm:gap-x-3"
              >
                <span className="self-center">{detail && <Chevron open={open} />}</span>
                <span className="font-mono text-xs text-ink">{CONTROL_LABEL[c.name] ?? c.name}</span>
                <span className={cn('font-mono text-xs', TEXT[STATUS_TONE[c.status]])}>{STATUS_LABEL[c.status]}</span>
                <span className="tabular hidden text-right text-xs text-ink sm:block">{pts === undefined ? '—' : pts}</span>
                <span className="col-span-2 col-start-2 text-xs text-dim [overflow-wrap:anywhere] sm:col-span-1 sm:col-start-auto">{c.summary}</span>
              </button>
              {open && (
                <div className="space-y-2 border-t border-line bg-obsidian px-3 py-2 sm:pl-10">
                  {c.records.map((r, i) => (
                    <code key={i} className="block border border-line px-2 py-1 font-mono text-2xs text-ink [overflow-wrap:anywhere]">
                      {r}
                    </code>
                  ))}
                  {c.findings.map((f, i) => (
                    <div key={i} className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-3 text-xs">
                      <span className={cn('font-mono text-2xs uppercase leading-5', TEXT[SEVERITY_TONE[f.severity]])}>{f.severity}</span>
                      <div className="min-w-0">
                        <p className="text-ink">{f.title}</p>
                        {f.detail && <p className="text-dim [overflow-wrap:anywhere]">{f.detail}</p>}
                        {f.recommendation && (
                          <p className="mt-0.5 [overflow-wrap:anywhere]">
                            <span className="font-mono text-2xs text-secure">FIX </span>
                            <span className="text-ink">{f.recommendation}</span>
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </Panel>
  )
}

// -- Priority fix ------------------------------------------------------------------------------
export function FixPanel({ result }: { result: ScanResult }) {
  const fix = result.one_fix
  const titles = new Map(result.attack_matrix.map((p) => [p.id, p.title]))
  const allDefended = result.attack_matrix.every((p) => p.exposure === 'mitigated')
  return (
    <Panel title="Priority fix" right={fix && fix.score_gain > 0 ? <span className="tabular text-xs text-secure">+{fix.score_gain} pts</span> : undefined}>
      {fix ? (
        <div className="space-y-2 p-3">
          <p className="text-sm font-medium text-ink">{fix.title}</p>
          <p className="text-xs text-dim">{fix.action}</p>
          {fix.record && (
            <div className="border border-line bg-obsidian">
              <div className="flex items-center justify-between gap-2 border-b border-line px-2 py-1 font-mono text-2xs text-dim">
                <span className="min-w-0 truncate">
                  {fix.record_type} <span className="text-ink">{fix.host}</span>
                </span>
                <CopyButton text={fix.record} />
              </div>
              <pre className="whitespace-pre-wrap px-2 py-1.5 font-mono text-xs text-secure [overflow-wrap:anywhere]">{fix.record}</pre>
            </div>
          )}
          {fix.closes.length > 0 && (
            <p className="text-2xs text-dim">
              <span className="font-mono">CLOSES </span>
              {fix.closes.map((id) => titles.get(id) ?? id).join(' / ')}
            </p>
          )}
        </div>
      ) : (
        <p className="p-3 text-xs text-secure">
          {allDefended
            ? 'All seven attack paths are defended. Nothing to fix.'
            : 'Nothing urgent: every path is defended or could not be measured from here.'}
        </p>
      )}
      <div className="flex gap-2 border-t border-line px-3 py-2">
        {(['pdf', 'json'] as const).map((f) => (
          <a
            key={f}
            className="border border-line px-2 py-0.5 font-mono text-2xs text-dim hover:border-line-strong hover:text-ink"
            href={api.exportUrl(result.domain, f)}
          >
            {f.toUpperCase()}
          </a>
        ))}
      </div>
    </Panel>
  )
}
