// Plain-English copy for each step, generated from the real scan and score.
import type { ScanResult } from '../api'
import { BASE_YEAR, type CryptoState, type MoscaResult } from './mosca'

export type Mood = 'neutral' | 'warn' | 'risk' | 'safe'

export interface StoryCopy {
  headline: string
  body: string
  mood: Mood
}

const lockName = (family: string) => (family === 'RSA' ? 'RSA' : family === 'ECDSA' ? 'ECDSA' : family === 'EdDSA' ? 'EdDSA' : family)

export function detectCopy(r: ScanResult, c: CryptoState): StoryCopy {
  if (c.leafPq && c.sigPq && c.kexPq) {
    return { mood: 'safe', headline: '✅ Already quantum-safe.', body: `${r.domain} already uses post-quantum locks for both its identity and its connection.` }
  }
  const lock = lockName(r.certificate.public_key.family)
  const conn = c.kexPq
    ? 'Good news: its connection encryption is already quantum-safe. Its identity lock is not.'
    : `Its connection encryption (${c.kex}) is old-style too.`
  return {
    mood: 'warn',
    headline: `⚠️ Weakness found: old ${lock} lock detected.`,
    body: `${r.domain} proves who it is with an ${c.leafKey} digital signature, the kind of lock quantum computers are designed to pick. ${conn}`,
  }
}

export function scoreCopy(m: MoscaResult): StoryCopy {
  const until = BASE_YEAR + m.sum
  const crqc = BASE_YEAR + m.z
  if (m.verdict === 'safe') {
    return { mood: 'safe', headline: '✅ Nothing here a quantum computer can forge.', body: 'Every lock on this site is already post-quantum.' }
  }
  if (m.verdict === 'window') {
    return {
      mood: 'warn',
      headline: '⏳ Safe for now, but the clock is ticking.',
      body: `The data only needs protecting until ${until}, before quantum computers are expected around ${crqc}. Upgrading still has to start now.`,
    }
  }
  return {
    mood: 'risk',
    headline: '🚨 Critical: can be forged by a quantum computer.',
    body: `What this site signs today has to stay trustworthy until ${until} (${m.y} years of data life plus ${m.x} years to upgrade). A quantum computer could forge it from ${crqc}, leaving ${m.exposedYears} years exposed.`,
  }
}

export const defendCopy: StoryCopy = {
  mood: 'safe',
  headline: '✅ Success: ML-DSA quantum lock activated.',
  body: 'In this simulation the site now proves its identity with ML-DSA-65 and encrypts connections with X25519MLKEM768. Quantum computers can’t pick either lock.',
}

export function proveCopy(blockIndex: number, valid: boolean): StoryCopy {
  return valid
    ? {
        mood: 'safe',
        headline: '🔒 Proof anchored to the ledger.',
        body: `Each step was fingerprinted and sealed into block #${blockIndex}, chained to the one before it. Change a single letter and the seal breaks.`,
      }
    : {
        mood: 'risk',
        headline: '❌ Seal broken: the record was altered.',
        body: 'Someone changed the migration record after it was sealed, and the fingerprints no longer match. That is exactly what the ledger is for.',
      }
}

export const WORKING = ['Scanning…', 'Calculating risk…', 'Upgrading…', 'Sealing…'] as const
