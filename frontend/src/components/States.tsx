import { TriangleAlert } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { ApiError } from '@/lib/api'

export function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(() => performance.now())
  useEffect(() => {
    const t = setInterval(() => setNow(performance.now()), 100)
    return () => clearInterval(t)
  }, [])
  return <span className="tabular-nums">{((now - since) / 1000).toFixed(1)}s</span>
}

export function ScanningBanner({ target, since }: { target: string; since: number }) {
  return (
    <div
      role="status"
      className="flex items-center gap-3 rounded-sm border border-ok/30 bg-ok/5 px-4 py-2 font-mono text-[11px] tracking-wider text-ok"
    >
      <span className="animate-pulse">SCANNING</span>
      <span className="truncate text-slate-300">{target}</span>
      <span className="ml-auto text-slate-500">
        <Elapsed since={since} />
      </span>
    </div>
  )
}

export function ErrorPanel({ error, target, onRetry }: { error: ApiError; target: string; onRetry: () => void }) {
  return (
    <div role="alert" className="panel border-crit/40 p-6">
      <div className="flex items-start gap-3">
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-crit" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[11px] tracking-wider text-crit">
            {error.status ? `ERROR ${error.status}` : 'NETWORK ERROR'} · {target}
          </p>
          <p className="mt-1.5 text-slate-200">{error.message}</p>
          <button
            type="button"
            onClick={onRetry}
            className="mt-4 h-7 rounded-sm border border-line-strong px-3 font-mono text-[11px] tracking-wider text-slate-300 hover:border-slate-500 hover:text-slate-100 active:translate-y-px"
          >
            RETRY
          </button>
        </div>
      </div>
    </div>
  )
}

/** First-load placeholder with the dashboard's shape, so nothing jumps when data lands. */
export function Skeleton() {
  return (
    <div className="grid h-[700px] grid-cols-1 border border-white/10 md:grid-cols-[1fr_1.2fr]" aria-hidden>
      <div className="flex flex-col gap-4 border-white/10 p-8 md:border-r">
        <div className="h-3 w-56 animate-pulse bg-white/[0.06]" />
        <div className="h-24 w-64 animate-pulse bg-white/[0.06]" />
        <div className="h-64 animate-pulse bg-white/[0.04]" />
        <div className="mt-auto h-28 animate-pulse bg-white/[0.04]" />
      </div>
      <div className="hidden animate-pulse bg-white/[0.02] md:block" />
    </div>
  )
}
