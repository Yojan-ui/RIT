// Mirrors pqc-scanner/backend/app/main.py → run_scan().

export type Tone = 'emerald' | 'amber' | 'crimson'

export interface KeyInfo {
  family: string
  name: string
  bits: number | null
  oid: string
  curve?: string
}

export interface SigInfo {
  family: string
  name: string
  oid: string
}

export interface BreakdownItem {
  component: string
  algorithm: string
  quantum_safe: boolean
  category: string
  readiness: number
  weight: number
  points: number
  classification: string
  threat: string
  detail: string
}

export interface Recommendation {
  priority: number
  title: string
  standard: string
  detail: string
}

export interface CbomRow {
  name: string
  primitive: string
  oid: string | null
  nist_level: number
  quantum_safe: boolean
  classification: string
  family: string
}

export interface ScanResult {
  domain: string
  resolved_ip: string
  /** Every vetted address for the host, and any the scanner had to skip (address fallback). */
  addresses?: string[]
  skipped_addresses?: { ip: string; reason: string }[]
  scanned_at: string
  duration_ms: number
  cached: boolean
  tls: {
    version: string
    cipher_suite: string
    key_exchange: {
      group: string | null
      group_code: string | null
      pq_hybrid: boolean
      offered: string[]
      hello_retry: boolean
      method: string | null
      notes: string[]
    }
  }
  certificate: {
    subject_cn: string | null
    issuer_cn: string | null
    issuer_org: string | null
    not_before: string
    not_after: string
    days_remaining: number
    serial?: string
    sans: string[]
    san_count: number
    public_key: KeyInfo
    signature: SigInfo
    trusted: boolean
    verify_error: string | null
    chain: { subject_cn: string | null; issuer_cn: string | null; not_after: string; public_key: KeyInfo; signature: SigInfo }[]
  }
  assessment: {
    score: number
    grade: string
    status: 'quantum-ready' | 'hybrid' | 'classical' | 'legacy'
    color: Tone
    badge: string
    headline: string
    urgency: { level: string; reason: string; deadline: string }
    breakdown: BreakdownItem[]
    recommendations: Recommendation[]
    max_achievable_today: number
  }
  cbom_summary: CbomRow[]
  cbom: Record<string, unknown>
  /** Measured on the wire by the probe (absent from older backends and the demo dataset). */
  wire?: WireStats
}

export interface WireStats {
  client_hello_bytes: number | null
  server_flight_bytes: number | null
  server_share_bytes: number | null
  connect_ms: number | null
  hello_rtt_ms: number | null
  cert_chain_bytes: number | null
}

/** One backend log record (`pqc.scan` / `uvicorn.access`) or client-side stream status (`client.sse`). */
export interface TelemetryEvent {
  t: number
  level: string
  logger: string
  stage: string
  msg: string
  data?: Record<string, unknown>
}

const BASE = ((import.meta.env.VITE_API_URL as string | undefined) ?? '').replace(/\/$/, '')

export async function scanDomain(domain: string, signal?: AbortSignal): Promise<ScanResult> {
  let res: Response
  try {
    res = await fetch(`${BASE}/api/scan?domain=${encodeURIComponent(domain)}`, { signal })
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e
    throw new Error('Scanner API unreachable. Is the backend running?')
  }
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(typeof body.detail === 'string' ? body.detail : `Scan failed (${res.status})`)
  return body as ScanResult
}

/**
 * The same scan over Server-Sent Events: every probe step arrives as a `log` event
 * while the scan runs, then the `result`. Stream status is reported as `client.sse` events.
 */
export async function scanDomainStream(domain: string, onEvent: (e: TelemetryEvent) => void, signal?: AbortSignal): Promise<ScanResult> {
  const url = `${BASE}/api/scan/stream?domain=${encodeURIComponent(domain)}`
  const status = (msg: string, level = 'INFO', data?: Record<string, unknown>) => onEvent({ t: Date.now() / 1000, level, logger: 'client.sse', stage: 'sse', msg, data })
  status(`EventSource → ${url}`, 'INFO', { state: 'connecting' })
  let res: Response
  try {
    res = await fetch(url, { signal, headers: { Accept: 'text/event-stream' } })
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e
    status('connection refused · backend unreachable', 'ERROR', { state: 'error' })
    throw new Error('Scanner API unreachable. Is the backend running?')
  }
  if (!res.ok || !res.body) {
    const body = await res.json().catch(() => ({}))
    status(`HTTP ${res.status} · stream rejected`, 'ERROR', { state: 'error' })
    throw new Error(typeof body.detail === 'string' ? body.detail : `Scan failed (${res.status})`)
  }
  status(`HTTP ${res.status} · ${res.headers.get('content-type') ?? 'text/event-stream'} · open`, 'INFO', { state: 'open' })
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  let bytes = 0
  let count = 0
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    bytes += value.byteLength
    buf += dec.decode(value, { stream: true })
    let cut: number
    while ((cut = buf.indexOf('\n\n')) >= 0) {
      const frame = buf.slice(0, cut)
      buf = buf.slice(cut + 2)
      let event = 'message'
      let data = ''
      for (const line of frame.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim()
        else if (line.startsWith('data:')) data += line.slice(5).trim()
      }
      if (!data) continue
      count++
      const body = JSON.parse(data)
      if (event === 'log') onEvent(body as TelemetryEvent)
      else if (event === 'error') {
        status(`error event · HTTP ${body.status}`, 'ERROR', { state: 'error' })
        throw new Error(String(body.detail))
      } else if (event === 'result') {
        status(`result received · ${count} events · ${(bytes / 1024).toFixed(1)} KB · stream closed`, 'INFO', { state: 'closed', bytes, count })
        reader.cancel().catch(() => {})
        return body as ScanResult
      }
    }
  }
  status('stream ended without a result', 'ERROR', { state: 'error' })
  throw new Error('Scan stream ended unexpectedly.')
}

export interface KexBench {
  server_us: number
  client_us: number
  client_share_bytes: number
  server_share_bytes: number
}
export interface SigBench {
  sign_us: number
  verify_us: number
  public_key_bytes: number
  signature_bytes: number
}
export interface Bench {
  host: string
  library: string
  kex: Record<string, KexBench>
  sig: Record<string, SigBench>
  measured_in_ms: number
}

export async function fetchBench(): Promise<Bench> {
  const res = await fetch(`${BASE}/api/bench`)
  if (!res.ok) throw new Error(`bench ${res.status}`)
  return (await res.json()) as Bench
}

/** AR handoff: the LAN HTTPS address a phone can open (set when the demo runs with AR=1), else null. */
export async function fetchXrHandoff(): Promise<string | null> {
  const res = await fetch(`${BASE}/api/xr`)
  if (!res.ok) return null
  return ((await res.json()) as { handoff_url: string | null }).handoff_url
}
