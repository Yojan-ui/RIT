import { Suspense, lazy } from 'react'
import { Telemetry } from '@/components/Telemetry'
import { Card } from '@/components/ui/card'
import { Spotlight } from '@/components/ui/spotlight'
import { CopyButton, StatusBadge, StatusLegend } from '@/components/primitives'
import { useTheme, type Theme } from '@/hooks/useTheme'
import { exportUrl } from '@/lib/api'
import { businessRisk } from '@/lib/risk'
import { cn } from '@/lib/utils'
import type { CheckResult, ScanReport, VectorId } from '@/lib/types'

// three.js is ~1 MB: split into its own chunk so the data panels render first.
const DefenseLattice = lazy(() => import('@/components/lattice/DefenseLattice'))

// Matrix order and labels, per the terminal spec.
const MATRIX: { id: VectorId; label: string }[] = [
  { id: 'spf', label: 'SPF' },
  { id: 'dkim', label: 'DKIM' },
  { id: 'dmarc', label: 'DMARC' },
  { id: 'mx', label: 'MX' },
  { id: 'mta_sts', label: 'MTA-STS' },
  { id: 'tls_rpt', label: 'TLS-RPT' },
  { id: 'starttls', label: 'STARTTLS' },
]

const scoreTone = (score: number) =>
  score >= 80 ? 'text-emerald-500' : score >= 50 ? 'text-amber-500' : 'text-red-500'

function Label({ children, className }: { children: React.ReactNode; className?: string }) {
  return <p className={cn('text-[10px] tracking-[0.22em] text-neutral-500 uppercase', className)}>{children}</p>
}

function MatrixRow({
  label,
  check,
  onSelect,
  onAim,
}: {
  label: string
  check?: CheckResult
  onSelect?: () => void
  onAim?: (on: boolean) => void
}) {
  const risk = check ? businessRisk(check) : null
  // The prefix carries the severity in words, coloured to match the badge.
  const prefix = !risk
    ? null
    : risk.kind === 'ok'
      ? { text: 'Protected:', className: 'text-emerald-500' }
      : risk.kind === 'neutral'
        ? { text: 'Note:', className: 'text-neutral-500' }
        : { text: 'Risk:', className: check?.status === 'fail' ? 'text-red-500' : 'text-amber-500' }
  return (
    <button
      type="button"
      onClick={onSelect}
      onMouseEnter={() => onAim?.(true)}
      onMouseLeave={() => onAim?.(false)}
      onFocus={() => onAim?.(true)}
      onBlur={() => onAim?.(false)}
      disabled={!check}
      title={check?.summary}
      className="grid w-full grid-cols-[4.25rem_4.5rem_minmax(0,1fr)] items-start gap-x-3 border-b border-white/10 px-3 py-2 text-left text-[12px] transition-colors last:border-b-0 hover:bg-white/[0.03] focus-visible:bg-white/[0.04]"
    >
      <StatusBadge status={check?.status ?? 'error'} />
      <span className="pt-0.5 font-bold tracking-wider text-white">{label}</span>
      <span className="min-w-0">
        <span className="block truncate pt-0.5 text-[10.5px] text-neutral-600">{check?.summary ?? '—'}</span>
        {risk && prefix && (
          <span className="mt-0.5 block text-[11px] leading-snug text-neutral-300">
            <span className={cn('font-bold', prefix.className)}>{prefix.text}</span> {risk.text}
          </span>
        )}
      </span>
    </button>
  )
}

