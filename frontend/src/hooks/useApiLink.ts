import { useEffect, useState } from 'react'
import { api } from '@/api/client'

export type ApiLink =
  | { state: 'connecting' }
  | { state: 'online'; version: string; latencyMs: number }
  | { state: 'offline'; error: string }

const POLL_MS = 15_000

/** Polls /health so the terminal can show whether the backend is reachable, and how fast. */
export function useApiLink(): ApiLink {
  const [link, setLink] = useState<ApiLink>({ state: 'connecting' })

  useEffect(() => {
    let controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined

    const probe = async () => {
      controller = new AbortController()
      const started = performance.now()
      try {
        const health = await api.health(controller.signal)
        setLink({ state: 'online', version: health.version, latencyMs: Math.round(performance.now() - started) })
      } catch (err) {
        if ((err as Error).name === 'AbortError') return
        setLink({ state: 'offline', error: (err as Error).message })
      }
      timer = setTimeout(probe, POLL_MS)
    }

    void probe()
    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [])

  return link
}
