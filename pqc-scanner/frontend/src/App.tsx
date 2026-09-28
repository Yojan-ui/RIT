import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { ArrowRight, Loader2, RotateCcw } from 'lucide-react'
import { scanDomain, type ScanResult } from './api'
import { CryptoCore, type CoreState } from './scene/CryptoCore'
import { DefendDetails, DetectDetails, ProveDetails, ScoreDetails } from './components/advanced'
import { cryptoFromScan, mosca, MIGRATED } from './lib/mosca'
import { anchor, verify, type LedgerBlock, type Verification } from './lib/ledger'
import { WORKING, defendCopy, detectCopy, proveCopy, scoreCopy, type Mood, type StoryCopy } from './lib/story'

const EXAMPLES = ['github.com', 'cloudflare.com', 'microsoft.com']
const STEP_NAMES = ['Detect', 'Score', 'Defend', 'Prove'] as const
const WORKING_BODY = [
  (d: string) => `Opening a live, encrypted connection to ${d} and reading which locks it uses.`,
  () => 'Comparing how long this data must stay safe with when quantum computers are expected.',
  () => 'Swapping the old lock for a quantum-safe ML-DSA lock (simulation).',
  () => 'Fingerprinting every step with SHA-256 and chaining it into the ledger.',
]
const ACTIONS = ['Calculate risk', 'Upgrade to Quantum-Safe', 'Seal the Record'] as const
const MOOD_DOT: Record<Mood, string> = { neutral: 'bg-zinc-400', warn: 'bg-warn', risk: 'bg-risk', safe: 'bg-safe' }
const MOOD_LABEL: Record<Mood, string> = { neutral: 'Working', warn: 'Weakness', risk: 'Critical', safe: 'Secure' }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function loadAdvanced() {
  try {
    return localStorage.getItem('pqc-advanced') === '1'
  } catch {
    return false
  }
}

