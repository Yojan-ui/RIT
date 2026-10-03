// The Dynamic Threat Matrix: the operator picks the threat environment, which fixes the NIST security level and the
// finalized FIPS parameter sets deployed. Chosen on the landing page and carried into the console's Story, so the 3D
// link and the HUD readouts reflect it. Byte sizes are the published FIPS 203 / 204 / 205 parameter-set sizes;
// "handshake" is a first-order estimate: encapsulation key + ciphertext + the leaf public key + one signature.

export type SecurityNecessity = 'enterprise' | 'critical' | 'state'

export interface Primitive {
  name: string
  std: 'FIPS 203' | 'FIPS 204' | 'FIPS 205'
  pk: number // encapsulation key / public key bytes
  out: number // ciphertext (KEM) or signature bytes
}

export interface ThreatLevel {
  id: SecurityNecessity
  label: string
  /** NIST security category as presented ("1/2": ML-KEM-512 is category 1, ML-DSA-44 category 2) */
  level: string
  equiv: string // classical security equivalent of the category
  kex: Primitive
  sig: Primitive
  /** conservative hash-based signature held in reserve (Level 5 only) */
  fallback?: Primitive
  /** TLS code-point names for the HUD terminal */
  kexWire: string
  sigWire: string
  /** visual weight of the payload on the 3D link (Level 1 = 1): denser, thicker, slightly slower */
  flow: { density: number; thickness: number; speed: number }
}

export const THREAT_LEVELS: Record<SecurityNecessity, ThreatLevel> = {
  enterprise: {
    id: 'enterprise',
    label: 'Enterprise Standard',
    level: '1/2',
    equiv: 'AES-128',
    kex: { name: 'ML-KEM-512', std: 'FIPS 203', pk: 800, out: 768 },
    sig: { name: 'ML-DSA-44', std: 'FIPS 204', pk: 1312, out: 2420 },
    kexWire: 'MLKEM512',
    sigWire: 'mldsa44',
    flow: { density: 1, thickness: 1, speed: 1 },
  },
  critical: {
    id: 'critical',
    label: 'Critical Infrastructure',
    level: '3',
    equiv: 'AES-192',
    kex: { name: 'ML-KEM-768', std: 'FIPS 203', pk: 1184, out: 1088 },
    sig: { name: 'ML-DSA-65', std: 'FIPS 204', pk: 1952, out: 3309 },
    kexWire: 'MLKEM768',
    sigWire: 'mldsa65',
    flow: { density: 1.5, thickness: 1.5, speed: 0.85 },
  },
  state: {
    id: 'state',
    label: 'State-Level Defense',
    level: '5',
    equiv: 'AES-256',
    kex: { name: 'ML-KEM-1024', std: 'FIPS 203', pk: 1568, out: 1568 },
    sig: { name: 'ML-DSA-87', std: 'FIPS 204', pk: 2592, out: 4627 },
    fallback: { name: 'SLH-DSA-SHA2-256s', std: 'FIPS 205', pk: 64, out: 29792 },
    kexWire: 'MLKEM1024',
    sigWire: 'mldsa87',
    flow: { density: 2, thickness: 2, speed: 0.7 },
  },
}

export const NECESSITY_ORDER: SecurityNecessity[] = ['enterprise', 'critical', 'state']
export const DEFAULT_NECESSITY: SecurityNecessity = 'critical'

/** Bytes on the wire attributable to the parameter sets in one handshake. */
export const handshakeBytes = (t: ThreatLevel, sig: Primitive = t.sig) => t.kex.pk + t.kex.out + sig.pk + sig.out

export const fmtBytes = (n: number) => (n >= 10_000 ? `${(n / 1024).toFixed(1)} KB` : `${n.toLocaleString('en-US')} B`)

export const levelText = (t: ThreatLevel) => `NIST Level ${t.level}`
