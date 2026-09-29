// Build a CycloneDX 1.6 CBOM from the current UI state (pre- or post-patch) and download it.
import type { ScanResult } from '../api'
import type { LedgerBlock, Verification } from './ledger'
import type { CwmScore } from './cwm'

interface Algo {
  name: string
  primitive: 'signature' | 'kem' | 'key-agree'
  oid?: string
  level: number
  standard: string
  functions: string[]
}

const PATCHED: Algo[] = [
  { name: 'ML-DSA-65', primitive: 'signature', oid: '2.16.840.1.101.3.4.3.18', level: 3, standard: 'FIPS 204', functions: ['sign', 'verify'] },
  { name: 'X25519MLKEM768', primitive: 'kem', oid: '2.16.840.1.101.3.4.4.2', level: 3, standard: 'FIPS 203 (ML-KEM-768) hybrid with X25519', functions: ['encapsulate', 'decapsulate'] },
]

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

function uuid() {
  return crypto.randomUUID ? crypto.randomUUID() : '00000000-0000-4000-8000-000000000000'.replace(/0/g, () => ((Math.random() * 16) | 0).toString(16))
}

export interface CbomState {
  result: ScanResult
  patched: boolean
  cwmBefore: CwmScore | null
  cwmAfter: CwmScore | null
  block: LedgerBlock | null
  verification: Verification | null
  demo: boolean
}

export function buildCbom(s: CbomState) {
  const { result: r, patched } = s
  const algos: Algo[] = patched
    ? PATCHED
    : r.cbom_summary.map((a) => ({
        name: a.name,
        primitive: (a.primitive === 'kem' ? 'kem' : a.primitive === 'signature' ? 'signature' : 'key-agree') as Algo['primitive'],
        oid: a.oid ?? undefined,
        level: a.nist_level,
        standard: a.family,
        functions: a.primitive === 'signature' ? ['sign', 'verify'] : a.primitive === 'kem' ? ['encapsulate', 'decapsulate'] : ['keygen'],
      }))

  const algoComponents = algos.map((a) => ({
    type: 'cryptographic-asset',
    'bom-ref': `crypto/algorithm/${slug(a.name)}`,
    name: a.name,
    cryptoProperties: {
      assetType: 'algorithm',
      algorithmProperties: {
        primitive: a.primitive,
        executionEnvironment: 'software-plain-ram',
        implementationPlatform: 'generic',
        cryptoFunctions: a.functions,
        nistQuantumSecurityLevel: a.level,
      },
      ...(a.oid ? { oid: a.oid } : {}),
    },
    properties: [
      { name: 'pqc:quantum-safe', value: String(a.level > 0) },
      { name: 'pqc:standard', value: a.standard },
    ],
  }))

  const sig = algoComponents.find((c) => c.cryptoProperties.algorithmProperties.primitive === 'signature')
  const kex = algoComponents.find((c) => c.cryptoProperties.algorithmProperties.primitive !== 'signature')
  const cert = r.certificate
  const certComponent = {
    type: 'cryptographic-asset',
    'bom-ref': 'crypto/certificate/leaf',
    name: cert.subject_cn ?? r.domain,
    cryptoProperties: {
      assetType: 'certificate',
      certificateProperties: {
        subjectName: `CN=${cert.subject_cn ?? r.domain}`,
        issuerName: patched ? 'CN=ML-DSA-65 Issuing CA (simulated)' : `CN=${cert.issuer_cn ?? ''}`,
        notValidBefore: cert.not_before,
        notValidAfter: cert.not_after,
        ...(sig ? { signatureAlgorithmRef: sig['bom-ref'], subjectPublicKeyRef: sig['bom-ref'] } : {}),
        certificateFormat: 'X.509',
      },
    },
  }
  const protocol = {
    type: 'cryptographic-asset',
    'bom-ref': 'crypto/protocol/tls',
    name: `TLS @ ${r.domain}:443`,
    cryptoProperties: {
      assetType: 'protocol',
      protocolProperties: {
        type: 'tls',
        version: (r.tls.version ?? '').replace('TLS ', ''),
        cipherSuites: [{ name: r.tls.cipher_suite, algorithms: [kex?.['bom-ref'], sig?.['bom-ref']].filter(Boolean) as string[] }],
      },
    },
  }

  const cwm = patched ? s.cwmAfter : s.cwmBefore
  const properties = [
    { name: 'pqc:state', value: patched ? 'post-patch (simulated)' : 'as-scanned' },
    { name: 'pqc:scan-source', value: s.demo ? 'demo data (scanner API unreachable)' : `live TLS handshake ${r.scanned_at}` },
    ...(cwm
      ? [
          { name: 'pqc:cwm:score', value: String(cwm.score) },
          { name: 'pqc:cwm:severity', value: cwm.severity },
          { name: 'pqc:cwm:formula', value: `((X_ML ${cwm.xml} + Y ${cwm.y}) / Z ${cwm.z}) x ${cwm.exposure} x ${cwm.fragility} x 100` },
          { name: 'pqc:cwm:asset-type', value: cwm.assetType },
        ]
      : []),
    ...(s.block
      ? [
          { name: 'pqc:ledger:block', value: String(s.block.index) },
          { name: 'pqc:ledger:block-hash', value: s.block.block_hash },
          { name: 'pqc:ledger:merkle-root', value: s.block.merkle_root },
          { name: 'pqc:ledger:verified', value: String(!!s.verification?.valid) },
        ]
      : []),
  ]

  return {
    $schema: 'http://cyclonedx.org/schema/bom-1.6.schema.json',
    bomFormat: 'CycloneDX',
    specVersion: '1.6',
    serialNumber: `urn:uuid:${uuid()}`,
    version: 1,
    metadata: {
      timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
      tools: { components: [{ type: 'application', name: 'pqc-scanner', version: '1.0.0' }] },
      component: { type: 'application', 'bom-ref': r.domain, name: r.domain },
      properties,
    },
    components: [...algoComponents, certComponent, protocol],
    dependencies: [
      { ref: 'crypto/protocol/tls', dependsOn: [kex?.['bom-ref'], 'crypto/certificate/leaf'].filter(Boolean) as string[] },
      { ref: 'crypto/certificate/leaf', dependsOn: sig ? [sig['bom-ref']] : [] },
    ],
  }
}

export function downloadCbom(s: CbomState) {
  const bom = buildCbom(s)
  const url = URL.createObjectURL(new Blob([JSON.stringify(bom, null, 2)], { type: 'application/vnd.cyclonedx+json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `${s.result.domain}${s.patched ? '.patched' : ''}.cbom.cdx.json`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
