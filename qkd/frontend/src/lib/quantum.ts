import type { Basis, Qubit, Vec3 } from '../api'

export const BASIS_COLOR: Record<Basis, string> = { '+': '#5ee7f7', x: '#b39dff' }
export const RED = '#ff4d6a'
export const AMBER = '#fbbf24'
export const GREEN = '#4ade80'

export const basisGlyph = (b: Basis | null) => (b === 'x' ? '×' : b === '+' ? '+' : '·')

export function stateLabel(bit: number, basis: Basis) {
  if (basis === '+') return bit ? '|1⟩' : '|0⟩'
  return bit ? '|−⟩' : '|+⟩'
}

export function blochOf(bit: number, basis: Basis): Vec3 {
  if (basis === '+') return [0, 0, bit ? -1 : 1]
  return [bit ? -1 : 1, 0, 0]
}

/** Physical polarisation angle of a BB84 photon: H=0°, V=90°, D=45°, A=135°. */
export function polarizationDeg(bit: number, basis: Basis) {
  if (basis === '+') return bit ? 90 : 0
  return bit ? 135 : 45
}

/** The state Bob actually receives: Eve's re-prepared one if she intercepted it. */
export function incoming(q: Qubit): { bit: number; basis: Basis } {
  if (q.intercepted && q.eve_basis && q.eve_bit !== null) return { bit: q.eve_bit, basis: q.eve_basis }
  return { bit: q.alice_bit, basis: q.alice_basis }
}

export type Verdict = 'key' | 'sample' | 'error' | 'discarded'

export function verdict(q: Qubit): Verdict {
  if (!q.bases_match) return 'discarded'
  if (q.error) return 'error'
  return q.role === 'sample' ? 'sample' : 'key'
}

export const VERDICT_TEXT: Record<Verdict, string> = {
  key: 'Bases match · kept as key bit',
  sample: 'Bases match · revealed for error check',
  error: 'Bases match but bits differ · error',
  discarded: 'Bases differ · discarded',
}

export const VERDICT_COLOR: Record<Verdict, string> = {
  key: GREEN,
  sample: AMBER,
  error: RED,
  discarded: '#52525b',
}
