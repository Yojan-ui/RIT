import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '@/api/client'
import type { ScanRequest, ScanResult } from '@/api/types'

export type ScanState =
  | { status: 'idle' }
  | { status: 'scanning'; domain: string; startedAt: number }
  | { status: 'done'; result: ScanResult; elapsedMs: number }
  | { status: 'error'; domain: string; message: string }

/** Runs scans against the API. Starting a new scan aborts the one in flight. */
export function useScan() {
  const [state, setState] = useState<ScanState>({ status: 'idle' })
  const inflight = useRef<AbortController | null>(null)

  const scan = useCallback(async (request: ScanRequest) => {
    inflight.current?.abort()
    const controller = new AbortController()
    inflight.current = controller
    const startedAt = performance.now()
    setState({ status: 'scanning', domain: request.domain, startedAt })
    try {
      const result = await api.scan(request, controller.signal)
      setState({ status: 'done', result, elapsedMs: Math.round(performance.now() - startedAt) })
    } catch (err) {
      if ((err as Error).name === 'AbortError') return
      setState({ status: 'error', domain: request.domain, message: (err as Error).message })
    }
  }, [])

  useEffect(() => () => inflight.current?.abort(), [])

  return { state, scan }
}