export default function App() {
  const [query, setQuery] = useState(() => new URLSearchParams(location.search).get('domain') ?? '')
  const [result, setResult] = useState<ScanResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState(0) // steps completed
  const [working, setWorking] = useState<number | null>(null) // step currently running
  const [view, setView] = useState(1)
  const [x, setX] = useState(4)
  const [y, setY] = useState(10)
  const [block, setBlock] = useState<LedgerBlock | null>(null)
  const [verification, setVerification] = useState<Verification | null>(null)
  const [tampered, setTampered] = useState(false)
  const [advanced, setAdvanced] = useState(loadAdvanced)
  const [shock, setShock] = useState(0)
  const abort = useRef<AbortController | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const before = useMemo(() => (result ? cryptoFromScan(result) : null), [result])
  const m = useMemo(() => (before ? mosca(x, y, before) : null), [before, x, y])

  useEffect(() => {
    try {
      localStorage.setItem('pqc-advanced', advanced ? '1' : '0')
    } catch {
      /* ignore */
    }
  }, [advanced])

  const scan = useCallback(async (raw: string) => {
    const domain = raw.trim()
    if (!domain) return
    abort.current?.abort()
    const ctrl = new AbortController()
    abort.current = ctrl
    setError(null)
    setResult(null)
    setProgress(0)
    setBlock(null)
    setVerification(null)
    setTampered(false)
    setView(1)
    setWorking(1)
    const url = new URL(location.href)
    url.searchParams.set('domain', domain)
    history.replaceState(null, '', url)
    try {
      const [res] = await Promise.all([scanDomain(domain, ctrl.signal), sleep(1800)])
      if (ctrl.signal.aborted) return
      setResult(res)
      setProgress(1)
      setWorking(null)
    } catch (e) {
      if ((e as Error).name === 'AbortError') return
      setError((e as Error).message)
      setWorking(null)
    }
  }, [])

  const booted = useRef(false)
  useEffect(() => {
    if (booted.current) return
    booted.current = true
    if (query) scan(query)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const records = () =>
    result && before && m
      ? [
          {
            label: 'Detect',
            data: {
              domain: result.domain,
              scanned_at: result.scanned_at,
              tls: { version: result.tls.version, cipher: result.tls.cipher_suite, group: result.tls.key_exchange.group },
              certificate: { cn: result.certificate.subject_cn, issuer: result.certificate.issuer_cn, not_after: result.certificate.not_after, public_key: result.certificate.public_key.name, signature: result.certificate.signature.name },
              cbom_serial: result.cbom.serialNumber,
              cbom: result.cbom_summary.map((r) => ({ name: r.name, quantum_safe: r.quantum_safe })),
            },
          },
          { label: 'Score', data: { method: 'Mosca X + Y > Z', x: m.x, y: m.y, z: m.z, verdict: m.verdict, rows: m.rows.map(({ role, algorithm, verdict }) => ({ role, algorithm, verdict })) } },
          { label: 'Defend', data: { simulated: true, before, after: MIGRATED, standards: ['FIPS 204 ML-DSA-65', 'FIPS 203 ML-KEM-768 (X25519MLKEM768)'] } },
        ]
      : []

  const advance = async () => {
    if (!result) return
    const next = progress + 1
    setView(next)
    setWorking(next)
    if (next === 2) await sleep(1500)
    if (next === 3) await sleep(2400)
    if (next === 4) {
      const [b] = await Promise.all([anchor(result.domain, records()), sleep(1400)])
      setBlock(b)
      setVerification(await verify(b))
      setShock((s) => s + 1)
    }
    setProgress(next)
    setWorking(null)
  }

  const toggleTamper = async () => {
    if (!block) return
    if (tampered) {
      setVerification(await verify(block))
      setTampered(false)
      return
    }
    const forged: LedgerBlock = structuredClone(block)
    ;(forged.records[2].data as { after: { signature: string } }).after.signature = 'RSA-2048'
    setVerification(await verify(forged))
    setTampered(true)
  }

  const reset = () => {
    abort.current?.abort()
    setResult(null)
    setProgress(0)
    setWorking(null)
    setError(null)
    setQuery('')
    history.replaceState(null, '', location.pathname)
    setTimeout(() => inputRef.current?.focus(), 50)
  }

  // Copy for each completed step
  const copies: (StoryCopy | null)[] = [
    result && before ? detectCopy(result, before) : null,
    m ? scoreCopy(m) : null,
    defendCopy,
    block && verification ? proveCopy(block.index, verification.valid) : null,
  ]

  // The 3D core tells the same story
  const core: CoreState = (() => {
    if (working === 1) return 'scanning'
    if (!result) return 'idle'
    if (working === 3) return 'upgrading'
    if (progress >= 3 || working === 4) return 'secured'
    if (progress >= 2 && m) return m.verdict === 'critical' ? 'critical' : m.verdict === 'safe' ? 'secured' : 'vulnerable'
    return copies[0]?.mood === 'safe' ? 'secured' : 'vulnerable'
  })()

  const inStory = working !== null || result !== null
  const isWorking = working === view
  const copy = !isWorking ? copies[view - 1] : null
  const domain = result?.domain ?? query.trim()

  return (
    <div className="relative h-dvh overflow-hidden bg-black text-white">
      <div className="fixed inset-0" aria-hidden>
        <CryptoCore state={core} shockKey={shock} />
      </div>
      <div className="pointer-events-none fixed inset-0 bg-gradient-to-r from-black/75 via-black/25 to-transparent max-lg:bg-gradient-to-t" aria-hidden />

      {/* Top bar */}
      <header className="absolute inset-x-0 top-0 z-20 flex items-center justify-between px-6 py-5 lg:px-12">
        <button onClick={reset} className="flex items-center gap-2.5" aria-label="Start over">
          <svg viewBox="0 0 20 20" className="size-5" aria-hidden>
            <circle cx="10" cy="10" r="8" fill="none" stroke="white" strokeWidth="1.3" />
            <path d="M2 10h16M10 2c3 2.5 3 13.5 0 16M10 2c-3 2.5-3 13.5 0 16" stroke="white" strokeWidth="1" fill="none" opacity="0.6" />
          </svg>
          <span className="text-[14px] font-medium">PQC Scanner</span>
        </button>
        <label className="flex cursor-pointer items-center gap-3 rounded-full border border-white/10 bg-black/40 py-1.5 pr-1.5 pl-3.5 text-[13px] text-zinc-300 backdrop-blur-xl">
          Advanced technical view
          <button
            role="switch"
            aria-checked={advanced}
            onClick={() => setAdvanced((a) => !a)}
            className={`relative h-5 w-9 rounded-full transition-colors duration-200 ${advanced ? 'bg-white' : 'bg-white/15'}`}
          >
            <span className={`absolute top-0.5 size-4 rounded-full transition-all duration-200 ${advanced ? 'left-[18px] bg-black' : 'left-0.5 bg-white'}`} />
          </button>
        </label>
      </header>

      {/* Story column */}
      <main className="relative z-10 h-full overflow-y-auto">
        <div className="flex min-h-full flex-col justify-end px-6 pt-[46vh] pb-32 lg:justify-center lg:px-12 lg:pt-24">
          <div className="w-full max-w-[600px]">
            {!inStory ? (
              <motion.section key="hero" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: [0.2, 0, 0, 1] }}>
                <p className="text-[13px] font-medium tracking-wide text-zinc-400">A live check in 4 steps</p>
                <h1 className="mt-3 text-4xl leading-[1.05] font-semibold tracking-[-0.035em] sm:text-6xl">Is your website ready for quantum computers?</h1>
                <p className="mt-5 max-w-lg text-lg leading-relaxed text-zinc-300">
                  Quantum computers will be able to pick today's digital locks. Enter a website and we'll find its weak lock, show the risk, fix it, and prove it.
                </p>
                <form
                  className="mt-8 flex max-w-lg gap-2 rounded-xl border border-white/10 bg-black/40 p-1.5 backdrop-blur-xl focus-within:border-white/25"
                  onSubmit={(e) => {
                    e.preventDefault()
                    scan(query)
                  }}
                >
                  <input
                    ref={inputRef}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="e.g. github.com"
                    aria-label="Website to check"
                    autoFocus
                    spellCheck={false}
                    autoCapitalize="none"
                    className="min-w-0 flex-1 bg-transparent px-3 text-[16px] text-white outline-none placeholder:text-zinc-500"
                  />
                  <button type="submit" disabled={!query.trim()} className="inline-flex h-11 items-center gap-2 rounded-lg bg-white px-5 text-[15px] font-semibold text-black transition-colors hover:bg-zinc-200 disabled:opacity-40">
                    Scan <ArrowRight size={16} />
                  </button>
                </form>
                <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-zinc-500">
                  Try
                  {EXAMPLES.map((d) => (
                    <button key={d} onClick={() => { setQuery(d); scan(d) }} className="font-mono text-zinc-400 transition-colors hover:text-white">
                      {d}
                    </button>
                  ))}
                </div>
                {error && (
                  <p className="mt-6 flex items-center gap-2 text-[15px] text-zinc-200" role="alert">
                    <span className="size-2 rounded-full bg-risk" /> {error}
                  </p>
                )}
              </motion.section>
            ) : (
              <>
                <motion.section
                  key={`${view}-${isWorking ? 'w' : copy?.headline}`}
                  initial={{ opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.35, ease: [0.2, 0, 0, 1] }}
                  className="rounded-2xl border border-white/10 bg-black/40 p-7 backdrop-blur-xl sm:p-9"
                  aria-live="polite"
                >
                  <div className="flex items-center gap-3 text-[13px] text-zinc-400">
                    <span className="font-medium tracking-wide">Step {view} · {STEP_NAMES[view - 1]}</span>
                    <span className="text-zinc-600">/</span>
                    <span className="font-mono">{domain}</span>
                    {copy && (
                      <span className="ml-auto inline-flex items-center gap-2 rounded-full border border-white/10 px-2.5 py-0.5 text-[12px] text-zinc-300">
                        <span className={`size-1.5 rounded-full ${MOOD_DOT[copy.mood]}`} /> {MOOD_LABEL[copy.mood]}
                      </span>
                    )}
                  </div>

                  {isWorking ? (
                    <>
                      <h2 className="mt-5 flex items-center gap-4 text-4xl leading-tight font-semibold tracking-[-0.03em] sm:text-5xl">
                        <Loader2 className="size-9 shrink-0 animate-spin text-zinc-400" strokeWidth={1.5} />
                        {WORKING[view - 1]}
                      </h2>
                      <p className="mt-4 text-lg leading-relaxed text-zinc-300">{WORKING_BODY[view - 1](domain)}</p>
                    </>
                  ) : copy ? (
                    <>
                      <h2 className="mt-5 text-3xl leading-[1.12] font-semibold tracking-[-0.03em] text-balance sm:text-[44px]">{copy.headline}</h2>
                      <p className="mt-4 text-lg leading-relaxed text-zinc-300">{copy.body}</p>
                      {view === 3 && <p className="mt-3 text-[13px] text-zinc-500">Simulated: nothing was changed on the real website.</p>}
                      {view === 4 && <p className="mt-3 text-[13px] text-zinc-500">Real SHA-256 fingerprints, stored in this browser's ledger.</p>}

                      <div className="mt-8 flex flex-wrap items-center gap-3">
                        {view === progress && progress < 4 && (
                          <button
                            onClick={advance}
                            className="inline-flex h-12 items-center gap-2.5 rounded-lg bg-white px-6 text-[16px] font-semibold text-black transition-colors hover:bg-zinc-200"
                          >
                            {ACTIONS[progress - 1]} <ArrowRight size={18} />
                          </button>
                        )}
                        {view < progress && (
                          <button onClick={() => setView(progress)} className="inline-flex h-12 items-center gap-2 rounded-lg border border-white/15 px-5 text-[15px] text-zinc-200 hover:bg-white/5">
                            Back to step {progress} <ArrowRight size={16} />
                          </button>
                        )}
                        {progress === 4 && view === 4 && (
                          <button onClick={reset} className="inline-flex h-12 items-center gap-2 rounded-lg border border-white/15 px-5 text-[15px] text-zinc-200 hover:bg-white/5">
                            <RotateCcw size={16} /> Check another website
                          </button>
                        )}
                      </div>
                    </>
                  ) : null}
                </motion.section>

                {advanced && result && before && m && !isWorking && view <= progress && (
                  <motion.section
                    key={`adv-${view}`}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3, delay: 0.05 }}
                    className="mt-4 rounded-2xl border border-white/10 bg-black/40 p-6 backdrop-blur-xl"
                  >
                    {view === 1 && <DetectDetails result={result} migrated={progress >= 3} />}
                    {view === 2 && <ScoreDetails m={m} x={x} y={y} setX={setX} setY={setY} />}
                    {view === 3 && <DefendDetails domain={result.domain} before={before} done={progress >= 3} />}
                    {view === 4 && block && <ProveDetails block={block} verification={verification} tampered={tampered} onTamperToggle={toggleTamper} />}
                  </motion.section>
                )}
              </>
            )}
          </div>
        </div>
      </main>

      {/* Playback bar */}
      {inStory && (
        <nav
          aria-label="Progress"
          className="fixed inset-x-4 bottom-5 z-20 mx-auto flex max-w-2xl items-center gap-2 rounded-2xl border border-white/10 bg-black/50 p-2 backdrop-blur-xl sm:inset-x-6 lg:right-12 lg:left-auto lg:mx-0 lg:w-[min(560px,calc(100vw-700px))]"
        >
          {STEP_NAMES.map((name, i) => {
            const n = i + 1
            const done = n <= progress
            const running = working === n
            const current = n === view
            return (
              <button
                key={name}
                disabled={!done}
                onClick={() => setView(n)}
                aria-current={current ? 'step' : undefined}
                className={`group flex-1 rounded-xl px-3 py-2 text-left transition-colors ${current ? 'bg-white/[0.08]' : done ? 'hover:bg-white/[0.04]' : ''} disabled:cursor-default`}
              >
                <div className="flex items-center gap-2 text-[12px]">
                  <span className={`font-mono ${done || running ? 'text-white' : 'text-zinc-600'}`}>0{n}</span>
                  <span className={`font-medium ${done || running ? 'text-zinc-200' : 'text-zinc-600'}`}>{name}</span>
                  {done && copies[i] && <span className={`ml-auto size-1.5 rounded-full ${MOOD_DOT[copies[i]!.mood]}`} />}
                </div>
                <div className="mt-2 h-[3px] overflow-hidden rounded-full bg-white/10">
                  <motion.div
                    className="h-full rounded-full bg-white"
                    initial={false}
                    animate={{ width: done ? '100%' : running ? '70%' : '0%' }}
                    transition={{ duration: running ? 1.4 : 0.4, ease: [0.2, 0, 0, 1] }}
                  />
                </div>
              </button>
            )
          })}
        </nav>
      )}
    </div>
  )
}
