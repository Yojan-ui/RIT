// Remediation engine: turns every FAIL/WARN check into ordered steps plus the
// exact records or config to deploy. Where the backend ranked a fix for the
// vector (one_fix / other_fixes) its record is used verbatim, so this list
// never disagrees with the score projection; everything else is derived from
// the same report (tags, MX hosts, probe results).

import { PATH_VECTORS, VECTOR_ORDER } from './meta'
import type { AttackPath, CheckResult, DnsRecord, Fix, ScanReport, VectorId } from './types'

export interface Artifact {
  /** Short caption, e.g. "Stage 2 · quarantine". */
  label: string
  /** dns: a zone-file line. file: a hosted file's contents. config: server config. */
  kind: 'dns' | 'file' | 'config'
  /** Where it goes: a DNS name, a URL, or a config file path. */
  target: string
  /** Exactly what to paste. */
  value: string
}

export interface Remedy {
  id: VectorId
  name: string
  status: 'fail' | 'warn'
  headline: string
  steps: string[]
  artifacts: Artifact[]
  /** Open attack paths this vector governs. */
  closes: AttackPath[]
  /** Backend fix for this vector, when it ranked one. */
  fix?: Fix
  isOneFix: boolean
  /** Changed on the mail server, not in DNS. */
  serverSide: boolean
}

type Provider = 'google' | 'microsoft' | null

const TTL = 3600
const fqdn = (host: string) => (host.endsWith('.') ? host : `${host}.`)
const quoteTxt = (type: string, value: string) => (type === 'TXT' ? `"${value}"` : value)

/** One zone-file line: `_dmarc.example.com. 3600 IN TXT "v=DMARC1; ..."`. */
export function zoneLine(record: DnsRecord): string {
  return `${fqdn(record.host)} ${TTL} IN ${record.type} ${quoteTxt(record.type, record.value)}`
}

const dns = (label: string, record: DnsRecord): Artifact => ({
  label,
  kind: 'dns',
  target: record.host,
  value: zoneLine(record),
})

function detectProvider(report: ScanReport): Provider {
  const hosts = report.observations.mx.hosts.map((h) => h.host.toLowerCase().replace(/\.$/, ''))
  if (hosts.some((h) => h.endsWith('google.com') || h.endsWith('googlemail.com'))) return 'google'
  if (hosts.some((h) => h.endsWith('outlook.com'))) return 'microsoft'
  return null
}

const str = (v: unknown) => (typeof v === 'string' ? v : undefined)
const state = (check: CheckResult) => str(check.details.state) ?? ''

/** DMARC value with ordered tags, mirroring the backend's formatting. */
function dmarcValue(tags: Record<string, string>): string {
  const ordered = ['p', 'sp', 'rua', 'ruf', 'adkim', 'aspf', 'fo']
  const parts = ordered.filter((k) => tags[k]).map((k) => `${k}=${tags[k]}`)
  for (const [k, v] of Object.entries(tags))
    if (!ordered.includes(k) && k !== 'v' && k !== 'pct') parts.push(`${k}=${v}`)
  return `v=DMARC1; ${parts.join('; ')}`
}

