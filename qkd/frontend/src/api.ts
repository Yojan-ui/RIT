// Types mirror the payload built by qkd/app/bb84.py.

export type Basis = '+' | 'x'
export type Vec3 = [number, number, number]

export interface Qubit {
  index: number
  alice_bit: number
  alice_basis: Basis
  alice_state: string
  alice_bloch: Vec3
  intercepted: boolean
  eve_basis: Basis | null
  eve_bit: number | null
  eve_resent_state: string | null
  eve_bloch: Vec3 | null
  state_disturbed: boolean
  bob_basis: Basis
  bob_bit: number
  bases_match: boolean
  role: 'key' | 'sample' | 'discarded'
  error: boolean
}

export interface SimResponse {
  scenario: 'clean' | 'attack'
  seed: number
  params: {
    n_qubits: number
    intercept_rate: number
    channel_noise: number
    sample_fraction: number
    qber_threshold: number
  }
  alice: { bits: string; bases: string }
  bob: { bits: string; bases: string }
  eve: {
    active: boolean
    intercepted_count: number
    wrong_basis_count: number
    known_final_key_bits: number
  }
  sifting: {
    matching_bases: number
    sifted_length: number
    sifted_indices: number[]
    sample_indices: number[]
    key_indices: number[]
  }
  metrics: {
    qber: number
    qber_percent: number
    sample_errors: number
    sample_size: number
    true_qber: number
    expected_qber: number
    threshold: number
    eavesdropper_detected: boolean
  }
  key: {
    status: 'established' | 'aborted'
    length: number
    alice_key: string
    bob_key: string
    alice_key_hex: string
    bob_key_hex: string
    keys_match: boolean
    mismatched_bits: number
    final_key: string | null
  }
  qubits: Qubit[]
  circuit: { num_qubits: number; depth: number; gate_counts: Record<string, number>; simulator: string }
  elapsed_ms: number
}

export interface SimParams {
  n_qubits: number
  channel_noise: number
  seed?: number
  intercept_rate?: number
}

export interface Health {
  status: string
  qiskit: string
  qiskit_aer: string
}

// Empty base = same origin; Vite proxies /api to http://localhost:8100.
const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? ''

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`${res.status} ${res.statusText}${text ? `: ${text.slice(0, 200)}` : ''}`)
  }
  return res.json() as Promise<T>
}

export const simulateClean = (p: SimParams) =>
  request<SimResponse>('/api/simulate-clean', { method: 'POST', body: JSON.stringify(p) })

export const simulateAttack = (p: SimParams) =>
  request<SimResponse>('/api/simulate-attack', { method: 'POST', body: JSON.stringify(p) })

export const getHealth = () => request<Health>('/api/health')
