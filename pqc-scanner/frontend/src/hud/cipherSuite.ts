// The cipher suite the operator evaluates: picked on the landing page, carried into the console's Story so the
// 3D link and the HUD readouts reflect it. Byte sizes are the published parameter-set sizes (FIPS 203 / 204 / 205,
// RFC 7748 / 8032); "handshake" is a first-order estimate: both key shares + the leaf public key + one signature.

export type CipherSuiteId = 'classical' | 'hybrid' | 'max'

export interface Primitive {
  role: 'kex' | 'sig'
  name: string
  std: string
  pk: number // public key / encapsulation key bytes
  out: number // ciphertext (kex) or signature (sig) bytes
}

export interface CipherSuite {
  id: CipherSuiteId
  label: string
  tag: string
  kex: Primitive
  sig: Primitive
  /** NIST post-quantum security category; 0 = breakable by Shor */
  level: 0 | 3 | 5
  /** short wire names for the HUD terminal */
  kexWire: string
  sigWire: string
  /** visual weight of the payload on the 3D link (classical = 1) */
  flow: { density: number; thickness: number; speed: number }
}

export const CIPHER_SUITES: Record<CipherSuiteId, CipherSuite> = {
  classical: {
    id: 'classical',
    label: 'Classical',
    tag: 'Legacy',
    kex: { role: 'kex', name: 'X25519', std: 'RFC 7748', pk: 32, out: 32 },
    sig: { role: 'sig', name: 'RSA-2048', std: 'PKCS #1', pk: 256, out: 256 },
    level: 0,
    kexWire: 'x25519',
    sigWire: 'rsa_pss_rsae_sha256',
    flow: { density: 1, thickness: 1, speed: 1 },
  },
  hybrid: {
    id: 'hybrid',
    label: 'Hybrid PQC',
    tag: 'Recommended',
    kex: { role: 'kex', name: 'X25519 + ML-KEM-768', std: 'FIPS 203', pk: 32 + 1184, out: 32 + 1088 },
    sig: { role: 'sig', name: 'Ed25519 + ML-DSA-65', std: 'FIPS 204', pk: 32 + 1952, out: 64 + 3309 },
    level: 3,
    kexWire: 'X25519MLKEM768',
    sigWire: 'ed25519+mldsa65',
    flow: { density: 1.5, thickness: 1.25, speed: 1.2 },
  },
  max: {
    id: 'max',
    label: 'Maximum PQC',
    tag: 'Hash-based',
    kex: { role: 'kex', name: 'ML-KEM-1024', std: 'FIPS 203', pk: 1568, out: 1568 },
    sig: { role: 'sig', name: 'SLH-DSA-SHA2-256s', std: 'FIPS 205', pk: 64, out: 29792 },
    level: 5,
    kexWire: 'MLKEM1024',
    sigWire: 'slhdsa_sha2_256s',
    flow: { density: 2, thickness: 1.5, speed: 1.4 },
  },
}

export const SUITE_ORDER: CipherSuiteId[] = ['classical', 'hybrid', 'max']
export const DEFAULT_SUITE: CipherSuiteId = 'hybrid'

/** The suite the simulated patch deploys: the chosen one, or the recommended hybrid if a legacy suite was chosen. */
export const remedy = (id: CipherSuiteId) => CIPHER_SUITES[id === 'classical' ? 'hybrid' : id]

/** Bytes on the wire attributable to the suite in one handshake (key shares + leaf key + one signature). */
export const handshakeBytes = (s: CipherSuite) => s.kex.pk + s.kex.out + s.sig.pk + s.sig.out

export const fmtBytes = (n: number) => (n >= 10_000 ? `${(n / 1024).toFixed(1)} KB` : `${n.toLocaleString('en-US')} B`)

export const levelText = (s: CipherSuite) => (s.level ? `NIST Level ${s.level}` : 'Shor-breakable')