function policyId(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}01`
}

// --------------------------------------------------------------------------- //
// Per-vector builders. Each returns headline, steps and artifacts.
// --------------------------------------------------------------------------- //

type Built = Pick<Remedy, 'headline' | 'steps' | 'artifacts'> & { serverSide?: boolean }
type Ctx = { report: ScanReport; check: CheckResult; fix?: Fix; provider: Provider; domain: string }

function spf({ check, fix, domain, provider, report }: Ctx): Built {
  const s = state(check)
  const include =
    provider === 'google'
      ? 'include:_spf.google.com'
      : provider === 'microsoft'
        ? 'include:spf.protection.outlook.com'
        : null
  const receives = report.observations.mx.hosts.length > 0
  const base = receives ? 'v=spf1 mx' : 'v=spf1'
  const suggested = fix?.record ?? { type: 'TXT', host: domain, value: `${base}${include ? ` ${include}` : ''} -all` }

  if (s === 'invalid' && check.records.length > 1) {
    // Merge every mechanism into one record, ending in -all.
    const mechanisms = new Set<string>()
    for (const r of check.records)
      for (const t of r.split(/\s+/).slice(1)) if (!/^[-~?+]?all$/i.test(t) && !/^redirect=/i.test(t)) mechanisms.add(t)
    return {
      headline: 'Merge the duplicate SPF records into one',
      steps: [
        `Delete every existing v=spf1 TXT record on ${domain}; receivers treat more than one as a permanent error.`,
        'Publish the single merged record below.',
        'Count DNS lookups (include, a, mx, exists, redirect): keep the total at 10 or fewer.',
      ],
      artifacts: [
        dns('Merged SPF record', { type: 'TXT', host: domain, value: `v=spf1 ${[...mechanisms].join(' ')} -all` }),
      ],
    }
  }
  if (s === 'invalid') {
    return {
      headline: 'Bring SPF back under the 10-lookup limit',
      steps: [
        'List the include: mechanisms and remove any for services that no longer send as you.',
        'Replace includes for fixed-IP senders with ip4:/ip6: ranges (they cost no lookups).',
        'Keep the total of include, a, mx, exists and redirect at 10 or fewer, then republish.',
      ],
      artifacts: [
        dns('Shape of a flattened record', {
          type: 'TXT',
          host: domain,
          value: `v=spf1 ip4:<sender-ip>/32 ${include ?? 'include:<primary-provider>'} -all`,
        }),
      ],
    }
  }
  if (s === 'delegated') {
    return {
      headline: 'Confirm the redirected SPF policy ends in -all',
      steps: [
        `Look up the redirect= target's TXT record; ${domain} inherits its policy.`,
        'If it ends in ~all or ?all, replace the redirect with your own record ending in -all.',
      ],
      artifacts: [dns('Explicit record (replaces the redirect)', suggested)],
    }
  }
  const missing = s === 'missing'
  return {
    headline: missing ? 'Publish an SPF record' : 'Harden SPF to a hard fail (-all)',
    steps: [
      missing
        ? `Inventory every service that sends mail as ${domain} (mailbox provider, CRM, billing, ticketing).`
        : 'Check the listed mechanisms cover every service that sends as you.',
      `${missing ? 'Publish' : 'Replace the current record with'} the record below as a TXT on ${domain}, adding one include: per sender.`,
      'Send a test message to a Gmail address and confirm "spf=pass" in the Authentication-Results header.',
    ],
    artifacts: [dns(missing ? 'SPF record' : 'Hardened SPF record', suggested)],
  }
}

function dkim({ check, domain, provider }: Ctx): Built {
  const weak = state(check) === 'weak'
  const selectors = Array.isArray(check.details.selectors) ? (check.details.selectors as string[]) : []
  const providerStep =
    provider === 'google'
      ? 'Google Workspace: Admin console → Apps → Google Workspace → Gmail → Authenticate email → Generate new record (2048-bit).'
      : provider === 'microsoft'
        ? 'Microsoft 365: Defender portal → Email authentication settings → DKIM → select the domain → Create DKIM keys.'
        : 'Generate a 2048-bit RSA key pair in your mail provider or MTA (e.g. opendkim-genkey -b 2048 -s <selector>).'
  const artifacts: Artifact[] =
    provider === 'microsoft'
      ? [1, 2].map((n) =>
          dns(`Selector ${n} (CNAME to Microsoft)`, {
            type: 'CNAME',
            host: `selector${n}._domainkey.${domain}`,
            value: `selector${n}-${domain.replace(/\./g, '-')}._domainkey.<tenant>.onmicrosoft.com.`,
          }),
        )
      : [
          dns('Public key', {
            type: 'TXT',
            host: `${provider === 'google' ? 'google' : weak ? '<new-selector>' : '<selector>'}._domainkey.${domain}`,
            value: 'v=DKIM1; k=rsa; p=<2048-bit public key, base64>',
          }),
        ]
  if (weak)
    for (const sel of selectors)
      artifacts.push(
        dns(`Revoke old selector "${sel}" (after 7 days)`, {
          type: 'TXT',
          host: `${sel}._domainkey.${domain}`,
          value: 'v=DKIM1; p=',
        }),
      )
  return {
    headline: weak ? 'Rotate DKIM to a 2048-bit key' : 'Turn on DKIM signing',
    steps: [
      providerStep,
      `Publish the public key${weak ? ' under a new selector' : ''} in DNS as shown below.`,
      'Start signing in the provider or MTA; the DNS record alone does nothing.',
      weak
        ? 'Keep the old selector live for 7 days so in-flight mail still verifies, then revoke it with an empty p=.'
        : 'Send a test message and confirm "dkim=pass" in the Authentication-Results header.',
    ],
    artifacts,
  }
}

