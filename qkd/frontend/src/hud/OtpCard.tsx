import { useEffect, useMemo, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { ArrowDown, Check, Lock, Send, ShieldAlert, TriangleAlert, Wand2 } from 'lucide-react'
import type { SimResponse } from '../api'
import { GLITCH, renderByte, runOtp, toAscii, toHex } from '../lib/otp'
import { Card } from './ui'

const DEFAULT_MESSAGE = 'LAUNCH_CODE_987'

/** Decrypt animation: glyphs resolve left to right; corrupted bytes never settle. */
function Scramble({ bytes, corrupted, runKey }: { bytes: Uint8Array; corrupted: boolean[]; runKey: number }) {
  const reduced = useReducedMotion()
  const [elapsed, setElapsed] = useState(0)
  const [tick, setTick] = useState(0)
  const anyCorrupt = corrupted.some(Boolean)
  const reveal = 700

  useEffect(() => {
    if (reduced) {
      setElapsed(Infinity)
      return
    }
    const start = performance.now()
    setElapsed(0)
    const id = setInterval(() => {
      const e = performance.now() - start
      setElapsed(e)
      setTick((t) => t + 1)
      if (e > reveal + 200 && !anyCorrupt) clearInterval(id)
    }, 55)
    return () => clearInterval(id)
  }, [runKey, reduced, anyCorrupt])

  return (
    <span className="break-all">
      {Array.from(bytes, (b, i) => {
        const at = 80 + (i / Math.max(1, bytes.length)) * reveal
        if (elapsed < at) {
          return (
            <span key={i} className="text-zinc-600">
              {GLITCH[(i * 7 + tick * 13) % GLITCH.length]}
            </span>
          )
        }
        if (corrupted[i]) {
          return (
            <span key={i} className="text-q-red [text-shadow:0_0_8px_rgb(255_77_106/0.6)]">
              {reduced ? renderByte(b, i) : GLITCH[(i * 31 + tick * 17 + b) % GLITCH.length]}
            </span>
          )
        }
        return <span key={i}>{renderByte(b, i)}</span>
      })}
    </span>
  )
}

export function OtpCard({ result, onNeedBits, loading, defaultOpen }: {
  result: SimResponse | null
  onNeedBits: (bits: number) => void
  loading: boolean
  defaultOpen?: boolean
}) {
  const [draft, setDraft] = useState(DEFAULT_MESSAGE)
  const [sent, setSent] = useState<string | null>(null)
  const [runKey, setRunKey] = useState(0)
  const lastSeed = useRef<string | null>(null)

  const key = result?.key
  const aborted = key?.status === 'aborted'
  const needBits = new TextEncoder().encode(draft).length * 8
  const enough = !!key && key.length >= needBits && needBits > 0

  const run = useMemo(() => (sent && key ? runOtp(sent, key.alice_key, key.bob_key) : null), [sent, key])

  // A new key (clean ↔ attack, reseed) re-sends the same message automatically.
  useEffect(() => {
    const id = result ? `${result.seed}-${result.scenario}-${result.params.n_qubits}` : null
    if (id && id !== lastSeed.current) {
      lastSeed.current = id
      if (sent) setRunKey((k) => k + 1)
    }
  }, [result, sent])

  const send = () => {
    if (!enough) return
    setSent(draft)
    setRunKey((k) => k + 1)
  }

  const status = !run ? null : aborted ? 'aborted' : run.integrity === 1 ? 'ok' : 'degraded'

  return (
    <Card
      title="Quantum encryption test"
      icon={<Lock size={14} />}
      danger={status === 'aborted'}
      defaultOpen={defaultOpen}
      summary={
        status === 'ok' ? <span className="text-q-green">verified</span> : status === 'aborted' ? <span className="text-q-red">aborted</span> : 'one-time pad'
      }
    >
      <p className="text-xs leading-relaxed text-zinc-400">
        Encrypt a message with the sifted key as a one-time pad (XOR), then let Bob decrypt it with his copy.
      </p>

      <form
        className="mt-3 flex items-center gap-2 rounded-full border border-white/10 bg-black/30 py-1 pr-1 pl-3.5 focus-within:border-white/25"
        onSubmit={(e) => {
          e.preventDefault()
          send()
        }}
      >
        <input
          value={draft}
          onChange={(e) => setDraft(toAscii(e.target.value).slice(0, 48))}
          spellCheck={false}
          aria-label="Message to encrypt"
          placeholder="Type a message"
          className="min-w-0 flex-1 bg-transparent font-mono text-[13px] text-zinc-100 outline-none placeholder:text-zinc-600"
        />
        <button
          type="submit"
          disabled={!enough || loading}
          className="flex shrink-0 items-center gap-1.5 rounded-full bg-zinc-100 px-3 py-1.5 text-xs font-medium text-zinc-900 transition hover:bg-white disabled:opacity-40"
        >
          <Send size={12} /> Encrypt
        </button>
      </form>

      <div className="mt-1.5 flex items-center justify-between px-1 font-mono text-[10.5px] text-zinc-500">
        <span>
          needs {needBits} bits · key has {key?.length ?? 0}
        </span>
        {key && !enough && needBits > 0 && (
          <button
            onClick={() => onNeedBits(needBits)}
            disabled={loading}
            className="flex items-center gap-1 text-q-cyan hover:text-white disabled:opacity-50"
          >
            <Wand2 size={11} /> distil longer key
          </button>
        )}
      </div>

      {run && (
        <motion.div
          key={runKey}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-3 space-y-2.5 border-t border-white/[0.06] pt-3"
        >
          <div>
            <div className="eyebrow">Alice · plaintext</div>
            <div className="mt-0.5 font-mono text-[13px] break-all text-zinc-100">{sent}</div>
          </div>
          <div>
            <div className="eyebrow flex items-center gap-1">
              <ArrowDown size={10} /> Ciphertext on the public channel
            </div>
            <div className="mt-0.5 max-h-10 overflow-y-auto font-mono text-[11px] leading-relaxed break-all text-zinc-500">
              {toHex(run.cipher)}
            </div>
          </div>
          <div>
            <div className="eyebrow">{aborted ? 'Bob · decrypted with a compromised key' : 'Bob · decrypted'}</div>
            <div className={`mt-0.5 font-mono text-[13px] ${aborted ? 'text-zinc-300' : 'text-zinc-100'}`}>
              <Scramble bytes={run.bob} corrupted={run.corrupted} runKey={runKey} />
            </div>
          </div>

          {status === 'ok' && (
            <div className="flex items-center gap-2 rounded-xl bg-q-green/10 px-3 py-2 text-xs text-q-green">
              <Check size={14} />
              <span>
                Decryption successful · <span className="font-mono">100%</span> integrity
              </span>
            </div>
          )}
          {status === 'aborted' && result && (
            <div className="flex items-start gap-2 rounded-xl bg-q-red/10 px-3 py-2 text-xs leading-relaxed text-q-red">
              <ShieldAlert size={14} className="mt-px shrink-0" />
              <span>
                <b className="font-semibold">FAILED:</b> decryption aborted, Eve detected (QBER{' '}
                <span className="font-mono">{result.metrics.qber_percent}%</span>). Bob's key differs in{' '}
                <span className="font-mono">{result.key.mismatched_bits}</span> bits, corrupting{' '}
                <span className="font-mono">
                  {run.corrupted.filter(Boolean).length}/{run.corrupted.length}
                </span>{' '}
                characters.
              </span>
            </div>
          )}
          {status === 'degraded' && (
            <div className="flex items-start gap-2 rounded-xl bg-q-amber/10 px-3 py-2 text-xs leading-relaxed text-q-amber">
              <TriangleAlert size={14} className="mt-px shrink-0" />
              <span>
                Error rate stayed under the abort threshold, but <span className="font-mono">{Math.round((1 - run.integrity) * 100)}%</span> of
                characters arrived corrupted. Real systems run error correction and privacy amplification before using the key.
              </span>
            </div>
          )}
        </motion.div>
      )}
    </Card>
  )
}