function OneFixPanel({ report }: { report: ScanReport }) {
  const fix = report.one_fix
  const cleartext = report.attack_paths.find((a) => a.id === 'cleartext_delivery' && a.state === 'open')
  const host = fix ? (fix.record.host.endsWith('.') ? fix.record.host : `${fix.record.host}.`) : ''
  const value = fix ? (fix.record.type === 'TXT' ? `"${fix.record.value}"` : fix.record.value) : ''
  const zoneLine = fix ? `${host} 3600 IN ${fix.record.type} ${value}` : ''

  return (
    <div className="border border-white/10 bg-white/[0.03] p-4 backdrop-blur-md">
      {fix ? (
        <>
          <div className="flex items-start justify-between gap-3">
            <p className="text-[11px] leading-snug font-bold tracking-[0.12em] text-red-500 uppercase">
              High priority: <span className="text-white">{fix.title}</span>
            </p>
            <span className="shrink-0 text-[11px] text-emerald-500 tabular-nums">
              {fix.score_before}→{fix.score_after}
            </span>
          </div>
          <div className="mt-3 flex items-start gap-2 border border-white/10 bg-black p-2.5">
            <code className="min-w-0 flex-1 text-[10.5px] leading-relaxed break-all text-emerald-400">
              <span className="text-neutral-600">$ </span>
              {zoneLine}
            </code>
            <CopyButton value={zoneLine} label="DNS record" />
          </div>
        </>
      ) : (
        <p className="text-[11px] font-bold tracking-[0.12em] text-emerald-500 uppercase">
          No DNS change required: every DNS-closable path is closed
        </p>
      )}
      {cleartext && (
        <p className="mt-2 text-[10.5px] text-amber-500">
          <span className="font-bold">SERVER-SIDE:</span> Enforce STARTTLS in SMTP config (not a DNS change)
        </p>
      )}
    </div>
  )
}

/**
 * The main SecureMailScope terminal: data and metrics on the left, an
 * data-bound Defense Lattice and telemetry on the right. All values come from the scan report.
 */