function dmarc({ check, fix, domain, report }: Ctx): Built {
  const s = state(check)
  const tags = (check.details.tags as Record<string, string> | undefined) ?? {}
  const rua = tags.rua ?? `mailto:dmarc-reports@${domain}`
  const mailbox = tags.rua
    ? `Confirm aggregate reports are arriving at ${rua.replace('mailto:', '')}.`
    : `Create the ${rua.replace('mailto:', '')} mailbox, or point rua= at a DMARC reporting service.`
  const host = `_dmarc.${domain}`
  // The backend's record wins for the stage it targets, so both views agree.
  const stage = (p: string) => {
    const recommended = fix && new RegExp(`; p=${p}(;|$)`).test(fix.record.value)
    return recommended
      ? dns(`Stage · p=${p} (recommended next)`, fix.record)
      : dns(`Stage · p=${p}`, { type: 'TXT', host, value: dmarcValue({ ...tags, p, sp: p, rua }) })
  }

  if (s === 'missing' || s === 'none') {
    // "v=spf1 -all" or a null MX: nothing legitimate to break, so go straight to reject.
    const sendsMail = state(report.checks.find((c) => c.id === 'spf') ?? check) !== 'no_send'
    if (!sendsMail)
      return {
        headline: 'Publish DMARC p=reject (domain sends no mail)',
        steps: [
          `${domain} declares it sends no mail, so there is no legitimate traffic to break: skip the monitoring stages.`,
          mailbox,
          `${s === 'missing' ? 'Publish' : 'Replace the existing _dmarc TXT record with'} the p=reject record below.`,
        ],
        artifacts: [stage('reject')],
      }
    return {
      headline: s === 'missing' ? 'Publish DMARC, then ramp to p=reject' : 'Move DMARC from monitoring to enforcement',
      steps: [
        ...(s === 'missing' ? ['Publish the p=none record to start receiving aggregate (rua) reports.'] : []),
        mailbox,
        'Read the reports for 2 to 4 weeks until every legitimate sender passes SPF or DKIM in alignment.',
        'Switch to p=quarantine, watch another 2 weeks, then p=reject. Replace the one TXT record each time; never publish two.',
      ],
      artifacts: [...(s === 'missing' ? [stage('none')] : []), stage('quarantine'), stage('reject')],
    }
  }
  // quarantine/reject with a gap: pct < 100, sp=none, or no rua.
  const sp = str(check.details.sp)
  const pct = Number(check.details.pct ?? 100)
  const policy = s === 'reject' ? 'reject' : 'quarantine'
  const { sp: _sp, ...inherit } = tags // sp=none is dropped so subdomains inherit p
  const fixed = fix?.record ?? {
    type: 'TXT',
    host,
    value: dmarcValue({ ...(sp === 'none' ? inherit : tags), p: policy, rua }),
  }
  return {
    headline: 'Close the gaps in the DMARC policy',
    steps: [
      ...(pct < 100 ? [`Drop pct=${pct} so the policy covers 100% of failing mail.`] : []),
      ...(sp === 'none'
        ? [`Remove sp=none so subdomains inherit p=${policy}; today every subdomain of ${domain} is spoofable.`]
        : []),
      ...(!check.details.rua ? ['Add rua= so you receive aggregate reports about who sends as you.'] : []),
      'Replace the existing _dmarc TXT record with the one below.',
    ],
    artifacts: [dns('Corrected DMARC record', fixed)],
  }
}

