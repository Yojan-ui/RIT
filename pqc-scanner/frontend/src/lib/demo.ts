// Offline fallback: a representative classical endpoint, used only when the scanner API is unreachable.
import type { ScanResult } from '../api'

export function demoScan(domain: string): ScanResult {
  const now = new Date()
  const notBefore = new Date(now.getTime() - 40 * 864e5).toISOString()
  const notAfter = new Date(now.getTime() + 325 * 864e5).toISOString()
  const cbom_summary = [
    { name: 'x25519', primitive: 'key-agree', oid: '1.3.101.110', nist_level: 0, quantum_safe: false, classification: "Vulnerable to Shor's Algorithm (0% PQC Ready)", family: 'Classical (EC)DH' },
    { name: 'RSA-2048', primitive: 'signature', oid: '1.2.840.113549.1.1.1', nist_level: 0, quantum_safe: false, classification: "Vulnerable to Shor's Algorithm (0% PQC Ready)", family: 'RSA' },
    { name: 'sha256WithRSAEncryption', primitive: 'signature', oid: '1.2.840.113549.1.1.11', nist_level: 0, quantum_safe: false, classification: "Vulnerable to Shor's Algorithm (0% PQC Ready)", family: 'RSA' },
  ]
  return {
    domain,
    resolved_ip: '203.0.113.10',
    scanned_at: now.toISOString().slice(0, 19) + 'Z',
    duration_ms: 0,
    cached: false,
    tls: {
      version: 'TLS 1.3',
      cipher_suite: 'TLS_AES_256_GCM_SHA384',
      key_exchange: { group: 'x25519', group_code: '0x001D', pq_hybrid: false, offered: ['X25519MLKEM768', 'x25519', 'secp256r1'], hello_retry: false, method: '(EC)DHE / KEM', notes: ['Demo data: the scanner API was unreachable.'] },
    },
    certificate: {
      subject_cn: domain,
      issuer_cn: 'Demo Issuing CA',
      issuer_org: 'Demo',
      not_before: notBefore,
      not_after: notAfter,
      days_remaining: 325,
      sans: [domain],
      san_count: 1,
      public_key: { family: 'RSA', name: 'RSA-2048', bits: 2048, oid: '1.2.840.113549.1.1.1' },
      signature: { family: 'RSA', name: 'sha256WithRSAEncryption', oid: '1.2.840.113549.1.1.11' },
      trusted: true,
      verify_error: null,
      chain: [],
    },
    assessment: {
      score: 10,
      grade: 'D',
      status: 'classical',
      color: 'amber',
      badge: 'CRITICAL',
      headline: 'CRITICAL: RSA-2048 detected - Forgeable by CRQC · no post-quantum key exchange',
      urgency: { level: 'HIGH', reason: 'Session keys use classical (EC)DH.', deadline: 'Now: hybrid ML-KEM is deployable today in OpenSSL 3.5+' },
      breakdown: [],
      recommendations: [],
      max_achievable_today: 60,
    },
    cbom_summary,
    cbom: { bomFormat: 'CycloneDX', specVersion: '1.6', serialNumber: `urn:uuid:demo-${now.getTime()}`, version: 1, metadata: { component: { name: domain } }, components: [] },
  }
}
