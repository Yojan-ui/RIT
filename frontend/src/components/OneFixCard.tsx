import { ChevronDown, Crosshair, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { cn } from '@/lib/utils'
import { EFFORT_LABEL, VECTOR_ORDER } from '@/lib/meta'
import type { AttackPath, DnsRecord, Fix, ScanReport, VectorId } from '@/lib/types'
import { CopyButton, PanelHeader } from './primitives'

/** The record as a BIND zone-file line, lightly syntax-coloured, in a dark code block. */
function ZoneRecord({ record }: { record: DnsRecord }) {
  const host = record.host.endsWith('.') ? record.host : `${record.host}.`
  const quoted = record.type === 'TXT' ? `"${record.value}"` : record.value
  const line = `${host} 3600 IN ${record.type} ${quoted}`
  return (
    <div className="overflow-hidden rounded-md border border-ok/20 bg-black/50">
      <div className="flex items-center justify-between gap-2 border-b border-white/[0.06] px-3 py-1.5">
        <span className="font-mono text-[9.5px] tracking-[0.14em] text-slate-500">ZONE FILE · {record.type}</span>
        <div className="flex gap-1.5">
          <CopyButton value={record.value} label="record value" text="VALUE" />
          <CopyButton value={line} label="zone file line" text="LINE" />
        </div>
      </div>
      <pre className="px-3 py-2.5 font-mono text-[11.5px] leading-relaxed break-all whitespace-pre-wrap">
        <span className="text-slate-100">{host}</span>
        <span className="text-slate-600"> 3600 IN </span>
        <span className="text-ok">{record.type}</span> <span className="text-warn/90">{quoted}</span>
      </pre>
    </div>
  )
}

function Caveat({ text }: { text: string }) {
  const [first, ...rest] = text.split('\n')
  return (
    <li className="flex gap-2">
      <span className="font-mono text-warn" aria-hidden>
        !
      </span>
      <div className="min-w-0">
        <p>{first}</p>
        {rest.join('\n').trim() && (
          <pre className="mt-1.5 rounded-sm border border-line bg-obsidian p-2 font-mono text-[11px] whitespace-pre-wrap break-all text-slate-300">
            {rest.join('\n').trim()}
          </pre>
        )}
      </div>
    </li>
  )
}

export function OneFixCard({
  report,
  onAim,
}: {
  report: ScanReport
  /** Point the 3D camera at the vector this fix changes (null to release). */
  onAim?: (id: VectorId | null) => void
}) {
  const fix = report.one_fix
  const paths = new Map(report.attack_paths.map((p) => [p.id, p]))

  if (!fix) {
    return (
      <section className="panel flex h-full flex-col" aria-labelledby="one-fix-heading">
        <PanelHeader label="The one fix" />
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
          <ShieldCheck className="size-8 text-ok" aria-hidden />
          <h3 id="one-fix-heading" className="font-mono text-sm font-medium tracking-wide text-ok">
            NO DNS CHANGE REQUIRED
          </h3>
          <p className="max-w-sm text-slate-400">
            Every attack path a DNS record can close is already closed for {report.domain}.
          </p>
        </div>
      </section>
    )
  }

  const gain = fix.score_after - fix.score_before
  const target = VECTOR_ORDER.find((v) => v === fix.id)
  const aimHandlers = target && onAim
    ? {
        onMouseEnter: () => onAim(target),
        onMouseLeave: () => onAim(null),
        onFocus: () => onAim(target),
        onBlur: () => onAim(null),
      }
    : {}
  return (
    <section
      className="panel flex h-full flex-col border-ok/30 transition-colors hover:border-ok/60"
      aria-labelledby="one-fix-heading"
      {...aimHandlers}
    >
      <PanelHeader label="The one fix">
        <span className="font-mono text-[10px] tracking-wider text-slate-500">{EFFORT_LABEL[fix.effort].toUpperCase()}</span>
      </PanelHeader>

      <div className="flex flex-col gap-4 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 id="one-fix-heading" className="flex items-center gap-2 text-lg font-semibold text-slate-100">
              <Crosshair className="size-4 shrink-0 text-ok" aria-hidden />
              {fix.title}
            </h3>
            <p className="mt-1 text-slate-400">{fix.rationale}</p>
          </div>
          <div className="text-right font-mono" aria-label={`Score rises from ${fix.score_before} to ${fix.score_after}`}>
            <p className="eyebrow">Projected</p>
            <p className="mt-1 text-lg tabular-nums">
              <span className="text-slate-500">{fix.score_before}</span>
              <span className="mx-1.5 text-slate-600">→</span>
              <span className="font-bold text-ok">{fix.score_after}</span>
              <span className="ml-2 text-xs text-ok">+{gain}</span>
            </p>
          </div>
        </div>

        <ZoneRecord record={fix.record} />

        {fix.closes.length > 0 && (
          <div>
            <p className="eyebrow mb-2">Closes</p>
            <ul className="flex flex-wrap gap-1.5">
              {fix.closes.map((id) => (
                <li
                  key={id}
                  className="inline-flex items-center gap-1.5 rounded-sm border border-crit/40 px-2 py-1 font-mono text-[11px] text-slate-300"
                >
                  <span className="line-through decoration-crit">{paths.get(id)?.title ?? id}</span>
                  <span className="text-ok" aria-label="closed">
                    ✓
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {fix.caveats.length > 0 && (
          <ul className="space-y-2 border-l border-warn/40 pl-3 text-[12.5px] text-slate-400">
            {fix.caveats.map((c) => (
              <Caveat key={c} text={c} />
            ))}
          </ul>
        )}
      </div>

      {report.other_fixes.length > 0 && <OtherFixes fixes={report.other_fixes} paths={paths} />}
    </section>
  )
}

function OtherFixes({ fixes, paths }: { fixes: Fix[]; paths: Map<string, AttackPath> }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="mt-auto border-t border-line">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between px-4 py-2 text-left hover:bg-raised"
      >
        <span className="eyebrow">Next best fixes ({fixes.length})</span>
        <ChevronDown className={cn('size-3.5 text-slate-500 transition-transform', open && 'rotate-180')} aria-hidden />
      </button>
      {open && (
        <ol className="divide-y divide-line border-t border-line">
          {fixes.map((f, i) => (
            <li key={f.id} className="grid grid-cols-[1.5rem_minmax(0,1fr)_auto] gap-2 px-4 py-2.5">
              <span className="font-mono text-slate-600">{i + 2}.</span>
              <div className="min-w-0">
                <p className="text-slate-200">{f.title}</p>
                <p className="truncate font-mono text-[11px] text-slate-500" title={f.record.value}>
                  {f.record.host}
                </p>
                {f.closes.length > 0 && (
                  <p className="mt-0.5 text-[11px] text-slate-500">
                    closes {f.closes.map((id) => paths.get(id)?.title.toLowerCase() ?? id).join(', ')}
                  </p>
                )}
              </div>
              <span className="font-mono text-xs text-ok tabular-nums">+{f.score_after - f.score_before}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
