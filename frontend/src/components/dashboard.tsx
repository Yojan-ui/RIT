import { Download } from 'lucide-react'
import { Suspense, lazy } from 'react'
import { RawRecord } from '@/components/primitives'
import { exportUrl } from '@/lib/api'
import { EFFORT_INFO, formatMinutes, scoreBg, scoreTone } from '@/lib/meta'
import { cn } from '@/lib/utils'
import type { ScanReport, VectorId } from '@/lib/types'

// three.js is ~1 MB: split into its own chunk so the text renders first.
const DefenseLattice = lazy(() => import('@/components/lattice/DefenseLattice'))

/** One sentence that answers "can someone impersonate us?" for this report. */
function verdict(report: ScanReport): string {
  const open = new Set(report.attack_paths.filter((a) => a.state === 'open').map((a) => a.id))
  const d = report.domain
  if (open.has('exact_domain_spoofing')) return `Anyone can send email pretending to be ${d}.`
  if (open.has('subdomain_spoofing')) return `Attackers can send email from look-alike addresses under ${d}.`
  if (open.has('envelope_spoofing') || open.has('message_tampering'))
    return `Forged or altered email from ${d} could slip past some inboxes.`
  if (open.has('cleartext_delivery') || open.has('starttls_downgrade'))
    return `Email sent to ${d} can be read by anyone on the network path.`
  if (open.size) return `${d} is well defended, with ${open.size} smaller gap${open.size === 1 ? '' : 's'} to close.`
  return `${d} is well protected against email impersonation.`
}

function Fact({ label, children, note }: { label: string; children: React.ReactNode; note?: React.ReactNode }) {
  return (
    <div className="min-w-0 px-3 py-2.5">
      <dt className="text-[10.5px] font-bold tracking-[0.12em] text-ink-3 uppercase">{label}</dt>
      <dd className="mt-1 text-[22px] leading-tight font-bold text-ink">{children}</dd>
      {note && <dd className="mt-1 text-[11px] text-ink-2">{note}</dd>}
    </div>
  )
}

/** Verdict, three headline facts, and the single change to make first. */
export function Hero({ report, loading = false }: { report: ScanReport; loading?: boolean }) {
  const open = report.attack_paths.filter((a) => a.state === 'open').length
  const plan = report.fix_plan
  const minutes = plan?.steps.reduce((sum, s) => sum + EFFORT_INFO[s.effort].minutes, 0) ?? 0
  const scanned = new Date(report.scanned_at).toLocaleString('en-GB', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
  const fix = report.one_fix
  const host = fix ? (fix.record.host.endsWith('.') ? fix.record.host : `${fix.record.host}.`) : ''
  const value = fix ? (fix.record.type === 'TXT' ? `"${fix.record.value}"` : fix.record.value) : ''
  const cleartext = report.attack_paths.some((a) => a.id === 'cleartext_delivery' && a.state === 'open')

  return (
    <section aria-labelledby="verdict" className={cn('transition-opacity', loading && 'opacity-40')}>
      <div className="flex flex-wrap items-stretch border border-line text-[11px]">
        {(
          [
            ['TARGET', report.domain],
            ['MODE', report.mode === 'demo' ? 'DEMO' : report.cached ? 'CACHED' : 'LIVE'],
            ['SCANNED', `${scanned} UTC`],
          ] as const
        ).map(([k, v]) => (
          <span key={k} className="flex items-center gap-2 border-r border-line px-2.5 py-1.5">
            <span className="font-bold tracking-[0.12em] text-ink-3">{k}</span>
            <span className="text-ink">{v}</span>
          </span>
        ))}
        <span className="ml-auto flex">
          {(['pdf', 'json'] as const).map((format) => (
            <a
              key={format}
              href={exportUrl(report.domain, format)}
              download
              aria-label={`Download ${format === 'pdf' ? 'PDF audit report' : 'JSON'} for ${report.domain}`}
              className="inline-flex items-center gap-1 border-l border-line px-2.5 font-bold tracking-[0.1em] text-ink-2 hover:bg-ink hover:text-page"
            >
              <Download className="size-3" aria-hidden />
              {format.toUpperCase()}
            </a>
          ))}
        </span>
      </div>

      <h1
        id="verdict"
        className="mt-4 max-w-[34ch] text-[22px] leading-[1.2] font-bold text-balance text-ink md:text-[26px]"
      >
        {verdict(report)}
      </h1>

      <dl className="mt-4 grid divide-y divide-line border border-line sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        <Fact
          label="Security score"
          note={
            <span className="flex items-center gap-2">
              <span className="relative block h-2 w-24 overflow-hidden border border-line" aria-hidden>
                <span className={cn('absolute inset-y-0 left-0', scoreBg(report.score))} style={{ width: `${report.score}%` }} />
              </span>
              GRADE {report.grade}
            </span>
          }
        >
          <span className={scoreTone(report.score)}>{report.score}</span>
          <span className="text-[13px] font-normal text-ink-3"> / 100</span>
        </Fact>
        <Fact label="Open attack paths" note={`of ${report.attack_paths.length} tested`}>
          <span className={open ? 'text-crit' : 'text-ok'}>{open}</span>
        </Fact>
        <Fact
          label="Time to fix"
          note={plan && plan.steps.length ? `${plan.steps.length} steps, reaching ${plan.final_score}` : 'Nothing to do'}
        >
          {minutes ? formatMinutes(minutes).replace('~', '') : 'None'}
        </Fact>
      </dl>

      <div className="mt-4 border border-line p-3">
        <h2 className="subhead">{fix ? 'The one fix: start here' : 'No DNS change needed'}</h2>
        {fix ? (
          <>
            <p className="mt-1.5 max-w-[60ch] text-[13px] text-ink-2">
              <span className="text-ink">{fix.title}.</span> This one record raises the score from {fix.score_before}{' '}
              to <span className="font-bold text-ok">{fix.score_after}</span>.
            </p>
            <div className="mt-3">
              <RawRecord value={`${host} 3600 IN ${fix.record.type} ${value}`} label="DNS record" />
            </div>
          </>
        ) : (
          <p className="mt-1.5 text-[13px] text-ink-2">Every attack path that DNS can close is already closed.</p>
        )}
        {cleartext && (
          <p className="mt-3 text-[12px] text-warn">
            Also needed: turn on STARTTLS in the mail server settings. This is a server change, not a DNS record.
          </p>
        )}
      </div>
    </section>
  )
}

/** The interactive 3D view of the seven protections around the domain. */
export function LatticeStage({
  report,
  loading = false,
  dark,
  flyTo = null,
  onSelectVector,
}: {
  report: ScanReport
  loading?: boolean
  dark: boolean
  flyTo?: VectorId | null
  onSelectVector: (id: VectorId) => void
}) {
  return (
    <div className="relative h-full overflow-hidden border border-line bg-stage">
      <Suspense
        fallback={<div className="grid h-full place-items-center text-[12.5px] text-ink-3">LOADING 3D VIEW…</div>}
      >
        <DefenseLattice report={report} dimmed={loading} flyTo={flyTo} flat dark={dark} onSelectVector={onSelectVector} />
      </Suspense>
    </div>
  )
}
