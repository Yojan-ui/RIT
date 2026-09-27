import type { DemoScenario, RecentScan, ScanReport } from './types'

// Empty by default: dev uses the Vite proxy, production is same-origin.
const BASE = import.meta.env.VITE_API_BASE ?? ''

export class ApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

function detailFrom(body: unknown): string | null {
  if (!body || typeof body !== 'object' || !('detail' in body)) return null
  const { detail } = body as { detail: unknown }
  if (typeof detail === 'string') return detail
  // FastAPI validation errors: [{ loc, msg, type }, ...]
  if (Array.isArray(detail)) return detail.map((d) => (d as { msg?: string }).msg ?? String(d)).join('; ')
  return null
}

async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${BASE}${path}`, { signal, headers: { Accept: 'application/json' } })
  } catch (err) {
    if (signal?.aborted) throw err
    throw new ApiError(0, 'Backend unreachable. Is the FastAPI server running on :8000?')
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new ApiError(response.status, detailFrom(body) ?? `${response.status} ${response.statusText}`)
  }
  return response.json() as Promise<T>
}

export const api = {
  health: (signal?: AbortSignal) => get<{ status: string; version: string }>('/api/health', signal),
  scenarios: (signal?: AbortSignal) => get<DemoScenario[]>('/api/demo', signal),
  demo: (id: string, delayMs = 0, signal?: AbortSignal) =>
    get<ScanReport>(`/api/demo/${encodeURIComponent(id)}${delayMs ? `?delay_ms=${delayMs}` : ''}`, signal),
  recent: (signal?: AbortSignal) => get<RecentScan[]>('/api/v1/recent?limit=8', signal),
  /** Latest scan via the versioned API: served from cache when fresh. */
  cachedScan: (domain: string, signal?: AbortSignal) =>
    get<ScanReport>(`/api/v1/scan/${encodeURIComponent(domain)}`, signal),
  scan: (domain: string, signal?: AbortSignal) =>
    get<ScanReport>(`/api/scan?domain=${encodeURIComponent(domain)}`, signal),
}

/** Download URL for a scan export (PDF audit report or raw JSON). */
export const exportUrl = (domain: string, format: 'pdf' | 'json') =>
  `${BASE}/api/v1/scan/${encodeURIComponent(domain)}/${format}`