export function SecureMailDashboard({
  report,
  loading = false,
  pending,
  flyTo = null,
  onAim,
  onSelectVector,
}: {
  report: ScanReport
  loading?: boolean
  /** Target of an in-flight scan, echoed into the telemetry feed. */
  pending?: string
  /** Vector the Defense Lattice camera should fly to (hover-driven). */
  flyTo?: VectorId | null
  onAim?: (id: VectorId | null) => void
  onSelectVector?: (id: VectorId) => void
}) {
  const [theme, setTheme] = useTheme()
  const checks = new Map(report.checks.map((c) => [c.id, c]))
  const open = report.attack_paths.filter((a) => a.state === 'open').length
  const intact = report.checks.filter((c) => c.status !== 'fail').length
  const scanned = new Date(report.scanned_at).toLocaleTimeString('en-GB', { timeZone: 'UTC' })

  return (
    <Card className="relative w-full overflow-hidden bg-obsidian font-mono md:h-[1000px]">
      <Spotlight className="-top-40 left-0 light:hidden md:-top-20 md:left-60" />

      <div className="flex h-full flex-col md:flex-row">
        {/* LEFT: content & metrics */}
        <div
          className={cn(
            'relative z-10 flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto border-b border-white/10 p-6 transition-opacity md:border-r md:border-b-0 md:p-8',
            loading && 'opacity-40',
          )}
          aria-busy={loading}
        >
          <header className="flex items-center justify-between gap-3">
            <p className="flex items-center gap-2.5 text-[11px] tracking-[0.2em] text-neutral-400 uppercase">
              <span className="relative flex size-2">
                <span className="absolute inset-0 animate-ping rounded-full bg-emerald-500 opacity-60" />
                <span className="relative size-2 rounded-full bg-emerald-500" />
              </span>
              SecureMailScope <span className="text-neutral-700">//</span> Live Telemetry
            </p>
            <div className="flex items-center gap-1.5">
              {(['pdf', 'json'] as const).map((format) => (
                <a
                  key={format}
                  href={exportUrl(report.domain, format)}
                  download
                  className="border border-white/10 px-1.5 py-0.5 text-[9.5px] tracking-[0.18em] text-neutral-300 uppercase transition-colors hover:border-white/40 hover:text-white"
                  aria-label={`Download ${format === 'pdf' ? 'PDF audit report' : 'JSON'} for ${report.domain}`}
                >
                  ↓ {format}
                </a>
              ))}
              <span className="border border-white/10 px-1.5 py-0.5 text-[9.5px] tracking-[0.18em] text-neutral-500">
                {report.mode === 'demo' ? 'DEMO' : report.cached ? 'CACHED' : 'LIVE'}
              </span>
              <div className="ml-1.5 flex" role="group" aria-label="Colour theme">
                {(['dark', 'light'] as const satisfies readonly Theme[]).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTheme(t)}
                    aria-pressed={theme === t}
                    className={cn(
                      '-ml-px border border-white/10 px-1.5 py-0.5 text-[9.5px] tracking-[0.18em] uppercase transition-colors',
                      theme === t ? 'bg-white text-black' : 'text-neutral-400 hover:text-white',
                    )}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
          </header>

          <section aria-labelledby="posture-heading">
            <Label>
              <span id="posture-heading">Security posture</span> ·{' '}
              <span className="text-neutral-300">{report.domain}</span>
            </Label>
            <div className="mt-2 flex items-end gap-4">
              <p className="flex items-baseline gap-3 leading-none tabular-nums">
                <span className={cn('text-7xl font-bold tracking-tighter md:text-8xl', scoreTone(report.score))}>
                  {report.score}
                </span>
                <span className="text-2xl text-neutral-600">/ 100</span>
              </p>
              <span
                className={cn('mb-1 border border-current px-2 py-0.5 text-xl font-bold', scoreTone(report.score))}
                aria-label={`Grade ${report.grade}`}
              >
                {report.grade}
              </span>
            </div>
            <p className="mt-3 text-[11px] text-neutral-500">
              <span className={open ? 'text-red-500' : 'text-emerald-500'}>{open} OPEN ATTACK PATHS</span>
              <span className="text-neutral-700"> · </span>SCANNED {scanned} UTC
            </p>
          </section>

          <section aria-labelledby="matrix-heading">
            <div className="mb-2 flex items-center justify-between">
              <Label>
                <span id="matrix-heading">Attack path matrix</span>
              </Label>
              <Label>7 vectors</Label>
            </div>
            <div className="mb-2">
              <StatusLegend />
            </div>
            <div className="border border-white/10">
              {MATRIX.map(({ id, label }) => (
                <MatrixRow
                  key={id}
                  label={label}
                  check={checks.get(id)}
                  onSelect={onSelectVector ? () => onSelectVector(id) : undefined}
                  onAim={onAim ? (on) => onAim(on ? id : null) : undefined}
                />
              ))}
            </div>
          </section>

          <section className="mt-auto" aria-label="The one fix">
            <Label className="mb-2">The one fix</Label>
            <OneFixPanel report={report} />
          </section>
        </div>

        {/* RIGHT: the Defense Lattice above the email-security telemetry */}
        <div className="relative flex min-w-0 flex-col md:flex-[1.2]">
          <div className="relative z-10 flex h-9 shrink-0 items-center border-b border-white/10 px-3">
            <Label>
              3D <span className="text-neutral-700">//</span> Defense lattice ·{' '}
              <span className={intact === report.checks.length ? 'text-emerald-500' : 'text-red-500'}>
                {intact}/{report.checks.length} links intact
              </span>
            </Label>
          </div>

          <div className="relative h-[380px] min-h-0 md:h-auto md:flex-[1.5]">
            <Suspense
              fallback={
                <div className="flex h-full items-center justify-center text-[10px] tracking-[0.2em] text-neutral-500 uppercase">
                  <span className="animate-pulse">Loading defense lattice…</span>
                </div>
              }
            >
              <DefenseLattice
                report={report}
                dimmed={loading}
                flyTo={flyTo}
                embedded
                onSelectVector={onSelectVector ?? (() => {})}
              />
            </Suspense>
          </div>

          <div className="h-[260px] shrink-0 border-t border-white/10 md:h-auto md:min-h-[200px] md:flex-1">
            <Telemetry report={report} pending={pending} className="border-0" />
          </div>
        </div>
      </div>
    </Card>
  )
}
