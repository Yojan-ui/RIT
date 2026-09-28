import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { AlertCircle, ArrowDown, ArrowRight, Check, Loader2, Search } from 'lucide-react'
import { scanDomain, type ScanResult, type Tone } from './api'
import { CipherGlobe, type Phase } from './scene/CipherGlobe'
import { TONE, NextButton } from './components/ui'
import { DetectStage } from './components/stages/DetectStage'
import { ScoreStage } from './components/stages/ScoreStage'
import { DefendStage, MIGRATE_MS, type MigrationPhase } from './components/stages/DefendStage'
import { ProveStage } from './components/stages/ProveStage'
import { MIGRATED, cryptoFromScan, mosca, type MoscaResult } from './lib/mosca'
import { anchor, verify, type LedgerBlock, type Verification } from './lib/ledger'

const EXAMPLES = ['cloudflare.com', 'google.com', 'github.com', 'microsoft.com', 'example.org']
const STEPS = [
  'Resolving and vetting address…',
  'Sending ClientHello with X25519MLKEM768…',
  'Reading the ServerHello key share…',
  'Fetching the certificate chain…',
  'Building the CBOM…',
]
const MIN_SCAN_MS = 1600
const STAGE_NAMES = ['Detect', 'Score', 'Defend', 'Prove']
const MOSCA_TONE: Record<MoscaResult['verdict'], Tone> = { critical: 'crimson', window: 'amber', safe: 'emerald' }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export default function App() {
  const [query, setQuery] = useState(() => new URLSearchParams(location.search).get('domain') ?? '')
  const [scanning, setScanning] = useState(false)
  const [result, setResult] = useState<ScanResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [step, setStep] = useState(0)

  // The four-stage story
  const [unlocked, setUnlocked] = useState(1)
  const [x, setX] = useState(4)
  const [y, setY] = useState(10)
  const [scored, setScored] = useState(false)
  const [migration, setMigration] = useState<MigrationPhase>('idle')
  const [block, setBlock] = useState<LedgerBlock | null>(null)
  const [verification, setVerification] = useState<Verification | null>(null)
  const [anchoring, setAnchoring] = useState(false)
  const [tampered, setTampered] = useState(false)
  const [globeTone, setGlobeTone] = useState<Tone | null>(null)
  const [pulse, setPulse] = useState(0)

  const abort = useRef<AbortController | null>(null)
  const stageRefs = useRef<(HTMLElement | null)[]>([])

  const before = useMemo(() => (result ? cryptoFromScan(result) : null), [result])
  const preview = useMemo(() => (before ? mosca(x, y, before) : null), [before, x, y])
  const moscaResult = scored ? preview : null
  const migrated = migration === 'done'

  const resetStory = () => {
    setUnlocked(1)
    setScored(false)
    setMigration('idle')
    setBlock(null)
    setVerification(null)
    setTampered(false)
  }

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
      resetStory()
      setResult(res)
      setGlobeTone(res.assessment.color)
      setScanning(false)
      setTimeout(() => stageRefs.current[0]?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 400)
    } catch (e) {
      if ((e as Error).name === 'AbortError') return
      setError((e as Error).message)
      setScanning(false)
    }
  }, [])

  // Scanning status line
  useEffect(() => {
    if (!scanning) return
    const id = setInterval(() => setStep((s) => Math.min(STEPS.length - 1, s + 1)), 380)
    return () => clearInterval(id)
  }, [scanning])

  // Deep link: ?domain= scans on load
  const booted = useRef(false)
  useEffect(() => {
    if (booted.current) return
    booted.current = true
    if (query) scan(query)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Globe follows the live Mosca verdict once scored (until migrated)
  useEffect(() => {
    if (moscaResult && !migrated && migration !== 'migrating') setGlobeTone(MOSCA_TONE[moscaResult.verdict])
  }, [moscaResult, migrated, migration])

  const reveal = (n: number) => {
    setUnlocked((u) => Math.max(u, n))
    setTimeout(() => stageRefs.current[n - 1]?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 350)
  }

  const calculate = () => {
    setScored(true)
    setPulse((p) => p + 1)
    setTimeout(() => reveal(3), 1100)
  }

  const migrate = async () => {
    setMigration('migrating')
    await sleep(MIGRATE_MS)
    setMigration('done')
    setGlobeTone('emerald')
    setTimeout(() => reveal(4), 900)
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
    const [b] = await Promise.all([anchor(result.domain, records()), sleep(700)])
    setBlock(b)
    setVerification(await verify(b))
    setAnchoring(false)
    setTimeout(() => stageRefs.current[3]?.scrollIntoView({ behavior: 'smooth', block: 'end' }), 250)
    setTimeout(() => setPulse((p) => p + 1), 900)
  }

  const toggleTamper = async () => {
    if (!block) return
    if (tampered) {
      setVerification(await verify(block))
      setTampered(false)
      return
    }
    // An attacker rewrites history: "the endpoint was migrated to RSA-2048". Hashes are left untouched.
    const forged: LedgerBlock = structuredClone(block)
    const defend = forged.records[2].data as { after: { signature: string } }
    defend.after.signature = 'RSA-2048'
    setVerification(await verify(forged))
    setTampered(true)
  }

  const globePhase: Phase = scanning || migration === 'migrating' ? 'scanning' : result ? 'result' : 'idle'
  const stageStatus = (n: number) => (n < unlocked || (n === 4 && verification?.valid) ? 'done' : 'active')
  const caption = result
    ? migrated
      ? `${result.domain} · X25519MLKEM768 · ML-DSA-65 (simulated)`
      : `${result.domain} · ${result.tls.key_exchange.group} · ${result.certificate.public_key.name}`
    : ''

  return (
    <div className="relative min-h-full overflow-x-clip">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_at_top,rgb(14_30_48/0.9),transparent_60%)]" />

      <header className="relative z-10 mx-auto flex max-w-6xl items-center justify-between px-5 py-5">
        <div className="flex items-center gap-2.5">
          <svg viewBox="0 0 32 32" className="size-7" aria-hidden>
            <circle cx="16" cy="16" r="12" fill="none" stroke="#34d399" strokeWidth="1.8" />
            <path d="M4 16h24M16 4c5 4 5 20 0 24M16 4c-5 4-5 20 0 24" stroke="#34d399" strokeWidth="1.2" fill="none" />
          </svg>
          <span className="text-sm font-semibold tracking-tight text-white">PQC Scanner</span>
        </div>
        <span className="hidden rounded-full border border-white/10 px-3 py-1 text-[11px] text-zinc-400 sm:inline">
          Detect · Score · Defend · Prove
        </span>
      </header>

      <main className="relative z-10 mx-auto max-w-5xl px-5 pb-24">
        <section className="pt-6 text-center sm:pt-10">
          <h1 className="text-3xl font-semibold tracking-tight text-balance text-white sm:text-5xl">
            Is your domain ready for <span className="bg-gradient-to-r from-sky-300 via-emerald-300 to-teal-200 bg-clip-text text-transparent">quantum computers</span>?
          </h1>
          <p className="mx-auto mt-3 max-w-2xl text-sm text-balance text-zinc-400 sm:text-base">
            Detect the live cryptography, score it with Mosca's inequality, simulate the post-quantum fix, and prove it on a Merkle ledger.
          </p>

          <form
            className="mx-auto mt-8 flex max-w-2xl items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] p-2 shadow-[0_0_60px_-20px_rgb(56_189_248/0.5)] backdrop-blur-xl focus-within:border-sky-300/40"
            onSubmit={(e) => {
              e.preventDefault()
              scan(query)
            }}
          >
            <Search className="ml-2 shrink-0 text-zinc-500" size={18} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Enter domain to test PQC readiness (e.g., cloudflare.com, google.com, example.org)"
              aria-label="Domain to scan"
              autoFocus
              spellCheck={false}
              autoCapitalize="none"
              className="min-w-0 flex-1 bg-transparent py-2.5 text-[15px] text-white outline-none placeholder:text-zinc-500"
            />
            <button
              type="submit"
              disabled={scanning || !query.trim()}
              className="flex shrink-0 items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-zinc-950 transition hover:bg-sky-100 disabled:opacity-50"
            >
              {scanning ? <Loader2 size={16} className="animate-spin" /> : <ArrowRight size={16} />}
              {scanning ? 'Scanning' : 'Scan'}
            </button>
          </form>

          <div className="mt-3 flex flex-wrap justify-center gap-2">
            {EXAMPLES.map((d) => (
              <button
                key={d}
                onClick={() => {
                  setQuery(d)
                  scan(d)
                }}
                disabled={scanning}
                className="rounded-full border border-white/10 px-3 py-1 font-mono text-xs text-zinc-400 transition hover:border-white/25 hover:text-white disabled:opacity-40"
              >
                {d}
              </button>
            ))}
          </div>

          <AnimatePresence>
            {error && (
              <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} role="alert" className="mx-auto mt-4 flex max-w-xl items-center justify-center gap-2 text-sm text-rose-300">
                <AlertCircle size={15} /> {error}
              </motion.p>
            )}
          </AnimatePresence>
        </section>

        <section className="relative mt-4 h-[44vh] min-h-[300px] sm:h-[48vh]" aria-label="Scan visualisation">
          <div className="absolute inset-0 [mask-image:radial-gradient(ellipse_at_center,black_45%,transparent_78%)]">
            <CipherGlobe phase={globePhase} tone={globeTone} pulseKey={pulse} />
          </div>
          <div className="pointer-events-none absolute inset-x-0 bottom-2 text-center font-mono text-xs">
            {scanning && (
              <motion.p key={step} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-sky-300/90">{STEPS[step]}</motion.p>
            )}
            {migration === 'migrating' && <p className="text-emerald-300/90">Migrating to ML-DSA-65 + X25519MLKEM768…</p>}
            {!scanning && migration !== 'migrating' && result && globeTone && <p className={TONE[globeTone].text}>{caption}</p>}
            {!scanning && !result && <p className="text-zinc-600">awaiting target</p>}
          </div>
        </section>

        {result && before && preview && (
          <>
            {/* Progress rail */}
            <nav className="sticky top-3 z-30 mx-auto mb-6 flex w-fit items-center gap-1 rounded-full border border-white/10 bg-zinc-950/70 p-1 backdrop-blur-xl" aria-label="Stages">
              {STAGE_NAMES.map((name, i) => {
                const n = i + 1
                const open = n <= unlocked
                const done = stageStatus(n) === 'done'
                return (
                  <button
                    key={name}
                    disabled={!open}
                    onClick={() => stageRefs.current[i]?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                    className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                      done ? 'bg-emerald-400/15 text-emerald-300' : open ? 'bg-white/10 text-white' : 'text-zinc-600'
                    }`}
                  >
                    {done ? <Check size={12} strokeWidth={3} /> : <span className="font-mono">{n}</span>}
                    <span className="hidden sm:inline">{name}</span>
                  </button>
                )
              })}
            </nav>

            <div className="space-y-6">
              <DetectStage ref={(el) => { stageRefs.current[0] = el }} result={result} migrated={migrated} status={stageStatus(1)}>
                {unlocked === 1 && (
                  <div className="mt-5 flex justify-center">
                    <NextButton onClick={() => reveal(2)} icon={<ArrowDown size={18} />}>Continue to Stage 2 · Score</NextButton>
                  </div>
                )}
              </DetectStage>

              {unlocked >= 2 && (
                <ScoreStage
                  ref={(el) => { stageRefs.current[1] = el }}
                  status={stageStatus(2)}
                  x={x}
                  y={y}
                  setX={setX}
                  setY={setY}
                  preview={preview}
                  result={moscaResult}
                  onCalculate={calculate}
                />
              )}

              {unlocked >= 3 && (
                <DefendStage
                  ref={(el) => { stageRefs.current[2] = el }}
                  status={stageStatus(3)}
                  domain={result.domain}
                  before={before}
                  phase={migration}
                  scoreBefore={result.assessment.score}
                  onMigrate={migrate}
                />
              )}

              {unlocked >= 4 && (
                <ProveStage
                  ref={(el) => { stageRefs.current[3] = el }}
                  status={stageStatus(4)}
                  anchoring={anchoring}
                  block={block}
                  verification={verification}
                  tampered={tampered}
                  onAnchor={anchorToLedger}
                  onTamperToggle={toggleTamper}
                />
              )}
            </div>
          </>
        )}

        <footer className="mt-12 text-center text-xs text-zinc-600">
          Stage 1 is a live TLS handshake. Stage 3's migration is simulated. Stage 4's hashes are real SHA-256, stored in this browser only.
        </footer>
      </main>
    </div>
  )
}
