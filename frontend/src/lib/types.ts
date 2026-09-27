// Mirrors backend/app/models.py. Keep in sync when the API changes.

export type Status = 'pass' | 'warn' | 'fail' | 'info' | 'error'
export type VectorId = 'spf' | 'dkim' | 'dmarc' | 'mx' | 'starttls' | 'mta_sts' | 'tls_rpt'
export type PathState = 'open' | 'closed' | 'not_applicable'
export type Effort = 'paste' | 'paste+host' | 'provider'

export interface CheckResult {
  id: VectorId
  name: string
  weight: number
  applicable: boolean
  status: Status
  score: number
  points: number
  summary: string
  findings: string[]
  records: string[]
  details: Record<string, unknown>
}

export interface AttackPath {
  id: string
  title: string
  severity: number
  description: string
  state: PathState
  dns_fixable: boolean
  remedy: string
}

export interface DnsRecord {
  type: string
  host: string
  value: string
}

export interface Fix {
  id: string
  title: string
  rationale: string
  record: DnsRecord
  closes: string[]
  severity_closed: number
  score_before: number
  score_after: number
  effort: Effort
  caveats: string[]
}

export interface ScanReport {
  domain: string
  mode: 'live' | 'demo'
  scanned_at: string
  duration_ms: number
  score: number
  grade: string
  summary: string
  checks: CheckResult[]
  attack_paths: AttackPath[]
  one_fix: Fix | null
  other_fixes: Fix[]
  observations: Observations
}

// Raw collector output (backend Observations). The telemetry terminal replays it.
export interface TxtLookup {
  records: string[]
  error: string | null
}

export interface StartTlsProbe {
  host: string
  ip: string | null
  port: number
  reachable: boolean
  banner: string | null
  ehlo_ok: boolean
  starttls_offered: boolean
  tls_version: string | null
  cipher: string | null
  cert_valid: boolean | null
  cert_error: string | null
  cert_subject: string | null
  cert_issuer: string | null
  cert_not_after: string | null
  error: string | null
  duration_ms: number | null
}

export interface Observations {
  domain: string
  mx: { hosts: { preference: number; host: string; addresses: string[] }[]; null_mx: boolean; error: string | null }
  spf: TxtLookup & { lookup_count: number | null; lookup_error: string | null; lookup_incomplete?: boolean }
  dkim: {
    selectors_tried: string[]
    keys: { selector: string; record: string }[]
    failed_selectors?: string[]
    error: string | null
  }
  dmarc: TxtLookup
  mta_sts: { txt: TxtLookup; policy: string | null; policy_error: string | null }
  tls_rpt: TxtLookup
  starttls: StartTlsProbe | null
}

export interface DemoScenario {
  id: string
  domain: string
  title: string
  description: string
}
