import type { CheckStatus, Exposure, Grade } from '@/api/types'

/** One vocabulary for colour: every status maps to a meaning, and the theme maps meaning to colour. */
export type Tone = 'secure' | 'partial' | 'vulnerable' | 'unknown'

export const STATUS_TONE: Record<CheckStatus, Tone> = {
  pass: 'secure',
  warn: 'partial',
  fail: 'vulnerable',
  missing: 'vulnerable',
  error: 'vulnerable',
  not_assessed: 'unknown',
}

export const EXPOSURE_TONE: Record<Exposure, Tone> = {
  mitigated: 'secure',
  partial: 'partial',
  exposed: 'vulnerable',
  unknown: 'unknown',
}

export const GRADE_TONE: Record<Grade, Tone> = { A: 'secure', B: 'secure', C: 'partial', D: 'vulnerable', F: 'vulnerable' }

export const TEXT: Record<Tone, string> = {
  secure: 'text-secure',
  partial: 'text-partial',
  vulnerable: 'text-vulnerable',
  unknown: 'text-unknown',
}

export const HEX: Record<Tone, string> = {
  secure: '#33ff88',
  partial: '#ffb020',
  vulnerable: '#ff3b30',
  unknown: '#8b95a5',
}

export const STATUS_LABEL: Record<CheckStatus, string> = {
  pass: 'PASS',
  warn: 'WEAK',
  fail: 'FAIL',
  missing: 'MISSING',
  error: 'ERROR',
  not_assessed: 'N/A',
}

export const EXPOSURE_LABEL: Record<Exposure, string> = {
  exposed: 'OPEN',
  partial: 'PARTIAL',
  mitigated: 'DEFENDED',
  unknown: 'N/A',
}

export const CONTROL_LABEL: Record<string, string> = {
  mx: 'MX',
  spf: 'SPF',
  dkim: 'DKIM',
  dmarc: 'DMARC',
  mta_sts: 'MTA-STS',
  tls_rpt: 'TLS-RPT',
  transport: 'STARTTLS',
  bimi: 'BIMI',
  dnssec: 'DNSSEC',
}
