import { ChevronDown } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { AttackMatrix } from '@/components/AttackMatrix'
import { Hero, LatticeStage } from '@/components/dashboard'
import { FixPlanPanel } from '@/components/FixPlanPanel'
import { RemediationPanel } from '@/components/RemediationPanel'
import { ErrorPanel, ScanningBanner, Skeleton } from '@/components/States'
import { Telemetry } from '@/components/Telemetry'
import { TopBar } from '@/components/TopBar'
import { VectorGrid } from '@/components/VectorGrid'
import { useReport, type Source } from '@/hooks/useReport'
import { useTheme } from '@/hooks/useTheme'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import type { DemoScenario, RecentScan, ScanReport, VectorId } from '@/lib/types'

const DEFAULT_SCENARIO = 'startup'

// URL state: ?demo=<id> or ?domain=<name>; ?delay=<ms> slows demo responses
// so loading states can be designed.
function sourceFromUrl(): { source: Source; delayMs: number } {
  const params = new URLSearchParams(window.location.search)
  const domain = params.get('domain')
  const delayMs = Math.max(0, Number(params.get('delay')) || 0)
  return {
    source: domain ? { kind: 'live', domain } : { kind: 'demo', id: params.get('demo') ?? DEFAULT_SCENARIO },
    delayMs,
  }
}

function writeUrl(source: Source) {
  const params = new URLSearchParams(window.location.search)
  params.delete('demo')
  params.delete('domain')
  if (source.kind === 'demo') params.set('demo', source.id)
  else params.set('domain', source.domain)
  window.history.replaceState(null, '', `?${params}`)
}

const describe = (source?: Source) => (!source ? '' : source.kind === 'demo' ? `demo:${source.id}` : source.domain)

export default function App() {
  const [initial] = useState(sourceFromUrl)
  const [theme, setTheme] = useTheme()
  const { status, source, report, error, startedAt, load } = useReport()
  const [scenarios, setScenarios] = useState<DemoScenario[]>([])
  const [apiUp, setApiUp] = useState<boolean | null>(null)
  const [recent, setRecent] = useState<RecentScan[]>([])
  const [focus, setFocus] = useState<{ id: VectorId; n: number }>()
  const focusVector = useCallback((id: VectorId) => setFocus((f) => ({ id, n: (f?.n ?? 0) + 1 })), [])

  // Hovering a matrix row aims the Defense Lattice camera. Clearing is delayed
  // briefly so sliding between adjacent rows retargets instead of bouncing home.
  const [flyTo, setFlyTo] = useState<VectorId | null>(null)
  const releaseTimer = useRef<number | undefined>(undefined)
  const aim = useCallback((id: VectorId | null) => {
    window.clearTimeout(releaseTimer.current)
    if (id) setFlyTo(id)
    else releaseTimer.current = window.setTimeout(() => setFlyTo(null), 180)
  }, [])
  useEffect(() => () => window.clearTimeout(releaseTimer.current), [])

  useEffect(() => {
    const controller = new AbortController()
    api.health(controller.signal).then(
      () => setApiUp(true),
      () => !controller.signal.aborted && setApiUp(false),
    )
    api.scenarios(controller.signal).then(setScenarios, () => {})
    load(initial.source, initial.delayMs)
    return () => controller.abort()
  }, [initial, load])

  const select = useCallback(
    (next: Source) => {
      setFocus(undefined) // don't re-scroll to a card from the previous report
      setFlyTo(null)
      writeUrl(next)
      load(next, initial.delayMs)
    },
    [initial.delayMs, load],
  )

  // Recent scans: on load, and whenever a live report lands (it was just cached server-side).
  const liveKey = report?.mode === 'live' ? `${report.domain}-${report.scanned_at}` : ''
  useEffect(() => {
    const controller = new AbortController()
    api.recent(controller.signal).then(setRecent, () => {})
    return () => controller.abort()
  }, [liveKey])

  const loading = status === 'loading'
  const reportKey = report ? `${report.domain}-${report.scanned_at}` : ''

  return (
    <div className="min-h-dvh">
      <TopBar
        initialDomain={initial.source.kind === 'live' ? initial.source.domain : ''}
        scenarios={scenarios}
        recent={recent}
        source={source}
        loading={loading}
        apiUp={apiUp}
        theme={theme}
        onTheme={setTheme}
        onSelect={select}
      />

      <main className="mx-auto flex max-w-[1240px] flex-col gap-6 px-4 pt-5 pb-10 md:px-6 md:pt-6">
        {loading && startedAt !== undefined && <ScanningBanner target={describe(source)} since={startedAt} />}

        {status === 'error' && error && source && (
          <ErrorPanel error={error} target={describe(source)} onRetry={() => load(source, initial.delayMs)} />
        )}

        {!report && loading && <Skeleton />}

        {report && status !== 'error' && (
          <div className={cn('flex flex-col gap-8', loading && 'pointer-events-none')} aria-busy={loading}>
            {/* Verdict and protections on the left; the 3D view stays pinned beside
                them, so hovering any protection flies the camera to it. */}
            <div className="grid gap-x-6 gap-y-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
              <Hero report={report} loading={loading} />
              <div className="lg:col-start-2 lg:row-span-2 lg:row-start-1">
                <div className="h-[440px] sm:h-[520px] lg:sticky lg:top-28 lg:h-[min(640px,calc(100dvh-8.5rem))]">
                  <LatticeStage
                    report={report}
                    loading={loading}
                    dark={theme === 'dark'}
                    flyTo={flyTo}
                    onSelectVector={focusVector}
                  />
                </div>
              </div>
              <div className={cn('lg:pt-6', loading && 'opacity-40')}>
                <VectorGrid key={reportKey} report={report} focus={focus} onAim={aim} />
              </div>
            </div>

            <div className={cn('flex flex-col gap-8', loading && 'opacity-40')}>
              <FixPlanPanel report={report} onAim={aim} />
              <RemediationPanel report={report} onAim={aim} />
              <AttackMatrix report={report} onAim={aim} />
              <ScanLog report={report} pending={loading ? describe(source) : undefined} />
            </div>
          </div>
        )}
      </main>

      <footer className="border-t border-line">
        <p className="mx-auto max-w-[1240px] px-4 py-8 text-[12px] text-ink-3 md:px-6">
          SecureMailScope checks SPF, DKIM, DMARC, MX, STARTTLS, MTA-STS and TLS-RPT using public DNS and a live
          SMTP probe. Nothing is sent from your domain.
        </p>
      </footer>
    </div>
  )
}

/** The raw probe transcript, folded away; it only mounts (and streams) once opened. */
function ScanLog({ report, pending }: { report: ScanReport; pending?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <section aria-labelledby="log-heading">
      <details className="group card overflow-hidden" onToggle={(e) => setOpen(e.currentTarget.open)}>
        <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-4 py-3 hover:bg-sunken [&::-webkit-details-marker]:hidden">
          <span>
            <span id="log-heading" className="block text-[13px] font-bold text-ink">
              Scan log
            </span>
            <span className="text-[12.5px] text-ink-2">Every DNS lookup and mail-server exchange behind this report.</span>
          </span>
          <ChevronDown className="size-4.5 shrink-0 text-ink-3 transition-transform group-open:rotate-180" aria-hidden />
        </summary>
        {open && (
          <div className="h-[360px] border-t border-line">
            <Telemetry report={report} pending={pending} />
          </div>
        )}
      </details>
    </section>
  )
}