function mx({ check, domain, provider }: Ctx): Built {
  const s = state(check)
  const exchanges =
    provider === 'google' ? ['1 smtp.google.com.'] : [`10 mx1.<your-mail-provider>.`, `20 mx2.<your-mail-provider>.`]
  const records = exchanges.map((v, i) =>
    dns(i ? 'Backup exchanger' : 'Primary exchanger', { type: 'MX', host: domain, value: v }),
  )
  if (s === 'missing')
    return {
      headline: 'Publish MX records, or a null MX',
      steps: [
        `If ${domain} receives mail, publish your provider's MX records (below).`,
        'If it never receives mail, publish a null MX instead so senders fail fast (RFC 7505).',
      ],
      artifacts: [...records, dns('Null MX (domain accepts no mail)', { type: 'MX', host: domain, value: '0 .' })],
    }
  const unresolved = check.findings.filter((f) => f.endsWith('does not resolve to any address'))
  return {
    headline: s === 'broken' ? 'Point MX at hosts that resolve' : 'Fix or remove the MX hosts that do not resolve',
    steps: [
      ...unresolved.map(
        (f) => `${f.replace(' does not resolve to any address', '')}: add its A/AAAA record, or delete this MX.`,
      ),
      'Keep at least two MX hosts with different preferences so one outage does not bounce mail.',
    ],
    artifacts: records,
  }
}

function starttls({ check }: Ctx): Built {
  const s = state(check)
  const host = str(check.details.host) ?? '<mx-host>'
  const certbot: Artifact = {
    label: 'Certificate for the MX hostname',
    kind: 'config',
    target: 'shell',
    value: `certbot certonly --standalone -d ${host}`,
  }
  const postfix = (lines: string[]): Artifact => ({
    label: 'Postfix',
    kind: 'config',
    target: '/etc/postfix/main.cf',
    value: lines.join('\n'),
  })
  if (s === 'legacy_tls')
    return {
      serverSide: true,
      headline: `Disable TLS 1.0/1.1 on ${host}`,
      steps: [
        'Restrict inbound SMTP to TLS 1.2 and newer (RFC 8996), then reload the MTA.',
        'Rescan to confirm TLSv1.2 or TLSv1.3 is negotiated.',
      ],
      artifacts: [
        postfix(['smtpd_tls_protocols = >=TLSv1.2', 'smtpd_tls_mandatory_protocols = >=TLSv1.2']),
        {
          label: 'Exim',
          kind: 'config',
          target: 'exim.conf',
          value: 'tls_require_ciphers = SECURE128:-VERS-TLS1.0:-VERS-TLS1.1',
        },
      ],
    }
  if (s === 'bad_cert')
    return {
      serverSide: true,
      headline: `Install a valid certificate on ${host}`,
      steps: [
        `Issue a certificate whose name matches ${host} exactly, from a public CA.`,
        'Configure the MTA with the full chain (leaf + intermediates), then reload it.',
        'MTA-STS enforcement will block delivery until this passes, so fix it first.',
      ],
      artifacts: [
        certbot,
        postfix([
          `smtpd_tls_cert_file = /etc/letsencrypt/live/${host}/fullchain.pem`,
          `smtpd_tls_key_file = /etc/letsencrypt/live/${host}/privkey.pem`,
        ]),
      ],
    }
  return {
    serverSide: true,
    headline: `Enable STARTTLS on ${host}`,
    steps: [
      'This is a mail-server change, not DNS: inbound mail currently crosses the internet in cleartext.',
      `Obtain a certificate for ${host} and point the MTA at it.`,
      'Advertise STARTTLS on port 25 (opportunistic, so senders without TLS still deliver), then reload.',
      `Verify: openssl s_client -starttls smtp -connect ${host}:25 should show the certificate.`,
    ],
    artifacts: [
      certbot,
      postfix([
        `smtpd_tls_cert_file = /etc/letsencrypt/live/${host}/fullchain.pem`,
        `smtpd_tls_key_file = /etc/letsencrypt/live/${host}/privkey.pem`,
        'smtpd_tls_security_level = may',
        'smtpd_tls_protocols = >=TLSv1.2',
      ]),
    ],
  }
}

