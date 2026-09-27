import type { ScanReport } from './types'

export type Channel = 'SYS' | 'DNS' | 'HTTP' | 'SMTP' | 'TLS'
export type Level = 'ok' | 'warn' | 'err' | 'info' | 'dim'

export interface LogEntry {
  ch: Channel
  level: Level
  text: string
}

const EHLO_NAME = 'scanner.securemailscope.local'
const trunc = (s: string, n = 88) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)
const pick = <T,>(items: T[]): T => items[Math.floor(Math.random() * items.length)]
const rtt = (base: number) => `${Math.round(base + Math.random() * base * 1.6)}ms`

/**
 * Replay a finished scan as a probe transcript, built from the report's real
 * observations (DNS answers, policy fetch, STARTTLS probe result). SMTP
 * exchange lines are reconstructed from the probe outcome, not a raw capture.
 */
export function scanTranscript(report: ScanReport): LogEntry[] {
  const o = report.observations
  const d = report.domain
  const out: LogEntry[] = []
  const log = (ch: Channel, level: Level, text: string) => out.push({ ch, level, text })
  const txt = (name: string, lookup: { records: string[]; error: string | null }, prefix: string) => {
    if (lookup.error) return log('DNS', 'err', `TXT ${name} → ${lookup.error}`)
    const hits = lookup.records.filter((r) => r.toLowerCase().startsWith(prefix))
    if (!hits.length) return log('DNS', 'warn', `TXT ${name} → NOERROR, no ${prefix} record`)
    hits.forEach((r) => log('DNS', 'ok', `TXT ${name} → "${trunc(r)}"`))
  }

  log('SYS', 'info', `${report.mode === 'demo' ? 'replaying demo scan' : 'scan'} target=${d}`)

  // MX
  if (o.mx.error) log('DNS', 'err', `MX ${d} → ${o.mx.error}`)
  else if (o.mx.null_mx) log('DNS', 'info', `MX ${d} → 0 . (null MX: accepts no mail)`)
  else if (!o.mx.hosts.length) log('DNS', 'warn', `MX ${d} → NOERROR, 0 answers`)
  else
    o.mx.hosts.forEach((h) => {
      log('DNS', 'ok', `MX ${d} → ${h.preference} ${h.host}`)
      log('DNS', h.addresses.length ? 'dim' : 'err', `A/AAAA ${h.host} → ${h.addresses.join(', ') || 'no address'}`)
    })

  // SPF
  txt(d, o.spf, 'v=spf1')
  if (o.spf.lookup_incomplete) log('DNS', 'warn', `spf include walk incomplete: ${o.spf.lookup_error}`)
  else if (o.spf.lookup_count != null)
    log('DNS', o.spf.lookup_count > 10 ? 'err' : 'dim', `spf include walk: ${o.spf.lookup_count}/10 lookups`)

  // DKIM
  log('DNS', 'dim', `probing ${o.dkim.selectors_tried.length} DKIM selectors`)
  o.dkim.keys.forEach((k) =>
    log('DNS', /(^|;)\s*p=\s*(;|$)/.test(k.record) ? 'warn' : 'ok', `TXT ${k.selector}._domainkey.${d} → "${trunc(k.record, 60)}"`),
  )
  if (!o.dkim.keys.length) log('DNS', 'warn', `DKIM → 0/${o.dkim.selectors_tried.length} selectors answered`)
  if (o.dkim.failed_selectors?.length)
    log('DNS', 'warn', `DKIM → ${o.dkim.failed_selectors.length} selector lookups timed out`)

  // DMARC, TLS-RPT
  txt(`_dmarc.${d}`, o.dmarc, 'v=dmarc1')
  txt(`_smtp._tls.${d}`, o.tls_rpt, 'v=tlsrptv1')

  // MTA-STS
  txt(`_mta-sts.${d}`, o.mta_sts.txt, 'v=stsv1')
  const policyUrl = `https://mta-sts.${d}/.well-known/mta-sts.txt`
  if (o.mta_sts.policy) {
    log('HTTP', 'ok', `GET ${policyUrl} → 200`)
    o.mta_sts.policy
      .trim()
      .split('\n')
      .forEach((line) => log('HTTP', 'dim', `  ${line.trim()}`))
  } else if (o.mta_sts.policy_error) log('HTTP', 'err', `GET ${policyUrl} → ${o.mta_sts.policy_error}`)

  // STARTTLS probe on port 25
  const p = o.starttls
  if (!p) log('SMTP', 'dim', 'no MX host to probe')
  else {
    log('SMTP', 'info', `connect ${p.ip ?? p.host}:${p.port} (${p.host})`)
    if (!p.reachable) log('SMTP', 'err', p.error ?? 'host unreachable')
    else {
      log('SMTP', 'dim', `S: 220 ${p.banner ?? ''}`.trim())
      log('SMTP', 'dim', `C: EHLO ${EHLO_NAME}`)
      if (p.ehlo_ok) {
        log('SMTP', 'dim', `S: 250-${p.host}`)
        log('SMTP', p.starttls_offered ? 'ok' : 'err', p.starttls_offered ? 'S: 250 STARTTLS' : 'S: 250 (STARTTLS not advertised)')
      }
      if (p.starttls_offered) {
        log('SMTP', 'dim', 'C: STARTTLS')
        if (p.tls_version) {
          log('SMTP', 'dim', 'S: 220 2.0.0 Ready to start TLS')
          const legacy = ['TLSv1', 'TLSv1.1', 'SSLv3'].includes(p.tls_version)
          log('TLS', legacy ? 'warn' : 'ok', `handshake ${p.tls_version} ${p.cipher ?? ''}`.trim())
          if (p.cert_valid) {
            const parts = [p.cert_subject && `cn=${p.cert_subject}`, p.cert_issuer && `issuer=${p.cert_issuer}`]
            log('TLS', 'ok', `cert verify OK ${parts.filter(Boolean).join(' ')}`.trim())
          } else if (p.cert_error) log('TLS', 'err', `cert verify FAILED: ${p.cert_error}`)
        } else if (p.error) log('SMTP', 'err', p.error)
      } else if (p.error) log('SMTP', 'err', p.error)
      log('SMTP', 'dim', 'C: QUIT')
    }
  }

  const open = report.attack_paths.filter((a) => a.state === 'open').length
  const tone: Level = report.score >= 80 ? 'ok' : report.score >= 50 ? 'warn' : 'err'
  log('SYS', tone, `score=${report.score} grade=${report.grade} open_paths=${open}`)
  if (report.one_fix) log('SYS', 'info', `one-fix → ${report.one_fix.record.type} ${report.one_fix.record.host}`)
  return out
}

