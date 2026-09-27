import { cn } from '@/lib/utils'
import { PATH_VECTORS, STATUS_TONE, VECTOR_ORDER } from '@/lib/meta'
import type { ScanReport, VectorId } from '@/lib/types'
import { PanelHeader, StatusPill } from './primitives'

/**
 * Compact matrix of the 7 checks. Each row shows the check's status and how
 * many currently open attack paths it gates. Hover aims the 3D camera; click
 * opens the full vector card below.
 */
export function CheckMatrix({
  report,
  onAim,
  onSelect,
}: {
  report: ScanReport
  onAim?: (id: VectorId | null) => void
  onSelect?: (id: VectorId) => void
}) {
  const openPaths = report.attack_paths.filter((a) => a.state === 'open')
  const rows = VECTOR_ORDER.flatMap((id) => {
    const check = report.checks.find((c) => c.id === id)
    if (!check) return []
    const gates = openPaths.filter((a) => PATH_VECTORS[a.id]?.includes(id)).length
    return [{ check, gates }]
  })

  return (
    <section className="panel flex h-full min-h-0 flex-col" aria-labelledby="check-matrix-heading">
      <PanelHeader label="Attack path matrix">
        <span id="check-matrix-heading" className="font-mono text-[10px] tracking-wider text-slate-500">
          7 VECTORS
        </span>
      </PanelHeader>
      <ul className="min-h-0 flex-1 divide-y divide-white/[0.05] overflow-y-auto">
        {rows.map(({ check, gates }) => (
          <li key={check.id}>
            <button
              type="button"
              onMouseEnter={() => onAim?.(check.id)}
              onMouseLeave={() => onAim?.(null)}
              onFocus={() => onAim?.(check.id)}
              onBlur={() => onAim?.(null)}
              onClick={() => onSelect?.(check.id)}
              className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 px-4 py-2 text-left transition-colors hover:bg-white/[0.03] focus-visible:bg-white/[0.03]"
            >
              <span className="min-w-0">
                <span className="flex items-baseline gap-2">
                  <span className="truncate text-[12px] font-medium text-slate-100">{check.name}</span>
                  <span className="font-mono text-[10px] text-slate-600 tabular-nums">
                    {check.applicable ? `${check.points.toFixed(1)}/${check.weight}` : '—'}
                  </span>
                </span>
                <span className="mt-1 flex items-center gap-2">
                  <span className="h-0.5 w-16 overflow-hidden rounded-full bg-white/[0.06]" aria-hidden>
                    {check.applicable && (
                      <span
                        className={cn('block h-full', STATUS_TONE[check.status].bg)}
                        style={{ width: `${check.score * 100}%` }}
                      />
                    )}
                  </span>
                  <span className={cn('font-mono text-[10px]', gates ? 'text-crit/90' : 'text-slate-600')}>
                    {gates ? `gates ${gates} open path${gates > 1 ? 's' : ''}` : 'no open paths'}
                  </span>
                </span>
              </span>
              <StatusPill status={check.status} />
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
