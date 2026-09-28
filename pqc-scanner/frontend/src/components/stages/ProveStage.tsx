import { motion } from 'framer-motion'
import { Download, FlaskConical, Loader2 } from 'lucide-react'
import type { LedgerBlock, Verification } from '../../lib/ledger'
import { Button, Callout, StageHeader, Terminal, reveal } from '../ui'

const pad = (s: string, n = 14) => s.padEnd(n, ' ')

/** Terminal-style names for verification checks ("Leaf 1 · Detect" → "leaf[0] detect"). */
function checkName(name: string) {
  const leaf = name.match(/^Leaf (\d+) · (.+)$/)
  if (leaf) return `leaf[${Number(leaf[1]) - 1}] ${leaf[2].toLowerCase()}`
  return { 'Merkle root': 'merkle_root', 'Block hash': 'block_hash', 'Chain link': 'prev_hash link' }[name] ?? name
}

export function ProveStage({ anchoring, block, verification, tampered, onAnchor, onTamperToggle }: {
  anchoring: boolean
  block: LedgerBlock | null
  verification: Verification | null
  tampered: boolean
  onAnchor: () => void
  onTamperToggle: () => void
}) {
  const download = () => {
    if (!block) return
    const blob = new Blob([JSON.stringify(block, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${block.domain}.ledger-block-${block.index}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <motion.div {...reveal}>
      <StageHeader
        n={4}
        title="Prove"
        description="Hash the detection, score and migration records with SHA-256, combine them into a Merkle root, and seal a block chained to the previous one. Any later edit breaks verification."
        action={
          !block && (
            <Button onClick={onAnchor} disabled={anchoring} icon={anchoring ? <Loader2 size={14} className="animate-spin" /> : undefined}>
              {anchoring ? 'Anchoring' : 'Anchor to Merkle ledger'}
            </Button>
          )
        }
      />

      {block && (
        <motion.div {...reveal} className="space-y-4">
          <Terminal title={`ledger · block #${block.index}`}>
            <div><span className="text-zinc-600">$ </span>ledger anchor --domain {block.domain}</div>
            <div>{pad('block')}<span className="text-white">#{block.index}</span></div>
            <div>{pad('timestamp')}{block.timestamp}</div>
            <div>{pad('prev_hash')}<span className="text-zinc-500">{block.prev_hash}</span></div>
            {block.leaves.map((l, i) => (
              <div key={l.label}>
                {pad(`leaf[${i}]`)}
                <span className="text-zinc-500">{l.label.toLowerCase().padEnd(8, ' ')}</span>
                {l.hash}
              </div>
            ))}
            <div>{pad('merkle_root')}<span className="text-white">{block.merkle_root}</span></div>
            <div>{pad('block_hash')}<span className="text-white">{block.block_hash}</span></div>
            {verification && (
              <>
                <div className="mt-3"><span className="text-zinc-600">$ </span>ledger verify #{block.index}{tampered && <span className="text-zinc-500">   # defend record altered: after.signature = RSA-2048</span>}</div>
                {verification.checks.map((c) => (
                  <div key={c.name}>
                    <span className={c.ok ? 'text-safe' : 'text-risk'}>{c.ok ? '✓' : '✗'}</span> {pad(checkName(c.name), 22)}
                    <span className="text-zinc-500">{c.ok ? 'match' : 'MISMATCH'}</span>
                  </div>
                ))}
                <div className="mt-1">
                  {pad('verified')}
                  <span className={verification.valid ? 'text-safe' : 'text-risk'}>{String(verification.valid)}</span>
                </div>
              </>
            )}
          </Terminal>

          {verification && (
            verification.valid ? (
              <Callout status="safe" title="Ledger verified">
                All leaves, the Merkle root, the block hash and the chain link were recomputed from the stored records and match. The migration record is tamper-evident.
              </Callout>
            ) : (
              <Callout status="risk" title="Verification failed">
                <span className="font-mono text-zinc-300">{verification.checks.filter((c) => !c.ok).map((c) => checkName(c.name)).join(', ')}</span> no longer match the sealed block.
              </Callout>
            )
          )}

          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" onClick={onTamperToggle} icon={<FlaskConical size={13} />}>
              {tampered ? 'Restore record' : 'Tamper test'}
            </Button>
            <Button variant="ghost" onClick={download} icon={<Download size={13} />}>Download proof</Button>
          </div>
        </motion.div>
      )}
    </motion.div>
  )
}
