// The active NIST security level (1 / 3 / 5): fixes the finalized FIPS parameter sets deployed. Chosen on the landing
// page's threat matrix or the console header's selector (one shared state) and carried into the console's Story, so the
// 3D link, the HUD readouts and the measured trade-off table all follow it. Byte sizes are the published FIPS 203 / 204 / 205 parameter-set sizes;
// "handshake" is a first-order estimate: encapsulation key + ciphertext + the leaf public key + one signature.
import type { PqSpec } from '../lib/perf'

export type NistLevel = 1 | 3 | 5

export interface Primitive {
  name: string
  std: 'FIPS 203' | 'FIPS 204' | 'FIPS 205'
  pk: number // encapsulation key / public key bytes
  out: number // ciphertext (KEM) or signature bytes
}

export interface ThreatLevel {
  id: NistLevel
  label: string // threat environment
  short: string // trade-off in one word, for the header selector
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
  /** keys into /api/bench; a missing kex measurement (ML-KEM-512) is estimated from `benchKex.from` */
  bench: { kex: string | { from: string; scale: number }; sig: string }
  /** visual weight of the payload on the 3D link: Level 1 thin and fast, Level 5 thick, dense and slower */
  flow: { density: number; thickness: number; speed: number }
}

export const NIST_LEVELS: Record<NistLevel, ThreatLevel> = {
  1: {
    id: 1,
    label: 'Enterprise Standard',
    short: 'Fast',
    level: '1/2',
    equiv: 'AES-128',
    kex: { name: 'ML-KEM-512', std: 'FIPS 203', pk: 800, out: 768 },
    sig: { name: 'ML-DSA-44', std: 'FIPS 204', pk: 1312, out: 2420 },
    kexWire: 'MLKEM512',
    sigWire: 'mldsa44',
    // this host's cryptography build has no ML-KEM-512: estimated from the measured ML-KEM-768 (k = 2 vs 3, ~0.6× the work)
    bench: { kex: { from: 'MLKEM768', scale: 0.6 }, sig: 'ML-DSA-44' },
    flow: { density: 1, thickness: 0.8, speed: 1.25 },
  },
  3: {
    id: 3,
    label: 'Critical Infrastructure',
    short: 'Standard',
    level: '3',
    equiv: 'AES-192',
    kex: { name: 'ML-KEM-768', std: 'FIPS 203', pk: 1184, out: 1088 },
    sig: { name: 'ML-DSA-65', std: 'FIPS 204', pk: 1952, out: 3309 },
    kexWire: 'MLKEM768',
    sigWire: 'mldsa65',
    bench: { kex: 'MLKEM768', sig: 'ML-DSA-65' },
    flow: { density: 1.5, thickness: 1.3, speed: 1 },
  },
  5: {
    id: 5,
    label: 'State-Level Defense',
    short: 'Maximum',
    level: '5',
    equiv: 'AES-256',
    kex: { name: 'ML-KEM-1024', std: 'FIPS 203', pk: 1568, out: 1568 },
    sig: { name: 'ML-DSA-87', std: 'FIPS 204', pk: 2592, out: 4627 },
    fallback: { name: 'SLH-DSA-SHA2-256s', std: 'FIPS 205', pk: 64, out: 29792 },
    kexWire: 'MLKEM1024',
    sigWire: 'mldsa87',
    bench: { kex: 'MLKEM1024', sig: 'ML-DSA-87' },
    flow: { density: 2, thickness: 2, speed: 0.75 },
  },
}

export const LEVEL_ORDER: NistLevel[] = [1, 3, 5]
export const DEFAULT_LEVEL: NistLevel = 5

/** Bytes on the wire attributable to the parameter sets in one handshake. */
export const handshakeBytes = (t: ThreatLevel, sig: Primitive = t.sig) => t.kex.pk + t.kex.out + sig.pk + sig.out

export const fmtBytes = (n: number) => (n >= 10_000 ? `${(n / 1024).toFixed(1)} KB` : `${n.toLocaleString('en-US')} B`)

export const levelText = (t: ThreatLevel) => `NIST Level ${t.level}`

/** The level's parameter sets as bench keys for the measured trade-off table. */
export const pqSpec = (t: ThreatLevel): PqSpec => ({
  kex: typeof t.bench.kex === 'string' ? t.bench.kex : { ...t.bench.kex, name: t.kexWire, clientShare: t.kex.pk, serverShare: t.kex.out },
  sig: t.bench.sig,
})
