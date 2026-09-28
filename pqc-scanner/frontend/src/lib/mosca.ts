import type { ScanResult } from '../api'

/** Mosca's inequality: if X + Y > Z, quantum-vulnerable crypto protects things past the day a CRQC arrives. */
export const Z_YEARS = 7 // years to a cryptographically relevant quantum computer (2033 lower bound)
export const BASE_YEAR = 2026

export type AlgoVerdict = 'safe' | 'forgeable' | 'readable' | 'window'

export interface AlgoRow {
  role: string
  algorithm: string
  pq: boolean
  verdict: AlgoVerdict
  why: string
}

export interface MoscaResult {
  x: number // migration time
  y: number // data / signature shelf life
  z: number
  sum: number
  holds: boolean // X + Y > Z
  exposedYears: number
  verdict: 'critical' | 'window' | 'safe'
  rows: AlgoRow[]
}

export interface CryptoState {
  kex: string
  kexPq: boolean
  leafKey: string
  leafPq: boolean
  signature: string
  sigPq: boolean
}

export function cryptoFromScan(r: ScanResult): CryptoState {
  const pqFamilies = ['ML-DSA', 'SLH-DSA']
  return {
    kex: r.tls.key_exchange.group ?? 'unknown',
    kexPq: r.tls.key_exchange.pq_hybrid,
    leafKey: r.certificate.public_key.name,
    leafPq: pqFamilies.includes(r.certificate.public_key.family),
    signature: r.certificate.signature.name,
    sigPq: pqFamilies.includes(r.certificate.signature.family),
  }
}

export const MIGRATED: CryptoState = {
  kex: 'X25519MLKEM768',
  kexPq: true,
  leafKey: 'ML-DSA-65',
  leafPq: true,
  signature: 'ML-DSA-65',
  sigPq: true,
}

export function mosca(x: number, y: number, c: CryptoState, z = Z_YEARS): MoscaResult {
  const sum = x + y
  const holds = sum > z
  const row = (role: string, algorithm: string, pq: boolean, harm: 'forgeable' | 'readable'): AlgoRow => {
    if (pq) return { role, algorithm, pq, verdict: 'safe', why: 'Post-quantum: not broken by Shor’s algorithm.' }
    if (!holds) return { role, algorithm, pq, verdict: 'window', why: `Shor-vulnerable, but X + Y ≤ Z: migration finishes before a CRQC.` }
    return harm === 'forgeable'
      ? { role, algorithm, pq, verdict: 'forgeable', why: `A CRQC in ${BASE_YEAR + z} could forge ${algorithm} signatures that must stay trusted until ${BASE_YEAR + sum}.` }
      : { role, algorithm, pq, verdict: 'readable', why: `Traffic recorded today stays sensitive until ${BASE_YEAR + sum}; a CRQC in ${BASE_YEAR + z} could decrypt it.` }
  }
  const rows = [
    row('Key exchange', c.kex, c.kexPq, 'readable'),
    row('Server key', c.leafKey, c.leafPq, 'forgeable'),
    row('Certificate signature', c.signature, c.sigPq, 'forgeable'),
  ]
  const anyExposed = rows.some((r) => r.verdict === 'forgeable' || r.verdict === 'readable')
  const allPq = rows.every((r) => r.pq)
  return {
    x, y, z, sum, holds,
    exposedYears: Math.max(0, sum - z),
    verdict: allPq ? 'safe' : anyExposed ? 'critical' : 'window',
    rows,
  }
}
