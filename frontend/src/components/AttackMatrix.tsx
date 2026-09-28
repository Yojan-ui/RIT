import { cn } from '@/lib/utils'
import { PATH_TONE, PATH_VECTORS, VECTOR_ABBR, VECTOR_ORDER } from '@/lib/meta'
import type { AttackPath, CheckResult, PathState, ScanReport, Status, VectorId } from '@/lib/types'
import { SectionHeader, SeverityPips, StatusBadge } from './primitives'

const STATE_RANK: Record<PathState, number> = { open: 0, closed: 1, not_applicable: 2 }
const BROKEN_RANK: Record<Status, number> = { fail: 0, warn: 1, error: 2, info: 3, pass: 4 }

/** The node to fly to for a path: its most broken vector, primary vector on ties. */
function aimFor(path: AttackPath, checks: Map<string, CheckResult>): VectorId | null {
  const candidates = (PATH_VECTORS[path.id] ?? []).filter((v) => checks.has(v))
  candidates.sort((a, b) => BROKEN_RANK[checks.get(a)!.status] - BROKEN_RANK[checks.get(b)!.status])
  return candidates[0] ?? null
}

function fixLabel(path: AttackPath, fixedByOneFix: boolean): { text: string; className: string } | null {
  if (path.state !== 'open') return null
  if (fixedByOneFix) return { text: 'Start-here fix', className: 'text-accent font-medium' }
  if (!path.dns_fixable) return { text: 'Server change', className: 'text-warn' }
  return { text: 'DNS change', className: 'text-ink-2' }
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
    <section aria-labelledby="paths-heading">
      <SectionHeader
        id="paths-heading"
        title="How an attacker would get in"
        lede={`${open} of ${rows.length} known attack paths are open. Each column shows the protection that blocks it.`}
      />

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[820px] border-collapse text-left text-[12.5px]">
          <thead>
            <tr className="border-b border-line text-[11.5px] text-ink-3">
              <th scope="col" className="px-4 py-3 font-medium">
                Attack path
              </th>
              <th scope="col" className="w-24 px-2 py-3 font-medium">
                Severity
              </th>
              {VECTOR_ORDER.map((v) => (
                <th key={v} scope="col" className="w-14 px-1 py-3 text-center font-medium">
                  {VECTOR_ABBR[v]}
                </th>
              ))}
              <th scope="col" className="w-36 px-4 py-3 font-medium">
                Status
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((path) => {
              const tone = PATH_TONE[path.state]
              const governed = new Set(PATH_VECTORS[path.id] ?? [])
              const fix = fixLabel(path, oneFix.has(path.id))
              return (
                <tr
                  key={path.id}
                  tabIndex={onAim ? 0 : undefined}
                  onMouseEnter={() => onAim?.(aimFor(path, checks))}
                  onMouseLeave={() => onAim?.(null)}
                  onFocus={() => onAim?.(aimFor(path, checks))}
                  onBlur={() => onAim?.(null)}
                  className={cn(
                    'align-top transition-colors hover:bg-sunken focus-visible:bg-sunken',
                    path.state === 'not_applicable' && 'opacity-55',
                  )}
                >
                  <td className="px-4 py-2.5">
                    <p className="font-medium text-ink">{path.title}</p>
                    <p className="mt-1 max-w-[56ch] text-[12px] leading-snug text-ink-2">
                      {path.state === 'open' ? path.remedy : path.description}
                    </p>
                  </td>
                  <td className="px-2 py-2.5 pt-5">
                    <SeverityPips severity={path.severity} />
                  </td>
                  {VECTOR_ORDER.map((v) => {
                    const check = checks.get(v)
                    return (
                      <td key={v} className="px-1 py-2.5 text-center">
                        {governed.has(v) && check ? (
                          <StatusBadge status={check.status} compact />
                        ) : (
                          <span className="inline-block size-1 bg-line-strong" aria-hidden />
                        )}
                      </td>
                    )
                  })}
                  <td className="px-4 py-2.5">
                    <p className={cn('font-medium', tone.text)}>{tone.label}</p>
                    {fix && <p className={cn('mt-0.5 text-[11.5px]', fix.className)}>{fix.text}</p>}
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