/** One simulated monitoring line, built from the report's real hosts and records. */
export function tailEntry(report: ScanReport): LogEntry {
  const o = report.observations
  const d = report.domain
  const p = o.starttls
  const failing = report.checks.filter((c) => c.status === 'fail')
  const roll = Math.random()

  if (roll < 0.1 && failing.length) {
    const c = pick(failing)
    return { ch: 'SYS', level: 'err', text: `alert ${c.name}: ${trunc(c.summary, 80)}` }
  }
  if (roll < 0.4 && p) {
    if (!p.reachable) return { ch: 'SMTP', level: 'warn', text: `probe ${p.host}:25 → no response` }
    if (!p.starttls_offered) return { ch: 'SMTP', level: 'err', text: `probe ${p.host}:25 → 220, STARTTLS still absent` }
    if (roll < 0.25 && p.tls_version) return { ch: 'TLS', level: 'dim', text: `session ${p.tls_version} ${p.cipher ?? ''} resumed`.trim() }
    return { ch: 'SMTP', level: 'dim', text: `probe ${p.host}:25 → 220 (${rtt(30)})` }
  }
  const names = [`MX ${d}`, `TXT ${d}`, `TXT _dmarc.${d}`, `TXT _mta-sts.${d}`, `TXT _smtp._tls.${d}`]
  if (Math.random() < 0.03) return { ch: 'DNS', level: 'warn', text: `re-query ${pick(names)} → SERVFAIL, retrying` }
  return { ch: 'DNS', level: 'dim', text: `re-query ${pick(names)} → unchanged (${rtt(12)})` }
}
