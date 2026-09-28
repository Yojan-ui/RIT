import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { ArrowRight, Check, Loader2 } from 'lucide-react'
import { scanDomain, type ScanResult, type Tone } from './api'
import { CipherGlobe, type Phase } from './scene/CipherGlobe'
import { Button, Callout, Dot, TONE_STATUS, reveal, type Status } from './components/ui'
import { DetectStage } from './components/stages/DetectStage'
import { ScoreStage } from './components/stages/ScoreStage'
import { DefendStage, MIGRATE_MS, type MigrationPhase } from './components/stages/DefendStage'
import { ProveStage } from './components/stages/ProveStage'
import { MIGRATED, cryptoFromScan, mosca, type MoscaResult } from './lib/mosca'
import { anchor, verify, type LedgerBlock, type Verification } from './lib/ledger'

const EXAMPLES = ['cloudflare.com', 'google.com', 'github.com', 'microsoft.com']
const STEPS = ['Resolving address', 'Sending ClientHello with X25519MLKEM768', 'Reading ServerHello key share', 'Fetching certificate chain', 'Building CBOM']
const MIN_SCAN_MS = 1200
const MOSCA_TONE: Record<MoscaResult['verdict'], Tone> = { critical: 'crimson', window: 'amber', safe: 'emerald' }
const SUMMARY: Record<ScanResult['assessment']['status'], string> = {
  'quantum-ready': 'Quantum ready',
  hybrid: 'Hybrid PQ key exchange · classical certificate',
  classical: 'Classical key exchange and certificate',
  legacy: 'Legacy TLS configuration',
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export default function App() {
  const [query, setQuery] = useState(() => new URLSearchParams(location.search).get('domain') ?? '')
  const [scanning, setScanning] = useState(false)
  const [result, setResult] = useState<ScanResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [step, setStep] = useState(0)

  const [active, setActive] = useState(1)
  const [unlocked, setUnlocked] = useState(1)
  const [x, setX] = useState(4)
  const [y, setY] = useState(10)
  const [scored, setScored] = useState(false)
  const [migration, setMigration] = useState<MigrationPhase>('idle')
  const [block, setBlock] = useState<LedgerBlock | null>(null)
  const [verification, setVerification] = useState<Verification | null>(null)
  const [anchoring, setAnchoring] = useState(false)
  const [tampered, setTampered] = useState(false)
  const [pulse, setPulse] = useState(0)

  const abort = useRef<AbortController | null>(null)
  const resultsRef = useRef<HTMLDivElement>(null)

  const before = useMemo(() => (result ? cryptoFromScan(result) : null), [result])
  const preview = useMemo(() => (before ? mosca(x, y, before) : null), [before, x, y])
  const moscaResult = scored ? preview : null
  const migrated = migration === 'done'

  const scan = useCallback(async (raw: string) => {
    const domain = raw.trim()
    if (!domain) return
    abort.current?.abort()
    const ctrl = new AbortController()
    abort.current = ctrl
    setError(null)
    setScanning(true)
    setStep(0)
    const url = new URL(location.href)
    url.searchParams.set('domain', domain)
    history.replaceState(null, '', url)
    try {
      const [res] = await Promise.all([scanDomain(domain, ctrl.signal), sleep(MIN_SCAN_MS)])
      if (ctrl.signal.aborted) return
      setActive(1)
      setUnlocked(1)
      setScored(false)
      setMigration('idle')
      setBlock(null)
      setVerification(null)
      setTampered(false)
      setResult(res)
      setScanning(false)
      setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 120)
    } catch (e) {
      if ((e as Error).name === 'AbortError') return
      setError((e as Error).message)
      setScanning(false)
    }
  }, [])

  useEffect(() => {
    if (!scanning) return
    const id = setInterval(() => setStep((s) => Math.min(STEPS.length - 1, s + 1)), 300)
    return () => clearInterval(id)
  }, [scanning])

  const booted = useRef(false)
  useEffect(() => {
    if (booted.current) return
    booted.current = true
    if (query) scan(query)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const go = (n: number) => {
    setUnlocked((u) => Math.max(u, n))
    setActive(n)
    resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const calculate = () => {
    setScored(true)
    setPulse((p) => p + 1)
  }

  const migrate = async () => {
    setMigration('migrating')
    await sleep(MIGRATE_MS)
    setMigration('done')
  }

  const records = () => {
    if (!result || !before || !preview) return []
    return [
      {
        label: 'Detect',
        data: {
          domain: result.domain,
          scanned_at: result.scanned_at,
          tls: { version: result.tls.version, cipher: result.tls.cipher_suite, group: result.tls.key_exchange.group },
          certificate: {
            cn: result.certificate.subject_cn,
            issuer: result.certificate.issuer_cn,
            not_after: result.certificate.not_after,
            public_key: result.certificate.public_key.name,
            signature: result.certificate.signature.name,
          },
          cbom_serial: result.cbom.serialNumber,
          cbom: result.cbom_summary.map((r) => ({ name: r.name, quantum_safe: r.quantum_safe })),
        },
      },
      {
        label: 'Score',
        data: { method: 'Mosca X + Y > Z', x: preview.x, y: preview.y, z: preview.z, verdict: preview.verdict, rows: preview.rows.map(({ role, algorithm, verdict }) => ({ role, algorithm, verdict })) },
      },
      { label: 'Defend', data: { simulated: true, before, after: MIGRATED, standards: ['FIPS 204 ML-DSA-65', 'FIPS 203 ML-KEM-768 (X25519MLKEM768)'] } },
    ]
  }

  const anchorToLedger = async () => {
    if (!result) return
    setAnchoring(true)
    const [b] = await Promise.all([anchor(result.domain, records()), sleep(450)])
    setBlock(b)
    setVerification(await verify(b))
    setAnchoring(false)
    setPulse((p) => p + 1)
  }

  const toggleTamper = async () => {
    if (!block) return
    if (tampered) {
      setVerification(await verify(block))
      setTampered(false)
      return
    }
    // Rewrite history ("migrated to RSA-2048") without touching any hash.
    const forged: LedgerBlock = structuredClone(block)
    ;(forged.records[2].data as { after: { signature: string } }).after.signature = 'RSA-2048'
    setVerification(await verify(forged))
    setTampered(true)
  }

  // Globe accent follows the story: scan verdict → Mosca verdict → migrated.
  const globeTone: Tone | null = !result ? null : migrated ? 'emerald' : moscaResult ? MOSCA_TONE[moscaResult.verdict] : result.assessment.color
  const globePhase: Phase = scanning || migration === 'migrating' ? 'scanning' : result ? 'result' : 'idle'

  const stepsMeta: { title: string; sub: string; status: Status; done: boolean }[] = result && before
    ? [
        { title: 'Detect', sub: `${result.cbom_summary.length} algorithms · ${before.kex}`, status: TONE_STATUS[result.assessment.color], done: unlocked > 1 },
        {
          title: 'Score',
          sub: moscaResult ? (moscaResult.verdict === 'critical' ? 'Critical · forgeable' : moscaResult.verdict === 'safe' ? 'Safe' : 'Within window') : 'X + Y > Z',
          status: moscaResult ? TONE_STATUS[MOSCA_TONE[moscaResult.verdict]] : 'idle',
          done: !!moscaResult,
        },
        { title: 'Defend', sub: migrated ? 'Migrated · simulated' : 'ML-DSA-65 · X25519MLKEM768', status: migrated ? 'safe' : 'idle', done: migrated },
        {
          title: 'Prove',
          sub: verification ? (verification.valid ? `Verified · block #${block?.index}` : 'Verification failed') : 'Merkle ledger',
          status: verification ? (verification.valid ? 'safe' : 'risk') : 'idle',
          done: !!verification?.valid,
        },
      ]
    : []

  return (
    <div className="relative min-h-full overflow-x-clip bg-black">
      {/* Calm WebGL backdrop */}
      <div className="pointer-events-none fixed inset-0" aria-hidden>
        <div className="absolute top-0 left-1/2 aspect-square w-[min(1100px,140vw)] -translate-x-1/2 -translate-y-[12%] opacity-80 [mask-image:radial-gradient(circle_at_center,black_30%,transparent_68%)]">
          <CipherGlobe phase={globePhase} tone={globeTone} pulseKey={pulse} />
        </div>
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-black/40 to-black" />
      </div>

      <header className="relative z-10 border-b border-white/10 bg-black/40 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
          <div className="flex items-center gap-2.5">
            <svg viewBox="0 0 20 20" className="size-5" aria-hidden>
              <circle cx="10" cy="10" r="8" fill="none" stroke="white" strokeWidth="1.3" />
              <path d="M2 10h16M10 2c3 2.5 3 13.5 0 16M10 2c-3 2.5-3 13.5 0 16" stroke="white" strokeWidth="1" fill="none" opacity="0.6" />
            </svg>
            <span className="text-[14px] font-medium text-white">PQC Scanner</span>
          </div>
          <span className="font-mono text-[11px] text-zinc-500">FIPS 203 · FIPS 204 · CycloneDX 1.6</span>
        </div>
      </header>

      <main className="relative z-10 mx-auto max-w-6xl px-6 pb-32">
        <section className="mx-auto max-w-2xl pt-24 pb-16 text-center sm:pt-32">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/40 px-3 py-1 text-[12px] text-zinc-400 backdrop-blur-md">
            <Dot status="safe" /> Live TLS analysis
          </div>
          <h1 className="mt-6 text-4xl font-semibold tracking-[-0.03em] text-balance text-white sm:text-5xl">Post-quantum readiness, verified.</h1>
          <p className="mx-auto mt-4 max-w-xl text-[15px] leading-relaxed text-balance text-zinc-400">
            Scan a domain's live TLS handshake. Detect its cryptography, score it with Mosca's inequality, simulate the migration, and prove it on a Merkle ledger.
          </p>

          <form
            className="mx-auto mt-10 flex max-w-xl gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              scan(query)
            }}
          >
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Enter domain to test PQC readiness (e.g., cloudflare.com)"
              aria-label="Domain to scan"
              autoFocus
              spellCheck={false}
              autoCapitalize="none"
              className="h-11 min-w-0 flex-1 rounded-md border border-white/10 bg-black/40 px-4 font-mono text-[13px] text-white backdrop-blur-md transition-colors outline-none placeholder:font-sans placeholder:text-zinc-600 focus:border-white/30"
            />
            <button
              type="submit"
              disabled={scanning || !query.trim()}
              className="inline-flex h-11 items-center gap-2 rounded-md bg-white px-5 text-[13px] font-medium text-black transition-colors hover:bg-zinc-200 disabled:opacity-40"
            >
              {scanning ? <Loader2 size={14} className="animate-spin" /> : <ArrowRight size={14} />}
              {scanning ? 'Scanning' : 'Scan'}
            </button>
          </form>

          <div className="mt-4 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[12px] text-zinc-600">
            <span>Try</span>
            {EXAMPLES.map((d) => (
              <button
                key={d}
                disabled={scanning}
                onClick={() => {
                  setQuery(d)
                  scan(d)
                }}
                className="font-mono text-zinc-500 transition-colors hover:text-white disabled:opacity-40"
              >
                {d}
              </button>
            ))}
          </div>

          <div className="mt-6 h-5 font-mono text-[12px] text-zinc-500" aria-live="polite">
            {scanning && (
              <span className="inline-flex items-center gap-2">
                <Loader2 size={12} className="animate-spin" /> {STEPS[step]}
              </span>
            )}
          </div>
          {error && (
            <div className="mx-auto mt-2 max-w-md text-left">
              <Callout status="risk" title="Scan failed">{error}</Callout>
            </div>
          )}
        </section>

        {result && before && preview && (
          <div ref={resultsRef} className="scroll-mt-20">
            {/* Target summary */}
            <motion.div {...reveal} className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-white/10 bg-white/10 md:grid-cols-[1.1fr_1fr_0.7fr_2fr_0.8fr]">
              {[
                ['Target', <span className="font-mono">{result.domain}</span>],
                ['Address', <span className="font-mono">{result.resolved_ip}</span>],
                ['Protocol', <span className="font-mono">{result.tls.version}</span>],
                [
                  'Status',
                  <span className="inline-flex items-center gap-2">
                    <Dot status={migrated ? 'safe' : TONE_STATUS[result.assessment.color]} />
                    {migrated ? 'Quantum ready · simulated' : SUMMARY[result.assessment.status]}
                  </span>,
                ],
                ['PQC score', <span className="font-mono">{migrated ? 100 : result.assessment.score}<span className="text-zinc-600"> / 100</span></span>],
              ].map(([label, value], i) => (
                <div key={i} className={`bg-black/80 px-5 py-4 backdrop-blur-md ${i === 3 ? 'order-last col-span-2 md:order-none md:col-span-1' : ''}`}>
                  <div className="text-[11px] font-medium tracking-wide text-zinc-500 uppercase">{label as string}</div>
                  <div className="mt-1.5 truncate text-[13px] text-white">{value}</div>
                </div>
              ))}
            </motion.div>

            <div className="mt-10 grid gap-10 lg:grid-cols-[220px_1fr]">
              {/* Stepper */}
              <nav aria-label="Stages" className="lg:sticky lg:top-20 lg:self-start">
                <ol className="flex gap-2 overflow-x-auto lg:flex-col lg:gap-0">
                  {stepsMeta.map((s, i) => {
                    const n = i + 1
                    const locked = n > unlocked
                    const isActive = n === active
                    return (
                      <li key={s.title} className="relative shrink-0 lg:pb-6 lg:last:pb-0">
                        {i < 3 && <span className="absolute top-7 bottom-0 left-[11px] hidden w-px bg-white/10 lg:block" aria-hidden />}
                        <button
                          disabled={locked}
                          onClick={() => setActive(n)}
                          aria-current={isActive ? 'step' : undefined}
                          className={`flex items-start gap-3 rounded-md px-2 py-1.5 text-left transition-colors lg:w-full lg:px-0 ${
                            isActive ? 'bg-white/[0.06] lg:bg-transparent' : ''
                          } ${locked ? 'cursor-not-allowed' : 'hover:bg-white/[0.04] lg:hover:bg-transparent'}`}
                        >
                          <span
                            className={`relative z-10 grid size-6 shrink-0 place-items-center rounded-full border bg-black font-mono text-[11px] transition-colors ${
                              s.done ? 'border-white/20 text-white' : isActive ? 'border-white text-white' : 'border-white/10 text-zinc-600'
                            }`}
                          >
                            {s.done ? <Check size={12} strokeWidth={2.5} /> : n}
                          </span>
                          <span className="min-w-0">
                            <span className={`block text-[13px] font-medium ${isActive ? 'text-white' : locked ? 'text-zinc-600' : 'text-zinc-300'}`}>{s.title}</span>
                            <span className="mt-0.5 hidden items-center gap-1.5 text-[12px] text-zinc-500 lg:flex">
                              {s.status !== 'idle' && <Dot status={s.status} />}
                              <span className="truncate">{s.sub}</span>
                            </span>
                          </span>
                        </button>
                      </li>
                    )
                  })}
                </ol>
              </nav>

              {/* Active stage */}
              <div className="min-w-0">
                {active === 1 && <DetectStage key="detect" result={result} migrated={migrated} onNext={() => go(2)} showNext />}
                {active === 2 && (
                  <ScoreStage
                    key="score"
                    x={x}
                    y={y}
                    setX={setX}
                    setY={setY}
                    preview={preview}
                    result={moscaResult}
                    onCalculate={calculate}
                    onNext={() => go(3)}
                    showNext
                  />
                )}
                {active === 3 && (
                  <DefendStage
                    key="defend"
                    domain={result.domain}
                    before={before}
                    phase={migration}
                    scoreBefore={result.assessment.score}
                    onMigrate={migrate}
                    onNext={() => go(4)}
                    showNext
                  />
                )}
                {active === 4 && (
                  <ProveStage
                    key="prove"
                    anchoring={anchoring}
                    block={block}
                    verification={verification}
                    tampered={tampered}
                    onAnchor={anchorToLedger}
                    onTamperToggle={toggleTamper}
                  />
                )}
                {active === 1 && migrated && (
                  <p className="mt-4 text-[12px] text-zinc-500">Showing the simulated post-migration state.</p>
                )}
              </div>
            </div>
          </div>
        )}
      </main>

      <footer className="relative z-10 border-t border-white/10">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-6 py-6 text-[12px] text-zinc-600">
          <span>Detect is a live handshake. Defend is simulated. Prove uses real SHA-256, stored in this browser.</span>
          <Button variant="ghost" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>Back to top</Button>
        </div>
      </footer>
    </div>
  )
}
