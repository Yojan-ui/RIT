// Plain-English diagnosis and a concrete action plan, derived from the live scan.
import type { ScanResult } from '../api'
import type { CryptoState } from './mosca'

export interface Diagnosis {
  headline: string
  meaning: string
  tone: 'risk' | 'warn' | 'safe'
}

export interface PlanItem {
  id: 'cert' | 'kex' | 'tls' | 'ledger'
  title: string
  detail: string
  standard: string
  /** Already compliant before we touched anything. */
  preexisting: boolean
}

export function diagnose(r: ScanResult, c: CryptoState, fixed: boolean): Diagnosis {
  if (fixed) {
    return {
      tone: 'safe',
      headline: `${r.domain} is now protected by an ML-DSA-65 quantum lock.`,
      meaning:
        'Its identity is signed with a post-quantum algorithm and its connections use hybrid ML-KEM, so neither can be forged or unlocked by a quantum computer. (Simulated deployment.)',
    }
  }
  if (c.leafPq && c.sigPq && c.kexPq) {
    return { tone: 'safe', headline: `${r.domain} is already quantum-safe.`, meaning: 'Both its identity signatures and its connection encryption use post-quantum algorithms. No action needed.' }
  }
  const meaning = [
    'A quantum computer could forge your digital signatures and issue fake certificates in your name, letting attackers impersonate this site.',
    c.kexPq
      ? 'Your connection encryption is already quantum-safe, so traffic recorded today stays private.'
      : 'It could also unlock traffic recorded today, because the connection encryption is classical too.',
  ].join(' ')
  return {
    tone: c.kexPq ? 'warn' : 'risk',
    headline: `${r.domain} is using an outdated ${c.leafKey} lock.`,
    meaning,
  }
}

export function actionPlan(r: ScanResult, c: CryptoState): PlanItem[] {
  const items: PlanItem[] = []
  if (r.tls.version !== 'TLS 1.3') {
    items.push({ id: 'tls', title: 'Enable TLS 1.3', detail: `Currently ${r.tls.version}. Hybrid post-quantum key exchange requires TLS 1.3.`, standard: 'RFC 8446', preexisting: false })
  }
  items.push({
    id: 'cert',
    title: c.leafPq ? 'Certificate already uses ML-DSA' : `Replace the ${c.leafKey} certificate with ML-DSA-65`,
    detail: c.leafPq ? `${c.leafKey} is post-quantum.` : `Re-issue ${r.domain}'s certificate with an ML-DSA-65 key and signature.`,
    standard: 'FIPS 204',
    preexisting: c.leafPq && c.sigPq,
  })
  items.push({
    id: 'kex',
    title: c.kexPq ? `Hybrid key exchange already enabled (${c.kex})` : 'Enable hybrid X25519MLKEM768 key exchange',
    detail: c.kexPq ? 'The server already negotiates a post-quantum group.' : `Currently ${c.kex}. Add X25519MLKEM768 ahead of X25519 in the server's TLS groups.`,
    standard: 'FIPS 203',
    preexisting: c.kexPq,
  })
  items.push({ id: 'ledger', title: 'Anchor the remediation proof to the ledger', detail: 'SHA-256 Merkle block, chained to previous remediations.', standard: 'Audit trail', preexisting: false })
  return items
}

/** The algorithms that failed, for the "vulnerability" section. */
export function failures(r: ScanResult) {
  return r.cbom_summary.filter((a) => !a.quantum_safe)
}
