import { AnimatePresence, motion } from 'framer-motion'
import { BadgeCheck, Download, FlaskConical, Link2, Loader2, ShieldX } from 'lucide-react'
import { forwardRef, useEffect, useState } from 'react'
import type { LedgerBlock, Verification } from '../../lib/ledger'
import { NextButton, Stage, type StageStatus } from '../ui'

const HEX = '0123456789abcdef'

/** Hex that scrambles, then locks in left to right. */
function HashText({ value, active }: { value: string; active: boolean }) {
  const [shown, setShown] = useState(value)
  useEffect(() => {
    if (!active) {
      setShown(value)
      return
    }
    let frame = 0
    const id = setInterval(() => {
      frame++
      const locked = Math.floor((frame / 18) * value.length)
      setShown(value.slice(0, locked) + Array.from({ length: value.length - locked }, () => HEX[(Math.random() * 16) | 0]).join(''))
      if (locked >= value.length) clearInterval(id)
    }, 40)
    return () => clearInterval(id)
  }, [value, active])
  return <span className="font-mono break-all">{shown}</span>
}

function Row({ label, value, animate, strong }: { label: string; value: string; animate: boolean; strong?: boolean }) {
  return (
    <div className="grid gap-1 border-b border-white/[0.05] py-2 last:border-0 sm:grid-cols-[150px_1fr] sm:gap-4">
      <div className="text-xs text-zinc-500">{label}</div>
      <div className={`text-[12.5px] ${strong ? 'text-emerald-300' : 'text-zinc-300'}`}>
        <HashText value={value} active={animate} />
      </div>
    </div>
  )
}

export const ProveStage = forwardRef<HTMLElement, {
  status: StageStatus
  anchoring: boolean
  block: LedgerBlock | null
  verification: Verification | null
  tampered: boolean
  onAnchor: () => void
  onTamperToggle: () => void
}>(function ProveStage({ status, anchoring, block, verification, tampered, onAnchor, onTamperToggle }, ref) {
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
    <Stage ref={ref} n={4} title="Prove" subtitle="anchor to a Merkle ledger" status={status} accent="#f0abfc">
      <p className="text-sm text-zinc-400">
        The detection, the Mosca score and the migration are each hashed (SHA-256), combined into a Merkle root, and sealed in a block
        chained to the previous one. Change a single byte of any stage and verification fails.
      </p>

      {!block && (
        <div className="mt-5 flex justify-center">
          <NextButton onClick={onAnchor} tone="sky" disabled={anchoring} icon={anchoring ? <Loader2 size={20} className="animate-spin" /> : <Link2 size={20} />}>
            {anchoring ? 'Hashing…' : 'Anchor to Merkle Ledger'}
          </NextButton>
        </div>
      )}

      <AnimatePresence>
        {block && (
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ type: 'spring', stiffness: 150, damping: 20 }}>
            <div className="mt-5 overflow-hidden rounded-2xl ring-1 ring-white/10">
              <div className="flex items-center justify-between bg-white/[0.05] px-4 py-2.5">
                <span className="font-mono text-sm text-zinc-200">Block #{block.index}</span>
                <span className="font-mono text-xs text-zinc-500">{new Date(block.timestamp).toLocaleString()}</span>
              </div>
              <div className="bg-black/30 px-4 py-2">
                <Row label="Previous block" value={block.prev_hash} animate={false} />
                {block.leaves.map((l) => (
                  <Row key={l.label} label={`Leaf · ${l.label}`} value={l.hash} animate />
                ))}
                <Row label="Merkle root" value={block.merkle_root} animate />
                <Row label="Block hash (SHA-256)" value={block.block_hash} animate strong />
              </div>
            </div>

            {verification && (
              <motion.div
                key={String(verification.valid)}
                initial={{ opacity: 0, scale: 0.94 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ type: 'spring', stiffness: 260, damping: 18, delay: tampered ? 0 : 0.8 }}
                className={`mt-4 flex items-center gap-4 rounded-2xl p-5 ring-2 ${verification.valid ? 'bg-emerald-400/10 ring-emerald-400/60' : 'bg-rose-600/15 ring-rose-500/70'}`}
              >
                {verification.valid ? <BadgeCheck className="shrink-0 text-emerald-300" size={40} /> : <ShieldX className="shrink-0 text-rose-400" size={40} />}
                <div className="min-w-0">
                  <div className={`text-xl font-black tracking-tight sm:text-2xl ${verification.valid ? 'text-emerald-300' : 'text-rose-300'}`}>
                    {verification.valid ? 'LEDGER VERIFIED' : 'VERIFICATION FAILED'}
                  </div>
                  <p className={`mt-1 text-sm ${verification.valid ? 'text-emerald-100/80' : 'text-rose-100/80'}`}>
                    {verification.valid
                      ? 'Every leaf, the Merkle root, the block hash and the chain link were recomputed from the stored records and match. The migration record is immutable.'
                      : `Tampered record detected: ${verification.checks.filter((c) => !c.ok).map((c) => c.name).join(', ')} no longer match.`}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {verification.checks.map((c) => (
                      <span key={c.name} className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${c.ok ? 'bg-emerald-400/10 text-emerald-300' : 'bg-rose-500/20 text-rose-300'}`}>
                        {c.ok ? '✓' : '✗'} {c.name}
                      </span>
                    ))}
                  </div>
                </div>
              </motion.div>
            )}

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                onClick={onTamperToggle}
                className="inline-flex items-center gap-2 rounded-full border border-white/10 px-3 py-1.5 text-xs font-medium text-zinc-300 transition hover:border-white/25 hover:text-white"
              >
                <FlaskConical size={13} /> {tampered ? 'Undo tamper and re-verify' : 'Tamper test: alter the migration record'}
              </button>
              <button
                onClick={download}
                className="inline-flex items-center gap-2 rounded-full border border-white/10 px-3 py-1.5 text-xs font-medium text-zinc-300 transition hover:border-white/25 hover:text-white"
              >
                <Download size={13} /> Download proof (JSON)
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Stage>
  )
})
