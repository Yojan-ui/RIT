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
