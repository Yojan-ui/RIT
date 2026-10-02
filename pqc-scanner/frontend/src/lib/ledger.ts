// A small but real Merkle ledger in the browser (Web Crypto SHA-256).
// Each anchored scan becomes a block: three stage records → Merkle root → block hash,
// chained to the previous block, then hybrid-signed: Ed25519 (classical) AND ML-DSA-65 (FIPS 204)
// over the block hash, so a forger has to break both. Blocks persist in this browser's localStorage.

import { ed25519 } from '@noble/curves/ed25519.js'
import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js'

export interface StageRecord {
  label: string
  data: unknown
}

export interface LedgerBlock {
  index: number
  timestamp: string
  domain: string
  prev_hash: string
  merkle_root: string
  leaves: { label: string; hash: string }[]
  block_hash: string
  /** absent only on blocks anchored before signing existed; those fail verification */
  signature?: HybridSignature
  records: StageRecord[]
}

export const SIG_ALG = 'Ed25519+ML-DSA-65'

export interface HybridSignature {
  alg: typeof SIG_ALG
  /** SHA-256(ed25519_pk ‖ mldsa_pk): the console's signing identity */
  signer: string
  ed25519_pk: string
  ed25519_sig: string
  mldsa_pk: string
  mldsa_sig: string
}

export interface Verification {
  valid: boolean
  checks: { name: string; ok: boolean; detail: string }[]
}

const GENESIS = '0'.repeat(64)
const KEY = 'pqc-scanner-ledger'
const SIGNER_KEY = 'pqc-scanner-ledger-signer'
// domain separation: these keys sign ledger block hashes and nothing else
const SIG_CONTEXT = 'QuantumLedger/v1/block-hash'
const enc = new TextEncoder()

/** Deterministic JSON: object keys sorted at every level. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>
    return `{${Object.keys(obj).sort().map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`).join(',')}}`
  }
  return JSON.stringify(value ?? null)
}

const hex = (buf: ArrayBuffer) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('')
const fromHex = (h: string) => Uint8Array.from(h.match(/../g)!.map((b) => parseInt(b, 16)))

export async function sha256(data: string | Uint8Array): Promise<string> {
  const bytes = typeof data === 'string' ? enc.encode(data) : data
  return hex(await crypto.subtle.digest('SHA-256', bytes as BufferSource))
}

/**
 * Every level of the RFC 6962-style Merkle tree, leaves first: 0x00-prefixed leaves, 0x01-prefixed nodes,
 * odd node promoted. The last level holds the root.
 */
export async function merkleLevels(leafHashes: string[]): Promise<string[][]> {
  const prefixed = (p: number, ...parts: string[]) => {
    const out = new Uint8Array(1 + parts.length * 32)
    out[0] = p
    parts.forEach((h, i) => out.set(fromHex(h), 1 + i * 32))
    return out
  }
  let level = await Promise.all(leafHashes.map((h) => sha256(prefixed(0, h))))
  const levels = [level]
  while (level.length > 1) {
    const next: string[] = []
    for (let i = 0; i < level.length; i += 2) next.push(i + 1 < level.length ? await sha256(prefixed(1, level[i], level[i + 1])) : level[i])
    level = next
    levels.push(level)
  }
  return levels
}

export async function merkleRoot(leafHashes: string[]): Promise<string> {
  const levels = await merkleLevels(leafHashes)
  return levels[levels.length - 1][0] ?? (await sha256(''))
}

const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  parts.reduce((o, p) => (out.set(p, o), o + p.length), 0)
  return out
}
const toSign = (blockHashHex: string) => concat(enc.encode(`${SIG_CONTEXT}\0`), fromHex(blockHashHex))

interface Signer {
  ed: { secretKey: Uint8Array; publicKey: Uint8Array }
  dsa: { secretKey: Uint8Array; publicKey: Uint8Array }
  fingerprint: string
}
let signer: Signer | null = null

/** Two 32-byte seeds in localStorage; both keypairs are re-derived from them (ML-DSA keygen is deterministic). */
function storedSeeds(): { ed: Uint8Array; dsa: Uint8Array } | null {
  try {
    const raw = localStorage.getItem(SIGNER_KEY)
    if (!raw) return null
    const { ed, dsa } = JSON.parse(raw) as { ed: string; dsa: string }
    return { ed: fromHex(ed), dsa: fromHex(dsa) }
  } catch {
    return null
  }
}

async function fromSeeds(seeds: { ed: Uint8Array; dsa: Uint8Array }): Promise<Signer> {
  const ed = { secretKey: seeds.ed, publicKey: ed25519.getPublicKey(seeds.ed) }
  const dsa = ml_dsa65.keygen(seeds.dsa)
  return { ed, dsa, fingerprint: await sha256(concat(ed.publicKey, dsa.publicKey)) }
}

/** This console's signing identity, created on first anchor. Without storage it lives for the session only. */
async function getSigner(): Promise<Signer> {
  if (signer) return signer
  let seeds = storedSeeds()
  if (!seeds) {
    seeds = { ed: crypto.getRandomValues(new Uint8Array(32)), dsa: crypto.getRandomValues(new Uint8Array(32)) }
    try {
      localStorage.setItem(SIGNER_KEY, JSON.stringify({ ed: hex(seeds.ed.buffer as ArrayBuffer), dsa: hex(seeds.dsa.buffer as ArrayBuffer) }))
    } catch {
      /* private mode: session-only key */
    }
  }
  return (signer = await fromSeeds(seeds))
}

