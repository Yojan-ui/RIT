import { lazy, Suspense, useEffect } from 'react'
import { CommandBar } from '@/components/CommandBar'
import { NarrativePanel } from '@/components/NarrativePanel'
import { Panel } from '@/components/Panel'
import { AttackMatrix, ChecksGrid, FixPanel, MetricStrip } from '@/components/Readout'
import { TopBar } from '@/components/TopBar'
import { WebGLBoundary } from '@/components/three/WebGLBoundary'
import { useApiLink } from '@/hooks/useApiLink'
import { useDemoDomains } from '@/hooks/useDemoDomains'
import { useRecent } from '@/hooks/useRecent'
import { useScan } from '@/hooks/useScan'

// three.js is ~900 kB: load it after the terminal has painted.
const PostureField = lazy(() => import('@/components/three/PostureField'))

export default function App() {
  const link = useApiLink()
  const demos = useDemoDomains()
  const { state, scan } = useScan()
  const result = state.status === 'done' ? state.result : null
  const recent = useRecent(result?.scanned_at)
  const isDemo = result !== null && demos.some((d) => d.domain === result.domain)

  // ?domain=example.com scans on load, so a result can be bookmarked or linked.
  const linkedDomain = new URLSearchParams(window.location.search).get('domain') ?? ''
  useEffect(() => {
    if (linkedDomain) void scan({ domain: linkedDomain, dkim_selectors: [], force_refresh: false })
  }, [linkedDomain, scan])

  // Keep the address bar in step with what's on screen, so it can be copied and shared.
  useEffect(() => {
    if (!result) return
    const url = new URL(window.location.href)
    url.searchParams.set('domain', result.domain)
    window.history.replaceState(null, '', url)
    document.title = `${result.domain} ${result.score.grade} ${result.score.score}/100 · SecureMailScope`
  }, [result])

  const posture = (
    <Panel
      title="Posture"
      className="h-80 lg:h-[min(28rem,55vh)]"
      right={<span className="tabular truncate text-2xs text-ink">{result?.domain ?? (state.status === 'scanning' ? state.domain : '—')}</span>}
    >
      {/* Absolute inset gives the canvas a definite size; R3F measures its parent's height. */}
      <div className="relative h-full">
        <div className="absolute inset-0">
          <WebGLBoundary>
            <Suspense fallback={null}>
              <PostureField paths={result?.attack_matrix ?? null} grade={result?.score.grade ?? null} />
            </Suspense>
          </WebGLBoundary>
        </div>
      </div>
    </Panel>
  )

  return (
    <div className="flex min-h-dvh flex-col">
      <TopBar link={link} />
      <CommandBar demos={demos} recent={recent} busy={state.status === 'scanning'} onScan={scan} initialDomain={linkedDomain} />

      <main className="grid flex-1 gap-3 p-3 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        {/* Phones: readout (with the fix under the score) first, 3D view last. Desktop: 3D + fix on the left. */}
        {/* Sticky on desktop: the 3D view and the fix stay in sight while the details scroll. */}
        <div className="order-2 flex min-w-0 flex-col gap-3 lg:sticky lg:top-3 lg:order-1 lg:self-start">
          <div className="order-2 lg:order-1">{posture}</div>
          {result && (
            <div className="hidden lg:order-2 lg:block">
              <FixPanel result={result} />
            </div>
          )}
        </div>

        <div className="order-1 flex min-w-0 flex-col gap-3 lg:order-2">
          {state.status === 'idle' && (
            <Panel title="Readout" className="flex-1">
              <div className="space-y-2 p-3 font-mono text-xs text-dim">
                <p>
                  Awaiting target. Enter a domain or choose a demo target<span className="caret text-secure">_</span>
                </p>
                <p className="max-w-[70ch] font-sans">
                  SecureMailScope checks SPF, DKIM, DMARC, MTA-STS, TLS-RPT and STARTTLS, scores the domain, maps the results onto seven
                  attack paths, and names the one change that closes the most risk.
                </p>
              </div>
            </Panel>
          )}
          {state.status === 'scanning' && (
            <Panel title="Readout" className="flex-1">
              <p className="p-3 font-mono text-xs text-ink" role="status">
                Resolving {state.domain}: DNS, DKIM selectors, MTA-STS policy, STARTTLS<span className="caret text-secure">_</span>
              </p>
            </Panel>
          )}
          {state.status === 'error' && (
            <Panel title="Readout" className="flex-1">
              <div className="border-l-2 border-vulnerable p-3" role="alert">
                <p className="font-mono text-xs text-vulnerable">SCAN FAILED: {state.domain}</p>
                <p className="mt-1 text-xs text-ink">{state.message}</p>
              </div>
            </Panel>
          )}
          {state.status === 'done' && (
            <>
              <MetricStrip result={state.result} elapsedMs={state.elapsedMs} isDemo={isDemo} />
              {/* Phones: the fix belongs right under the score (desktop shows it in the left column). */}
              <div className="lg:hidden">
                <FixPanel result={state.result} />
              </div>
              <AttackMatrix result={state.result} />
              <NarrativePanel result={state.result} />
              <ChecksGrid result={state.result} />
            </>
          )}
        </div>
      </main>
    </div>
  )
}
