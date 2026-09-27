import type { DemoDomain, Health, Narrative, ScanRequest, ScanResult } from './types'

// Same origin by default: the Vite dev server proxies /api to FastAPI, and in production FastAPI
// serves this app. Set VITE_API_BASE_URL only when the backend lives on another origin.
const BASE = `${(import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/+$/, '')}/api/v1`

export class ApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

/** FastAPI errors are {detail: string} or {detail: [{msg}, ...]} for validation failures. */
function describe(status: number, body: unknown): string {
  const detail = (body as { detail?: unknown } | null)?.detail
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) {
    return detail
      .map((d) => String((d as { msg?: unknown }).msg ?? '').replace(/^Value error, /, ''))
      .filter(Boolean)
      .join('; ')
  }
  return `The server returned ${status}.`
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${BASE}${path}`, {
      ...init,
      headers: { accept: 'application/json', ...(init.body ? { 'content-type': 'application/json' } : {}), ...init.headers },
    })
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err
    throw new ApiError(0, 'Cannot reach the SecureMailScope API.')
  }
  const body: unknown = await response.json().catch(() => null)
  if (!response.ok) throw new ApiError(response.status, describe(response.status, body))
  return body as T
}

export const api = {
  health: (signal?: AbortSignal) => request<Health>('/health', { signal }),
  demoDomains: (signal?: AbortSignal) => request<DemoDomain[]>('/demo-domains', { signal }),
  scan: (body: ScanRequest, signal?: AbortSignal) =>
    request<ScanResult>('/scan', { method: 'POST', body: JSON.stringify(body), signal }),
  narrative: (domain: string, signal?: AbortSignal) =>
    request<Narrative>(`/scan/${encodeURIComponent(domain)}/narrative`, { signal }),
  /** Direct download links (the browser handles the file). */
  exportUrl: (domain: string, format: 'pdf' | 'json') => `${BASE}/scan/${encodeURIComponent(domain)}/${format}`,
}
