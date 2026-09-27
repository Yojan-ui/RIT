import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, api } from '@/lib/api'
import type { ScanReport } from '@/lib/types'

export type Source = { kind: 'demo'; id: string } | { kind: 'live'; domain: string }

interface ReportState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  source?: Source
  report?: ScanReport
  error?: ApiError
  startedAt?: number
}

/** Fetch one report at a time; a new request aborts the one in flight. */
export function useReport() {
  const [state, setState] = useState<ReportState>({ status: 'idle' })
  const inflight = useRef<AbortController | null>(null)

  const load = useCallback((source: Source, delayMs = 0) => {
    inflight.current?.abort()
    const controller = new AbortController()
    inflight.current = controller
    // Keep the previous report on screen (dimmed) while the next one loads.
    setState((prev) => ({ ...prev, status: 'loading', source, error: undefined, startedAt: performance.now() }))

    const request =
      source.kind === 'demo'
        ? api.demo(source.id, delayMs, controller.signal)
        : api.scan(source.domain, controller.signal)

    request
      .then((report) => {
        if (!controller.signal.aborted) setState({ status: 'ready', source, report })
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        const error = err instanceof ApiError ? err : new ApiError(0, String(err))
        setState({ status: 'error', source, error })
      })
  }, [])

  useEffect(() => () => inflight.current?.abort(), [])

  return { ...state, load }
}
