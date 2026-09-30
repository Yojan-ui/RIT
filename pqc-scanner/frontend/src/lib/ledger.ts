// A small but real Merkle ledger in the browser (Web Crypto SHA-256).
// Each anchored scan becomes a block: three stage records → Merkle root → block hash,
// chained to the previous block. Blocks persist in this browser's localStorage.

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
  records: StageRecord[]
}

export interface Verification {
  valid: boolean
  checks: { name: string; ok: boolean; detail: string }[]
}

const GENESIS = '0'.repeat(64)
const KEY = 'pqc-scanner-ledger'
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
  const block: LedgerBlock = { ...header, leaves, block_hash: await blockHash(header), records }
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
  const prev = chain.find((b) => b.index === block.index - 1)
  const expectedPrev = prev ? prev.block_hash : block.index === 0 ? GENESIS : null
  checks.push({
    name: 'Chain link',
    ok: expectedPrev === null ? true : block.prev_hash === expectedPrev,
    detail: block.index === 0 ? 'genesis block' : prev ? `links to block #${prev.index}` : 'previous block not in this browser',
  })
  return { valid: checks.every((c) => c.ok), checks }
}
