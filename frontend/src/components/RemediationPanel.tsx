import { ChevronDown, ShieldCheck } from 'lucide-react'
import { useMemo } from 'react'
import { EFFORT_INFO } from '@/lib/meta'
import { cn } from '@/lib/utils'
import { buildRemediation, type Artifact, type Remedy } from '@/lib/remediation'
import type { ScanReport, VectorId } from '@/lib/types'
import { CopyButton, SectionHeader, StatusBadge } from './primitives'

const KIND_LABEL: Record<Artifact['kind'], string> = { dns: 'DNS record', file: 'File', config: 'Server config' }

function ArtifactBlock({ artifact }: { artifact: Artifact }) {
  return (
    <div className="overflow-hidden border border-line">
      <div className="flex items-center justify-between gap-3 border-b border-line bg-surface px-3 py-2">
        <p className="min-w-0 truncate text-[11.5px] text-ink-2">
          <span className="font-medium text-ink">{KIND_LABEL[artifact.kind]}</span> {artifact.label}
          {artifact.kind !== 'dns' && <span className="text-ink-3"> at {artifact.target}</span>}
        </p>
        <CopyButton value={artifact.value} label={artifact.label} />
      </div>
      <pre className="overflow-x-auto bg-sunken px-3 py-2.5 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap text-ink">
        {artifact.value}
      </pre>
    </div>
  )
}

function RemedyItem({
  remedy,
  index,
  planIndex,
  onAim,
}: {
  remedy: Remedy
  index: number
  planIndex: number
  onAim?: (id: VectorId | null) => void
}) {
  const effort = EFFORT_INFO[remedy.effort]
  const after = remedy.step?.statuses_after[remedy.id]
  const gain = remedy.fix
    ? remedy.fix.score_after - remedy.fix.score_before
    : remedy.step
      ? remedy.step.score_after - remedy.step.score_before
      : 0
  return (
    <details
      open={index === 0}
      className="group"
      onMouseEnter={() => onAim?.(remedy.id)}
      onMouseLeave={() => onAim?.(null)}
    >
      <summary className="grid cursor-pointer list-none grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4 px-4 py-3 hover:bg-sunken sm:grid-cols-[6rem_minmax(0,1fr)_auto] [&::-webkit-details-marker]:hidden">
        <span className="hidden pt-0.5 sm:block">
          <StatusBadge status={remedy.status} />
        </span>
        <span className="min-w-0">
          <span className="block text-[13px] font-bold text-ink">{remedy.headline}</span>
          <span className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-ink-2">
            <span>{remedy.name}</span>
            <span>{effort.time}</span>
            {gain > 0 && <span className="text-ok">+{gain} points</span>}
            {remedy.isOneFix && <span className="font-medium text-accent">Start here</span>}
            {remedy.serverSide && <span className="text-warn">Server change</span>}
          </span>
        </span>
        <ChevronDown className="mt-1 size-4.5 text-ink-3 transition-transform group-open:rotate-180" aria-hidden />
      </summary>

      <div className="grid gap-5 px-4 pb-4 sm:pl-[8rem] lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        <div className="space-y-4">
          <p className="border-l border-ink pl-3 text-[13px] text-ink">{remedy.impact}</p>
          <section>
            <h4 className="subhead mb-2">Steps</h4>
            <ol className="list-decimal space-y-2 pl-5 text-[12.5px] text-ink-2 marker:text-ink-3">
              {remedy.steps.map((step) => (
                <li key={step} className="pl-1">
                  {step}
                </li>
              ))}
            </ol>
          </section>
          <section className="grid grid-cols-2 gap-4 text-[12.5px]">
            <div>
              <p className="mb-1.5 text-[10.5px] font-bold tracking-[0.12em] text-ink-3 uppercase">Today</p>
              <StatusBadge status={remedy.status} />
            </div>
            <div>
              <p className="mb-1.5 text-[10.5px] font-bold tracking-[0.12em] text-ink-3 uppercase">After this fix</p>
              {after ? <StatusBadge status={after} /> : <span className="text-ink-3">Manual, not simulated</span>}
            </div>
            <p className="col-span-2 text-ink-2">
              {remedy.fix
                ? `Done on its own, the score goes from ${remedy.fix.score_before} to ${remedy.fix.score_after}.`
                : remedy.step
                  ? `As step ${planIndex + 1} of the plan, the score goes from ${remedy.step.score_before} to ${remedy.step.score_after}.`
                  : null}{' '}
              Owner: {effort.who}. {effort.note}
            </p>
            {remedy.id === 'dmarc' && remedy.step && remedy.fix?.record.value.includes('p=quarantine') && (
              <p className="col-span-2 text-warn">
                Then wait for 2 to 4 weeks of clean reports before tightening to p=reject.
              </p>
            )}
          </section>
          {remedy.closes.length > 0 && (
            <section>
              <h4 className="subhead mb-2">Attack paths this closes</h4>
              <ul className="space-y-1 text-[12.5px] text-ink-2">
                {remedy.closes.map((p) => (
                  <li key={p.id}>{p.title}</li>
                ))}
              </ul>
            </section>
          )}
          {remedy.fix && remedy.fix.caveats.length > 0 && (
            <section>
              <h4 className="subhead mb-2">Before you publish</h4>
              <ul className="space-y-1.5 text-[12.5px] text-warn">
                {/* The MTA-STS caveat embeds the policy file, already shown as an artifact. */}
                {remedy.fix.caveats.map((c) => (
                  <li key={c}>{c.split('\n')[0]}</li>
                ))}
              </ul>
            </section>
          )}
        </div>
        <div className="space-y-3">
          <h4 className="subhead">What to publish</h4>
          {remedy.artifacts.map((a) => (
            <ArtifactBlock key={`${a.label}-${a.value}`} artifact={a} />
          ))}
          <div className="pt-2">
            <p className="mb-1.5 text-[10.5px] font-bold tracking-[0.12em] text-ink-3 uppercase">Published today</p>
            {remedy.current.length ? (
              remedy.current.map((r) => (
                <pre key={r} className="font-mono text-[11px] leading-relaxed break-all whitespace-pre-wrap text-ink-3">
                  {r}
                </pre>
              ))
            ) : (
              <p className="text-[12px] text-ink-3">Nothing</p>
            )}
          </div>
        </div>
      </div>
    </details>
  )
}

/**
 * Every failing or weak protection with ordered steps and the exact DNS
 * records, hosted files or server config to deploy. Hover aims the 3D view.
 */
export function RemediationPanel({ report, onAim }: { report: ScanReport; onAim?: (id: VectorId | null) => void }) {
  const remedies = useMemo(() => buildRemediation(report), [report])

  return (
    <section aria-labelledby="remediation-heading">
      <SectionHeader
        id="remediation-heading"
        title="How to fix each one"
        lede="The exact records and settings to hand to whoever manages your DNS and mail server."
      />
      {remedies.length ? (
        <div className={cn('card divide-y divide-line overflow-hidden')}>
          {remedies.map((r, i) => (
            <RemedyItem
              key={`${report.domain}-${r.id}`}
              remedy={r}
              index={i}
              planIndex={r.step ? (report.fix_plan?.steps.indexOf(r.step) ?? -1) : -1}
              onAim={onAim}
            />
          ))}
        </div>
      ) : (
        <p className="card flex items-center gap-3 px-4 py-3 text-[13px] text-ok">
          <ShieldCheck className="size-5" aria-hidden />
          Nothing to fix. No protection is failing or weak for {report.domain}.
        </p>
      )}
    </section>
  )
}
