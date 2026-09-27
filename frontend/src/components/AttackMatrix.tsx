import { cn } from '@/lib/utils'
import { PATH_TONE, PATH_VECTORS, STATUS_TONE, VECTOR_ABBR, VECTOR_ORDER } from '@/lib/meta'
import type { AttackPath, CheckResult, PathState, ScanReport, Status, VectorId } from '@/lib/types'
import { Lamp, PanelHeader, SeverityPips } from './primitives'

const STATE_RANK: Record<PathState, number> = { open: 0, closed: 1, not_applicable: 2 }
const BROKEN_RANK: Record<Status, number> = { fail: 0, warn: 1, error: 2, info: 3, pass: 4 }

/** The node to fly to for a path: its most broken vector, primary vector on ties. */
function aimFor(path: AttackPath, checks: Map<string, CheckResult>): VectorId | null {
  const candidates = (PATH_VECTORS[path.id] ?? []).filter((v) => checks.has(v))
  candidates.sort((a, b) => BROKEN_RANK[checks.get(a)!.status] - BROKEN_RANK[checks.get(b)!.status])
  return candidates[0] ?? null
}

function FixCell({ path, fixedByOneFix }: { path: AttackPath; fixedByOneFix: boolean }) {
  if (path.state !== 'open') return <span className="text-slate-700">—</span>
  if (fixedByOneFix)
    return <span className="rounded-sm border border-ok/50 px-1.5 py-0.5 text-[10px] whitespace-nowrap text-ok">ONE FIX</span>
  if (!path.dns_fixable)
    return <span className="rounded-sm border border-warn/40 px-1.5 py-0.5 text-[10px] text-warn">SERVER</span>
  return <span className="text-[10px] text-slate-500">DNS</span>
}

export function AttackMatrix({
  report,
  onAim,
}: {
  report: ScanReport
  /** Point the 3D camera at the node behind a row (null to release). */
  onAim?: (id: VectorId | null) => void
}) {
  const checks = new Map<string, CheckResult>(report.checks.map((c) => [c.id, c]))
  const oneFix = new Set(report.one_fix?.closes ?? [])
  const rows = [...report.attack_paths].sort(
    (a, b) => STATE_RANK[a.state] - STATE_RANK[b.state] || b.severity - a.severity,
  )
  const open = rows.filter((r) => r.state === 'open').length

  return (
    <section className="panel" aria-labelledby="matrix-heading">
      <PanelHeader label="Attack paths · detail">
        <span id="matrix-heading" className="font-mono text-[10px] tracking-wider">
          <span className={open ? 'text-crit' : 'text-ok'}>{open} OPEN</span>
          <span className="text-slate-600"> / {rows.length}</span>
        </span>
      </PanelHeader>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] border-collapse text-left">
          <thead>
            <tr className="border-b border-line font-mono text-[10px] tracking-wider text-slate-500">
              <th scope="col" className="w-16 px-4 py-2 font-medium">SEV</th>
              <th scope="col" className="px-2 py-2 font-medium">ATTACK PATH</th>
              {VECTOR_ORDER.map((v) => (
                <th key={v} scope="col" className="w-12 px-1 py-2 text-center font-medium">
                  {VECTOR_ABBR[v]}
                </th>
              ))}
              <th scope="col" className="w-24 px-2 py-2 font-medium">STATE</th>
              <th scope="col" className="w-24 px-4 py-2 text-right font-medium">FIX</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((path) => {
              const tone = PATH_TONE[path.state]
              const governed = new Set(PATH_VECTORS[path.id] ?? [])
              const muted = path.state === 'not_applicable'
              return (
                <tr
                  key={path.id}
                  tabIndex={onAim ? 0 : undefined}
                  onMouseEnter={() => onAim?.(aimFor(path, checks))}
                  onMouseLeave={() => onAim?.(null)}
                  onFocus={() => onAim?.(aimFor(path, checks))}
                  onBlur={() => onAim?.(null)}
                  className={cn(
                    'border-b border-line last:border-b-0 hover:bg-raised focus-visible:bg-raised',
                    path.state === 'open' && 'shadow-[inset_2px_0_0_var(--color-crit)]',
                    muted && 'opacity-50',
                  )}
                >
                  <td className="px-4 py-2.5 align-top">
                    <SeverityPips severity={path.severity} />
                  </td>
                  <td className="px-2 py-2.5 align-top">
                    <p className={cn('font-medium', path.state === 'open' ? 'text-slate-100' : 'text-slate-300')}>
                      {path.title}
                      {/* STATE column sits off-screen on phones; repeat it inline */}
                      <span className={cn('ml-2 font-mono text-[10px] md:hidden', tone.text)}>{tone.label}</span>
                    </p>
                    <p className="mt-0.5 max-w-xl text-[12px] leading-snug text-slate-500">
                      {path.state === 'open' ? path.remedy : path.description}
                    </p>
                  </td>
                  {VECTOR_ORDER.map((v) => {
                    const check = checks.get(v)
                    if (!governed.has(v) || !check)
                      return (
                        <td key={v} className="px-1 py-2.5 text-center align-top">
                          <span className="inline-block size-1 rounded-full bg-line-strong" aria-hidden />
                        </td>
                      )
                    const t = STATUS_TONE[check.status]
                    return (
                      <td key={v} className="px-1 py-2.5 text-center align-top">
                        <span
                          className={cn(
                            'inline-grid h-5 w-9 place-items-center rounded-sm border font-mono text-[9px]',
                            t.border,
                            t.text,
                          )}
                          title={`${check.name}: ${t.label}`}
                        >
                          {t.label === 'UNMEASURED' ? '??' : t.label}
                        </span>
                      </td>
                    )
                  })}
                  <td className="px-2 py-2.5 align-top">
                    <span className={cn('inline-flex items-center gap-1.5 font-mono text-[11px]', tone.text)}>
                      <Lamp className={tone.bg} pulse={path.state === 'open'} />
                      {tone.label}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right align-top font-mono">
                    <FixCell path={path} fixedByOneFix={oneFix.has(path.id)} />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}
