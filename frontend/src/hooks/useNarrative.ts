import { useEffect, useState } from 'react'
import { api } from '@/api/client'
import type { Narrative, ScanResult } from '@/api/types'

export type NarrativeState =
  | { status: 'loading' }
  | { status: 'done'; narrative: Narrative }
  | { status: 'error'; message: string }

type Settled = Exclude<NarrativeState, { status: 'loading' }>

/**
 * Fetches the plain-English narrative for a finished scan. It can take a while when Claude
 * writes it, so it loads after the result is on screen; a new scan cancels the old request.
 * Each answer is stored against the scan it belongs to, so a stale one is never shown.
 */
export function useNarrative(result: ScanResult): NarrativeState {
  const key = `${result.domain}@${result.scanned_at}`
  const [settled, setSettled] = useState<{ key: string; state: Settled } | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    const domain = key.slice(0, key.lastIndexOf('@'))
    api
      .narrative(domain, controller.signal)
      .then((narrative) => setSettled({ key, state: { status: 'done', narrative } }))
      .catch((err: Error) => {
        if (err.name !== 'AbortError') setSettled({ key, state: { status: 'error', message: err.message } })
      })
    return () => controller.abort()
  }, [key])

  return settled?.key === key ? settled.state : { status: 'loading' }
}
