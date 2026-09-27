import { lazy, Suspense, useEffect } from 'react'
import { CommandBar } from '@/components/CommandBar'
import { Panel } from '@/components/Panel'
import { AttackGrid, ChecksGrid, FixPanel, MetricStrip } from '@/components/Readout'
import { TopBar } from '@/components/TopBar'
import { WebGLBoundary } from '@/components/three/WebGLBoundary'
import { useApiLink } from '@/hooks/useApiLink'
import { useDemoDomains } from '@/hooks/useDemoDomains'
import { useScan } from '@/hooks/useScan'

// three.js is ~600 kB: load it after the terminal has painted.
const PostureField = lazy(() => import('@/components/three/PostureField'))

export default function App() {
  const link = useApiLink()
  const demos = useDemoDomains()
  const { state, scan } = useScan()
  const result = state.status === 'done' ? state.result : null

  // ?domain=example.com scans on load, so a result can be bookmarked or linked.
  const linkedDomain = new URLSearchParams(window.location.search).get('domain') ?? ''
  useEffect(() => {
    if (linkedDomain) void scan({ domain: linkedDomain, dkim_selectors: [], force_refresh: false })
  }, [linkedDomain, scan])

  return (
    <div className="flex min-h-dvh flex-col">
      <TopBar link={link} />
      <CommandBar demos={demos} busy={state.status === 'scanning'} onScan={scan} initialDomain={linkedDomain} />

      <main className="grid flex-1 gap-3 p-3 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="flex min-w-0 flex-col gap-3">
          <Panel
            title="Posture"
            className="min-h-72 flex-1"
            right={<span className="tabular truncate text-2xs text-ink">{result?.domain ?? (state.status === 'scanning' ? state.domain : '—')}</span>}
          >
            {/* Absolute inset gives the canvas a definite size; R3F measures its parent's height. */}
            <div className="relative h-full min-h-64">
              <div className="absolute inset-0">
                <WebGLBoundary>
                  <Suspense fallback={null}>
                    <PostureField paths={result?.attack_matrix ?? null} grade={result?.score.grade ?? null} />
                  </Suspense>
                </WebGLBoundary>
              </div>
            </div>
          </Panel>
          {result && <FixPanel result={result} />}
        </div>

        <div className="flex min-w-0 flex-col gap-3">
          {state.status === 'idle' && (
            <Panel title="Readout" className="flex-1">
              <p className="p-3 font-mono text-xs text-dim">
                Awaiting target. Enter a domain or choose a demo target<span className="caret text-secure">_</span>
              </p>
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
              <MetricStrip result={state.result} elapsedMs={state.elapsedMs} />
              <AttackGrid result={state.result} />
              <ChecksGrid result={state.result} />
            </>
          )}
        </div>
      </main>
    </div>
  )
}
