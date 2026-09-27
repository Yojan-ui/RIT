import { ShieldCheck } from 'lucide-react'
import { useMemo } from 'react'
import { cn } from '@/lib/utils'
import { STATUS_TONE } from '@/lib/meta'
import { buildRemediation, type Artifact, type Remedy } from '@/lib/remediation'
import type { ScanReport, VectorId } from '@/lib/types'
import { CopyButton, PanelHeader } from './primitives'

const KIND_LABEL: Record<Artifact['kind'], string> = { dns: 'DNS', file: 'FILE', config: 'CONFIG' }

function ArtifactBlock({ artifact }: { artifact: Artifact }) {
  return (
    <div className="border border-white/10">
      <div className="flex items-center justify-between gap-3 border-b border-white/10 px-2.5 py-1">
        <p className="min-w-0 truncate font-mono text-[10px] tracking-wider text-slate-500">
          <span className="text-slate-300">{KIND_LABEL[artifact.kind]}</span> · {artifact.label}
          {artifact.kind !== 'dns' && <span className="text-slate-600"> → {artifact.target}</span>}
        </p>
        <CopyButton value={artifact.value} label={artifact.label} />
      </div>
      <pre className="overflow-x-auto bg-black px-2.5 py-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-emerald-400">
        {artifact.kind === 'config' && artifact.target === 'shell' && <span className="text-neutral-600">$ </span>}
        {artifact.value}
      </pre>
    </div>
  )
}

function RemedyItem({
  remedy,
  index,
  onAim,
}: {
  remedy: Remedy
  index: number
  onAim?: (id: VectorId | null) => void
}) {
  const tone = STATUS_TONE[remedy.status]
  const gain = remedy.fix ? remedy.fix.score_after - remedy.fix.score_before : 0
  return (
    <details
      open={index < 2}
      className={cn(
        'group border-b border-white/10 last:border-b-0',
        remedy.status === 'fail' && 'shadow-[inset_2px_0_0_var(--color-crit)]',
      )}
      onMouseEnter={() => onAim?.(remedy.id)}
      onMouseLeave={() => onAim?.(null)}
    >
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 hover:bg-raised [&::-webkit-details-marker]:hidden">
        <span className="font-mono text-[10px] text-slate-600 tabular-nums">{String(index + 1).padStart(2, '0')}</span>
        <span className={cn('w-10 font-mono text-[10px] font-bold tracking-wider', tone.text)}>{tone.label}</span>
        <span className="w-20 font-mono text-[11px] font-bold tracking-wider text-slate-100">
          {remedy.name.split(' ')[0]}
        </span>
        <span className="min-w-0 flex-1 text-[12.5px] text-slate-200">{remedy.headline}</span>
        <span className="flex items-center gap-2 font-mono text-[10px] tracking-wider">
          {remedy.isOneFix && <span className="border border-ok/50 px-1.5 py-px text-ok">ONE FIX</span>}
          {remedy.serverSide && <span className="border border-warn/40 px-1.5 py-px text-warn">SERVER</span>}
          {gain > 0 && <span className="text-ok tabular-nums">+{gain} PTS</span>}
          <span className={remedy.closes.length ? 'text-crit' : 'text-slate-600'}>
            {remedy.closes.length} OPEN PATH{remedy.closes.length === 1 ? '' : 'S'}
          </span>
          <span className="text-slate-500 transition-transform group-open:rotate-90" aria-hidden>
            ›
          </span>
        </span>
      </summary>

      <div className="grid gap-4 px-4 pt-1 pb-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        <div className="space-y-3">
          <section>
            <h4 className="eyebrow mb-1.5">How to fix</h4>
            <ol className="space-y-1.5 text-[12.5px] text-slate-300">
              {remedy.steps.map((step, i) => (
                <li key={step} className="flex gap-2.5">
                  <span className="shrink-0 font-mono text-[10.5px] text-slate-600 tabular-nums">{i + 1}.</span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
          </section>
          {remedy.closes.length > 0 && (
            <section>
              <h4 className="eyebrow mb-1.5">Closes</h4>
              <ul className="space-y-0.5 text-[12px] text-slate-400">
                {remedy.closes.map((p) => (
                  <li key={p.id} className="flex gap-2">
                    <span className="font-mono text-crit" aria-hidden>
                      ×
                    </span>
                    {p.title}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {remedy.fix && remedy.fix.caveats.length > 0 && (
            <section>
              <h4 className="eyebrow mb-1.5">Before you publish</h4>
              <ul className="space-y-1 text-[12px] text-warn">
                {/* The MTA-STS caveat embeds the policy file, already shown as an artifact. */}
                {remedy.fix.caveats.map((c) => (
                  <li key={c}>{c.split('\n')[0]}</li>
                ))}
              </ul>
            </section>
          )}
        </div>
        <div className="space-y-2">
          <h4 className="eyebrow">Exact records</h4>
          {remedy.artifacts.map((a) => (
            <ArtifactBlock key={`${a.label}-${a.value}`} artifact={a} />
          ))}
        </div>
      </div>
    </details>
  )
}

/**
 * HOW TO FIX: every FAIL/WARN vector with ordered steps and the exact DNS
 * records, hosted files or server config to deploy. Hover aims the lattice.
 */
export function RemediationPanel({ report, onAim }: { report: ScanReport; onAim?: (id: VectorId | null) => void }) {
  const remedies = useMemo(() => buildRemediation(report), [report])
  const fails = remedies.filter((r) => r.status === 'fail').length

  return (
    <section className="panel" aria-labelledby="remediation-heading">
      <PanelHeader label="Remediation steps · how to fix">
        <span id="remediation-heading" className="font-mono text-[10px] tracking-wider">
          <span className={fails ? 'text-crit' : 'text-ok'}>{fails} FAIL</span>
          <span className="text-slate-600"> · </span>
          <span className="text-warn">{remedies.length - fails} WARN</span>
        </span>
      </PanelHeader>
      {remedies.length ? (
        remedies.map((r, i) => <RemedyItem key={`${report.domain}-${r.id}`} remedy={r} index={i} onAim={onAim} />)
      ) : (
        <p className="flex items-center gap-2 px-4 py-4 font-mono text-[11px] tracking-wider text-ok">
          <ShieldCheck className="size-4" aria-hidden />
          NOTHING TO FIX: NO VECTOR IS FAILING OR WARNING FOR {report.domain.toUpperCase()}
        </p>
      )}
    </section>
  )
}
