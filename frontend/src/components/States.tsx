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
      className="flex items-center gap-3 border border-ok px-4 py-2 text-[12px] font-bold tracking-[0.08em] text-ok"
    >
      <span className="animate-pulse">SCANNING</span>
      <span className="truncate font-normal text-ink">
        {target.replace(/^demo:/, 'example ')}
      </span>
      <span className="ml-auto text-ink-3">
        <Elapsed since={since} />
      </span>
    </div>
  )
}

export function ErrorPanel({ error, target, onRetry }: { error: ApiError; target: string; onRetry: () => void }) {
  return (
    <div role="alert" className="card border-crit p-4">
      <div className="flex items-start gap-3">
        <TriangleAlert className="mt-0.5 size-5 shrink-0 text-crit" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-bold text-ink">ERROR{error.status ? ` ${error.status}` : ''}: {target}</p>
          <p className="mt-1 text-[12.5px] text-ink-2">
            {error.message}
          </p>
          <button
            type="button"
            onClick={onRetry}
            className="mt-4 h-9 border border-line px-4 text-[12.5px] font-medium text-ink hover:border-line-strong"
          >
            RETRY
          </button>
        </div>
      </div>
    </div>
  )
}

/** First-load placeholder with the page's shape, so nothing jumps when data lands. */
export function Skeleton() {
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]" aria-hidden>
      <div className="flex flex-col gap-5">
        <div className="h-4 w-48 animate-pulse bg-line" />
        <div className="h-24 w-full max-w-md animate-pulse bg-line" />
        <div className="h-24 animate-pulse bg-line/70" />
        <div className="h-32 animate-pulse bg-line/60" />
      </div>
      <div className="h-[560px] animate-pulse bg-stage" />
    </div>
  )
}
