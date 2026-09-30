// Exploded X-ray view: shared state plus the real math shown inside the exploded layers.
//
//   'kem'     the ML-KEM lattice core. A real ML-KEM-768 keypair is generated in this browser
//             (@noble/post-quantum); Â is re-expanded from the public seed ρ with SHAKE128 exactly as
//             FIPS 203 SampleNTT does, t̂ is decoded from the encapsulation key, and one encapsulation
//             is run so the ciphertext and shared secret are real too.
//   'merkle'  the Stage 4 ledger block: every level of the block's actual RFC 6962-style Merkle tree,
//             recomputed from its leaf hashes, plus the chained block hash.
import { useSyncExternalStore } from 'react'
import * as THREE from 'three'
import gsap from 'gsap'
import { ml_kem768 } from '@noble/post-quantum/ml-kem.js'
import { shake128 } from '@noble/hashes/sha3.js'
import { merkleLevels, type LedgerBlock } from '../lib/ledger'

export type XrayKind = 'kem' | 'merkle'

type Listener = () => void
const listeners = new Set<Listener>()

export const xray = {
  open: null as XrayKind | null,
  shown: null as XrayKind | null, // stays set while the view collapses, so the geometry can snap back
  amt: 0, // 0 assembled .. 1 exploded, tweened by GSAP
  focus: new THREE.Vector3(), // world position of the exploded object (depth-of-field focus)
}

export function subscribeXray(l: Listener) {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

export function useXray() {
  return useSyncExternalStore(subscribeXray, () => xray.open)
}

/** Explode (expo out), or snap back together with a mechanical overshoot-and-lock (back in). */
export function toggleXray(kind: XrayKind | null) {
  const next = kind && xray.open !== kind ? kind : null
  if (next === xray.open) return
  xray.open = next
  if (next) xray.shown = next
  gsap.killTweensOf(xray)
  gsap.to(xray, {
    amt: next ? 1 : 0,
    duration: next ? 1.1 : 0.55,
    ease: next ? 'expo.out' : 'back.in(2.2)',
    onComplete: () => {
      if (!xray.open) xray.shown = null
    },
  })
  listeners.forEach((l) => l())
}

if (typeof window !== 'undefined') {
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && xray.open) toggleXray(null)
  })
}

// ── ML-KEM-768 (FIPS 203) ────────────────────────────────────────────────────

const Q = 3329
const hex = (b: Uint8Array, n = b.length) => Array.from(b.slice(0, n), (x) => x.toString(16).padStart(2, '0')).join('')

/** FIPS 203 Algorithm 7, SampleNTT(ρ‖j‖i): 12-bit rejection sampling from SHAKE128; first `n` coefficients of Â[i][j]. */
function sampleNTT(rho: Uint8Array, i: number, j: number, n: number) {
  const x = shake128(new Uint8Array([...rho, j, i]), { dkLen: 168 * 2 })
  const out: number[] = []
  for (let p = 0; out.length < n && p + 2 < x.length; p += 3) {
    const d1 = x[p] + 256 * (x[p + 1] % 16)
    const d2 = (x[p + 1] >> 4) + 16 * x[p + 2]
    if (d1 < Q) out.push(d1)
    if (d2 < Q && out.length < n) out.push(d2)
  }
  return out
}

/** ByteDecode12: coefficient `k` of t̂ from the encapsulation key. */
const decode12 = (b: Uint8Array, k: number) => {
  const o = (k >> 1) * 3
  return k & 1 ? (b[o + 1] >> 4) | (b[o + 2] << 4) : b[o] | ((b[o + 1] & 15) << 8)
}

export interface KemMath {
  rho: string
  A: number[][][] // Â[i][j], first coefficients
  t: number[][] // t̂[i], first coefficients
  ekBytes: number
  dkBytes: number
  ctBytes: number
  ct: string
  ss: string
  match: boolean
}

let kem: KemMath | null = null
export function kemMath(): KemMath {
  if (kem) return kem
  const { publicKey, secretKey } = ml_kem768.keygen()
  const { cipherText, sharedSecret } = ml_kem768.encapsulate(publicKey)
  const back = ml_kem768.decapsulate(cipherText, secretKey)
  const rho = publicKey.slice(1152)
  kem = {
    rho: hex(rho),
    A: [0, 1, 2].map((i) => [0, 1, 2].map((j) => sampleNTT(rho, i, j, 4))),
    t: [0, 1, 2].map((i) => [0, 1, 2, 3].map((k) => decode12(publicKey, i * 256 + k))),
    ekBytes: publicKey.length,
    dkBytes: secretKey.length,
    ctBytes: cipherText.length,
    ct: hex(cipherText, 12),
    ss: hex(sharedSecret),
    match: hex(back) === hex(sharedSecret),
  }
  return kem
}

// ── Merkle block ─────────────────────────────────────────────────────────────

export interface MerkleMath {
  leaves: { label: string; hash: string; node: string }[] // SHA-256(record) and SHA-256(0x00‖leaf)
  inner: string[] // the level above the leaves (a node, or the promoted odd leaf)
  root: string
  block: string
  prev: string
  index: number
}

export async function merkleMath(b: LedgerBlock): Promise<MerkleMath> {
  const levels = await merkleLevels(b.leaves.map((l) => l.hash))
  return {
    leaves: b.leaves.map((l, i) => ({ label: l.label, hash: l.hash, node: levels[0][i] })),
    inner: levels[1] ?? [],
    root: levels[levels.length - 1][0],
    block: b.block_hash,
    prev: b.prev_hash,
    index: b.index,
  }
}
