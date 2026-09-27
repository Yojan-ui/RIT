// Plain-English business risk for each check, keyed by the normalised
// details.state the backend emits (see backend/app/analysis/checks.py).
// Written for someone who does not know what SPF or p=none means.

import type { CheckResult } from './types'

export interface Risk {
  /** risk: exposed now. ok: protected. neutral: not scored / not measured. */
  kind: 'risk' | 'ok' | 'neutral'
  text: string
}

const risk = (text: string): Risk => ({ kind: 'risk', text })
const ok = (text: string): Risk => ({ kind: 'ok', text })
const neutral = (text: string): Risk => ({ kind: 'neutral', text })

export function businessRisk(check: CheckResult): Risk {
  const state = typeof check.details.state === 'string' ? check.details.state : ''
  if (check.status === 'error') return neutral('Not measured: we could not check this, so it is left out of the score.')
  if (check.status === 'info' && state !== 'null') return neutral('Not applicable to how this domain uses email.')

  switch (check.id) {
    case 'spf':
      if (state === 'missing') return risk('Any server on the internet can send mail claiming to be from you.')
      if (state === 'invalid')
        return risk('Your sender list is broken, so inboxes ignore it and forged senders go unchecked.')
      if (state === 'permissive') return risk('Your sender list approves any server, so forgers pass the check.')
      if (state === 'softfail') return risk('Mail from unapproved servers is only flagged as suspicious, not blocked.')
      if (state === 'delegated')
        return risk("Your protection depends on another domain's settings, which you do not control.")
      return ok('Only servers you approve can send mail as you.')

    case 'dkim':
      if (state === 'missing')
        return risk(
          'Recipients cannot prove your emails are genuine, so a forged or altered invoice looks just as real.',
        )
      if (state === 'weak' && check.status === 'fail')
        return risk('Your signing key is weak enough to crack, letting attackers sign fake emails as you.')
      if (state === 'weak') return risk('Your signing key is below current standards and is getting easier to crack.')
      return ok('Every email carries a tamper-proof signature that proves it came from you.')

    case 'dmarc': {
      if (state === 'missing' || state === 'none')
        return risk('Anyone can perfectly spoof your domain to send phishing emails, and inboxes will deliver them.')
      const pct = Number(check.details.pct ?? 100)
      if (pct < 100) return risk(`Only ${pct}% of spoofed emails are stopped; the rest still reach inboxes.`)
      if (check.details.sp === 'none')
        return risk('Attackers can spoof any subdomain (e.g. billing.yourdomain) to phish your customers.')
      if (!check.details.rua) return risk('Spoofing is blocked, but you get no reports of who is impersonating you.')
      return ok(
        state === 'reject'
          ? 'Emails faking your domain are rejected before they reach anyone.'
          : 'Emails faking your domain are sent to spam.',
      )
    }

    case 'mx':
      if (state === 'null') return neutral('Declares that this domain never receives email.')
      if (state === 'missing') return risk('Email sent to you may bounce or be delivered unpredictably.')
      if (state === 'broken') return risk('Incoming email will bounce: customers cannot reach you.')
      if (state === 'partial')
        return risk('Some of your mail servers are unreachable, so delivery is slower and less reliable.')
      return ok('Incoming email has a working route to your servers.')

    case 'starttls':
      if (state === 'missing')
        return risk('Emails sent to you travel unencrypted; anyone on the network path can read them.')
      if (state === 'broken') return risk('Encryption fails on your mail server, so emails may be sent in plain text.')
      if (state === 'legacy_tls')
        return risk('Your mail server uses outdated encryption that attackers know how to break.')
      if (state === 'bad_cert')
        return risk("Your server's certificate is invalid, so senders cannot tell it apart from an impostor.")
      return ok('Emails sent to you are encrypted in transit.')

    case 'mta_sts':
      if (state === 'missing')
        return risk('An attacker on the network can silently switch off encryption and read your incoming email.')
      if (state === 'none') return risk('Your encryption policy is switched off, so downgrade attacks work.')
      if (state === 'testing') return risk('Attempts to strip encryption are reported, but not blocked.')
      if (state === 'broken' && check.findings.some((f) => f.includes('does not list MX')))
        return risk('Some senders will refuse to deliver to mail servers your policy forgot to list.')
      if (state === 'broken') return risk('Your encryption policy is broken, so senders ignore it.')
      return ok('Senders refuse to deliver to you unless the connection is encrypted and verified.')

    case 'tls_rpt':
      if (state === 'missing') return risk('If someone intercepts or downgrades your email, you will never be told.')
      return ok('You get daily reports whenever encrypted delivery to you fails.')
  }
}
