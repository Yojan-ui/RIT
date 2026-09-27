import type { Effort, PathState, Status, VectorId } from './types'

export const VECTOR_ORDER: VectorId[] = ['spf', 'dkim', 'dmarc', 'mx', 'starttls', 'mta_sts', 'tls_rpt']

export const VECTOR_ABBR: Record<VectorId, string> = {
  spf: 'SPF',
  dkim: 'DKIM',
  dmarc: 'DMARC',
  mx: 'MX',
  starttls: 'TLS',
  mta_sts: 'STS',
  tls_rpt: 'RPT',
}

// Which vectors govern each attack path (mirrors the predicates in
// backend/app/analysis/scoring.py). Drives the matrix columns. The primary
// vector is listed first; the 3D fly-to uses it to break ties.
export const PATH_VECTORS: Record<string, VectorId[]> = {
  exact_domain_spoofing: ['dmarc', 'spf', 'dkim'],
  subdomain_spoofing: ['dmarc'],
  envelope_spoofing: ['spf', 'dmarc'],
  message_tampering: ['dkim'],
  starttls_downgrade: ['mta_sts', 'starttls', 'mx'],
  cleartext_delivery: ['starttls', 'mx'],
  spoofing_blind_spot: ['dmarc'],
  tls_blind_spot: ['tls_rpt'],
}

interface Tone {
  label: string
  text: string
  bg: string
  border: string
}

export const STATUS_TONE: Record<Status, Tone> = {
  pass: { label: 'PASS', text: 'text-ok', bg: 'bg-ok', border: 'border-ok/40' },
  warn: { label: 'WARN', text: 'text-warn', bg: 'bg-warn', border: 'border-warn/40' },
  fail: { label: 'FAIL', text: 'text-crit', bg: 'bg-crit', border: 'border-crit/50' },
  info: { label: 'INFO', text: 'text-slate-400', bg: 'bg-slate-400', border: 'border-line-strong' },
  error: { label: 'UNMEASURED', text: 'text-slate-500', bg: 'bg-na', border: 'border-line-strong' },
}

export const PATH_TONE: Record<PathState, Tone> = {
  open: { label: 'OPEN', text: 'text-crit', bg: 'bg-crit', border: 'border-crit/50' },
  closed: { label: 'CLOSED', text: 'text-ok', bg: 'bg-ok', border: 'border-ok/40' },
  not_applicable: { label: 'N/A', text: 'text-slate-600', bg: 'bg-na', border: 'border-line' },
}

export const EFFORT_LABEL: Record<Effort, string> = {
  paste: 'Paste one record',
  'paste+host': 'Record + hosted file',
  provider: 'Needs mail provider',
}

export function scoreTone(score: number): string {
  if (score >= 80) return 'text-ok'
  if (score >= 50) return 'text-warn'
  return 'text-crit'
}

export function scoreBg(score: number): string {
  if (score >= 80) return 'bg-ok'
  if (score >= 50) return 'bg-warn'
  return 'bg-crit'
}