/** Fingerprint of this browser's pinned signer, without creating one. */
async function pinnedFingerprint(): Promise<string | null> {
  if (signer) return signer.fingerprint
  const seeds = storedSeeds()
  return seeds ? (signer = await fromSeeds(seeds)).fingerprint : null
}

async function sign(blockHashHex: string): Promise<HybridSignature> {
  const k = await getSigner()
  const msg = toSign(blockHashHex)
  const h = (b: Uint8Array) => hex(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer)
  return {
    alg: SIG_ALG,
    signer: k.fingerprint,
    ed25519_pk: h(k.ed.publicKey),
    ed25519_sig: h(ed25519.sign(msg, k.ed.secretKey)),
    mldsa_pk: h(k.dsa.publicKey),
    mldsa_sig: h(ml_dsa65.sign(msg, k.dsa.secretKey)),
  }
}

async function blockHash(b: Omit<LedgerBlock, 'block_hash' | 'records' | 'leaves'>) {
  return sha256(canonical({ index: b.index, timestamp: b.timestamp, domain: b.domain, prev_hash: b.prev_hash, merkle_root: b.merkle_root }))
}

export function loadChain(): LedgerBlock[] {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as LedgerBlock[]) : []
  } catch {
    return []
  }
}

function saveChain(chain: LedgerBlock[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(chain.slice(-50)))
  } catch {
    /* storage unavailable (private mode): the block still exists for this session */
  }
}

export async function anchor(domain: string, records: StageRecord[]): Promise<LedgerBlock> {
  const chain = loadChain()
  const prev = chain[chain.length - 1]
  const leaves = await Promise.all(records.map(async (r) => ({ label: r.label, hash: await sha256(canonical(r.data)) })))
  const merkle_root = await merkleRoot(leaves.map((l) => l.hash))
  const header = { index: (prev?.index ?? -1) + 1, timestamp: new Date().toISOString(), domain, prev_hash: prev?.block_hash ?? GENESIS, merkle_root }
  const block_hash = await blockHash(header)
  const block: LedgerBlock = { ...header, leaves, block_hash, signature: await sign(block_hash), records }
  saveChain([...chain, block])
  return block
}

/** Recompute every hash from the stored records and check the link to the previous block. */
export async function verify(block: LedgerBlock, chain = loadChain()): Promise<Verification> {
  const checks: Verification['checks'] = []
  const leafHashes = await Promise.all(block.records.map((r) => sha256(canonical(r.data))))
  leafHashes.forEach((h, i) =>
    checks.push({ name: `Leaf ${i + 1} · ${block.records[i].label}`, ok: h === block.leaves[i]?.hash, detail: h }),
  )
  const root = await merkleRoot(leafHashes)
  checks.push({ name: 'Merkle root', ok: root === block.merkle_root, detail: root })
  const bh = await blockHash(block)
  checks.push({ name: 'Block hash', ok: bh === block.block_hash, detail: bh })
  checks.push(...(await verifySignature(block)))
  const prev = chain.find((b) => b.index === block.index - 1)
  const expectedPrev = prev ? prev.block_hash : block.index === 0 ? GENESIS : null
  checks.push({
    name: 'Chain link',
    ok: expectedPrev === null ? true : block.prev_hash === expectedPrev,
    detail: block.index === 0 ? 'genesis block' : prev ? `links to block #${prev.index}` : 'previous block not in this browser',
  })
  return { valid: checks.every((c) => c.ok), checks }
}

/** Both signatures must verify over the stored block hash (AND composition), and the signer must be this console. */
async function verifySignature(block: LedgerBlock): Promise<Verification['checks']> {
  const sig = block.signature
  if (!sig) return [{ name: 'Hybrid signature', ok: false, detail: 'unsigned block (anchored before ledger signing)' }]
  const msg = toSign(block.block_hash)
  const check = (f: () => boolean) => {
    try {
      return f()
    } catch {
      return false // malformed key or signature bytes
    }
  }
  const edOk = check(() => ed25519.verify(fromHex(sig.ed25519_sig), msg, fromHex(sig.ed25519_pk)))
  const dsaOk = check(() => ml_dsa65.verify(fromHex(sig.mldsa_sig), msg, fromHex(sig.mldsa_pk)))
  const fp = await sha256(concat(fromHex(sig.ed25519_pk), fromHex(sig.mldsa_pk)))
  const pinned = await pinnedFingerprint()
  const signerOk = fp === sig.signer && (pinned === null || pinned === fp)
  return [
    { name: 'Ed25519 signature', ok: edOk, detail: `${sig.ed25519_sig.slice(0, 32)}… (64 B, classical)` },
    { name: 'ML-DSA-65 signature', ok: dsaOk, detail: `${sig.mldsa_sig.slice(0, 32)}… (${sig.mldsa_sig.length / 2} B, FIPS 204)` },
    {
      name: 'Signer key',
      ok: signerOk,
      detail: fp !== sig.signer ? 'fingerprint does not match the embedded keys' : pinned === null ? `${fp.slice(0, 16)}… (signer not pinned in this browser)` : pinned === fp ? `${fp.slice(0, 16)}… pinned console key` : `${fp.slice(0, 16)}… is not this console's key`,
    },
  ]
}