function mtaSts({ check, fix, report, domain }: Ctx): Built {
  const s = state(check)
  // Enforcing over missing STARTTLS or a bad certificate would block all inbound mail.
  const tls = report.checks.find((c) => c.id === 'starttls')
  const tlsOk = !tls || ['ok', 'unknown'].includes(state(tls))
  // Promote to enforce only from testing, or when repairing an existing enforce policy.
  const mode = tlsOk && (s === 'testing' || check.details.mode === 'enforce') ? 'enforce' : 'testing'
  const mxLines = report.observations.mx.hosts.map((h) => `mx: ${h.host.replace(/\.$/, '')}`)
  const policy = [
    'version: STSv1',
    `mode: ${mode}`,
    ...(mxLines.length ? mxLines : ['mx: <your-mx-host>']),
    `max_age: ${mode === 'enforce' ? 604800 : 86400}`,
  ].join('\n')
  const txt = fix?.record ?? { type: 'TXT', host: `_mta-sts.${domain}`, value: `v=STSv1; id=${policyId()}` }
  return {
    headline:
      mode === 'enforce'
        ? 'Switch MTA-STS from testing to enforce'
        : s === 'missing'
          ? 'Deploy MTA-STS (testing first)'
          : 'Repair the MTA-STS policy',
    steps: [
      ...(!tlsOk
        ? ['Fix STARTTLS first: enforcing MTA-STS over a broken TLS setup would block all inbound mail.']
        : []),
      `Serve the policy file over HTTPS at https://mta-sts.${domain}/.well-known/mta-sts.txt with a valid certificate for mta-sts.${domain}.`,
      'Point the mta-sts subdomain at the static host serving it.',
      `Publish the _mta-sts TXT record. Change its id= every time the policy file changes, or senders keep the cached one.`,
      mode === 'testing'
        ? 'Run in testing mode for at least a week with TLS-RPT on, then change the file to mode: enforce and max_age: 604800.'
        : 'Confirm the TLS-RPT reports show no failures, then publish the enforce policy.',
    ],
    artifacts: [
      {
        label: `Policy file (mode: ${mode})`,
        kind: 'file',
        target: `https://mta-sts.${domain}/.well-known/mta-sts.txt`,
        value: policy,
      },
      dns('Policy host', { type: 'CNAME', host: `mta-sts.${domain}`, value: '<your-static-host>.' }),
      dns('Policy discovery record', txt),
    ],
  }
}

function tlsRpt({ fix, domain }: Ctx): Built {
  const record = fix?.record ?? {
    type: 'TXT',
    host: `_smtp._tls.${domain}`,
    value: `v=TLSRPTv1; rua=mailto:tls-reports@${domain}`,
  }
  return {
    headline: 'Publish a TLS-RPT record',
    steps: [
      `Create the tls-reports@${domain} mailbox, or use an https:// endpoint from a reporting service.`,
      'Publish the TXT record below. Senders then send daily reports of failed or downgraded TLS deliveries.',
    ],
    artifacts: [dns('TLS-RPT record', record)],
  }
}

const BUILDERS: Record<VectorId, (ctx: Ctx) => Built> = {
  spf,
  dkim,
  dmarc,
  mx,
  starttls,
  mta_sts: mtaSts,
  tls_rpt: tlsRpt,
}

/** Every FAIL/WARN vector, worst first: FAIL before WARN, then by open-path severity. */
export function buildRemediation(report: ScanReport): Remedy[] {
  const provider = detectProvider(report)
  const fixes = new Map<string, Fix>(
    [...report.other_fixes, ...(report.one_fix ? [report.one_fix] : [])].map((f) => [f.id, f]),
  )
  const open = report.attack_paths.filter((p) => p.state === 'open')

  const remedies = report.checks.flatMap((check): Remedy[] => {
    if (check.status !== 'fail' && check.status !== 'warn') return []
    const fix = fixes.get(check.id)
    const built = BUILDERS[check.id]({ report, check, fix, provider, domain: report.domain })
    return [
      {
        id: check.id,
        name: check.name,
        status: check.status,
        ...built,
        closes: open.filter((p) => PATH_VECTORS[p.id]?.includes(check.id)),
        fix,
        isOneFix: report.one_fix?.id === check.id,
        serverSide: built.serverSide ?? false,
      },
    ]
  })

  const weight = (r: Remedy) => r.closes.reduce((sum, p) => sum + p.severity, 0)
  return remedies.sort(
    (a, b) =>
      Number(b.isOneFix) - Number(a.isOneFix) ||
      (a.status === b.status ? 0 : a.status === 'fail' ? -1 : 1) ||
      weight(b) - weight(a) ||
      VECTOR_ORDER.indexOf(a.id) - VECTOR_ORDER.indexOf(b.id),
  )
}
