import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { LayoutGroup, motion } from 'framer-motion'
import { ArrowRight, Check, ChevronDown, Circle, FileText, Loader2, RotateCcw, ShieldCheck } from 'lucide-react'
import { scanDomain, type ScanResult } from './api'
import { CryptoCore, type CoreState } from './scene/CryptoCore'
import { DefendDetails, DetectDetails, ProveDetails } from './components/advanced'
import { ExportMenu } from './components/ExportMenu'
import { AlgoChip, Glass, ImpactPanel, RiskGauge, Stepper, TypeTerminal, ease, item, stagger, type Algo, type TermLine } from './components/pipeline'
import { cryptoFromScan, mosca, MIGRATED, BASE_YEAR, Z_YEARS } from './lib/mosca'
import { anchor, verify, type LedgerBlock, type Verification } from './lib/ledger'
import { actionPlan, diagnose } from './lib/diagnosis'
import { exportCbomJson, exportPdfReport } from './lib/report'
import { demoScan } from './lib/demo'

const EXAMPLES = ['github.com', 'microsoft.com', 'cloudflare.com']
const SCAN_STEPS = ['Resolving and vetting the address', 'TLS handshake offering X25519MLKEM768', 'Reading the certificate chain', 'Building the CBOM']
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function Disclosure({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="mt-6">
      <button onClick={() => setOpen(!open)} aria-expanded={open} className="inline-flex items-center gap-1.5 text-[13px] text-zinc-500 transition-colors hover:text-white">
        <ChevronDown size={14} className={`transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
        {label}
      </button>
      {open && (
        <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }} className="mt-4 rounded-xl border border-white/5 bg-black/40 p-5">
          {children}
        </motion.div>
      )}
    </div>
  )
}

function Primary({ children, onClick, disabled, busy, icon }: { children: ReactNode; onClick: () => void; disabled?: boolean; busy?: boolean; icon?: ReactNode }) {
  return (
    <motion.button
      layout
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      disabled={disabled || busy}
      className="inline-flex h-11 items-center gap-2 rounded-lg bg-white px-5 text-[14px] font-semibold text-black transition-colors hover:bg-zinc-200 disabled:opacity-50"
    >
      {busy ? <Loader2 size={16} className="animate-spin" /> : icon}
      {children}
      {!busy && !icon && <ArrowRight size={16} />}
    </motion.button>
  )
}

function Heading({ eyebrow, title, body }: { eyebrow: string; title: ReactNode; body?: ReactNode }) {
  return (
    <motion.div variants={item}>
      <div className="font-mono text-[11px] tracking-wide text-zinc-500 uppercase">{eyebrow}</div>
      <h2 className="mt-2 text-2xl leading-tight font-semibold tracking-[-0.025em] text-white sm:text-3xl">{title}</h2>
      {body && <p className="mt-2 text-[15px] leading-relaxed text-zinc-400">{body}</p>}
    </motion.div>
  )
}

function CheckLine({ state, children }: { state: 'todo' | 'run' | 'done'; children: ReactNode }) {
  return (
    <li className={`flex items-center gap-2.5 font-mono text-[12.5px] ${state === 'done' ? 'text-zinc-300' : state === 'run' ? 'text-white' : 'text-zinc-600'}`}>
      {state === 'done' ? <Check size={13} className="text-safe" /> : state === 'run' ? <Loader2 size={13} className="animate-spin" /> : <Circle size={13} />}
      {children}
    </li>
  )
}

export default function App() {
  const [query, setQuery] = useState(() => new URLSearchParams(location.search).get('domain') ?? '')
  const [result, setResult] = useState<ScanResult | null>(null)
  const [demo, setDemo] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [scanning, setScanning] = useState(false)
  const [scanStep, setScanStep] = useState(0)

  const [step, setStep] = useState(1)
  const [reached, setReached] = useState(1)
  const [x, setX] = useState(4)
  const [y, setY] = useState(10)
  const [patching, setPatching] = useState(false)
  const [patched, setPatched] = useState(false)
  const [block, setBlock] = useState<LedgerBlock | null>(null)
  const [verification, setVerification] = useState<Verification | null>(null)
  const [anchoring, setAnchoring] = useState(false)
  const [typed, setTyped] = useState(false)
  const [tampered, setTampered] = useState(false)
  const [rescan, setRescan] = useState<'idle' | 'running' | 'done'>('idle')
  const [rescanStep, setRescanStep] = useState(0)
  const [shock, setShock] = useState(0)
  const abort = useRef<AbortController | null>(null)

  const before = useMemo(() => (result ? cryptoFromScan(result) : null), [result])
  const m = useMemo(() => (before ? mosca(x, y, before) : null), [before, x, y])
  const diag = result && before ? diagnose(result, before, false) : null

  const resetPipeline = () => {
    setStep(1)
    setReached(1)
    setPatching(false)
    setPatched(false)
    setBlock(null)
    setVerification(null)
    setAnchoring(false)
    setTyped(false)
    setTampered(false)
    setRescan('idle')
    setRescanStep(0)
  }

  const scan = useCallback(async (raw: string) => {
    const domain = raw.trim()
    if (!domain) return
    abort.current?.abort()
    const ctrl = new AbortController()
    abort.current = ctrl
    resetPipeline()
    setResult(null)
    setError(null)
    setDemo(false)
    setScanning(true)
    setScanStep(0)
    const url = new URL(location.href)
    url.searchParams.set('domain', domain)
    history.replaceState(null, '', url)
    try {
      const [res] = await Promise.all([scanDomain(domain, ctrl.signal), sleep(1600)])
      if (ctrl.signal.aborted) return
      setResult(res)
    } catch (e) {
      if (ctrl.signal.aborted || (e as Error).name === 'AbortError') return
      const msg = (e as Error).message
      if (msg.startsWith('Scanner API unreachable')) {
        setResult(demoScan(domain)) // keep the demo alive without the backend
        setDemo(true)
      } else {
        setError(msg)
      }
    } finally {
      if (!ctrl.signal.aborted) setScanning(false)
    }
  }, [])

  useEffect(() => {
    if (!scanning) return
    const id = setInterval(() => setScanStep((s) => Math.min(SCAN_STEPS.length - 1, s + 1)), 380)
    return () => clearInterval(id)
  }, [scanning])

  const booted = useRef(false)
  useEffect(() => {
    if (booted.current) return
    booted.current = true
    if (query) scan(query)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const goto = (n: number) => {
    setReached((r) => Math.max(r, n))
    setStep(n)
  }

  const applyPatch = async () => {
    setPatching(true)
    await sleep(1800)
    setPatching(false)
    setPatched(true)
    setShock((s) => s + 1)
  }

  const anchorProof = async () => {
    if (!result || !before || !m) return
    setAnchoring(true)
    const b = await anchor(result.domain, [
      {
        label: 'Detect',
        data: {
          domain: result.domain,
          scanned_at: result.scanned_at,
          demo,
          tls: { version: result.tls.version, cipher: result.tls.cipher_suite, group: result.tls.key_exchange.group },
          certificate: { cn: result.certificate.subject_cn, public_key: result.certificate.public_key.name, signature: result.certificate.signature.name, not_after: result.certificate.not_after },
          cbom: result.cbom_summary.map((r) => ({ name: r.name, quantum_safe: r.quantum_safe })),
        },
      },
      { label: 'Score', data: { method: 'Mosca X + Y > Z', x: m.x, y: m.y, z: m.z, verdict: m.verdict } },
      { label: 'Defend', data: { simulated: true, before, after: { ...MIGRATED, kex_standard: 'ML-KEM-768 (X25519MLKEM768)' } } },
    ])
    setBlock(b)
    setVerification(await verify(b))
    setAnchoring(false)
  }

  const runRescan = async () => {
    setRescan('running')
    for (let i = 1; i <= 3; i++) {
      await sleep(700)
      setRescanStep(i)
    }
    await sleep(400)
    setRescan('done')
    setShock((s) => s + 1)
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
    resetPipeline()
    setResult(null)
    setScanning(false)
    setError(null)
    setQuery('')
    history.replaceState(null, '', location.pathname)
  }

  const exportPdf = () => result && before && exportPdfReport(result, { fixed: patched, plan: actionPlan(result, before), block, verification })
  const exportJson = () => result && exportCbomJson(result)

  // Chips: detected vs patched
  const detected: Algo[] = before
    ? [
        { role: 'Signature', name: before.leafKey, safe: before.leafPq, note: before.leafPq ? 'Post-quantum signature' : 'Certificate key · signs every handshake' },
        { role: 'Key exchange', name: before.kex, safe: before.kexPq, note: before.kexPq ? 'Hybrid ML-KEM already negotiated' : 'Protects session keys' },
      ]
    : []
  const upgraded: Algo[] = [
    { role: 'Signature', name: 'ML-DSA-65', safe: true, note: 'FIPS 204 · NIST category 3' },
    { role: 'Key exchange', name: 'ML-KEM-768', safe: true, note: 'FIPS 203 · as X25519MLKEM768 hybrid' },
  ]
  const vulnerable = detected.filter((a) => !a.safe).length
  const otherFailing = result ? result.cbom_summary.filter((a) => !a.quantum_safe && a.name !== before?.leafKey && a.name !== before?.kex) : []

  const core: CoreState = scanning || rescan === 'running'
    ? 'scanning'
    : !result
      ? 'idle'
      : patching
        ? 'upgrading'
        : patched
          ? 'secured'
          : step >= 2 && m
            ? m.verdict === 'critical' ? 'critical' : m.verdict === 'safe' ? 'secured' : 'vulnerable'
            : diag?.tone === 'safe' ? 'secured' : diag?.tone === 'risk' ? 'critical' : 'vulnerable'

  const complete = rescan === 'done'

  return (
    <div className="relative h-dvh overflow-hidden bg-black text-white">
      <div className="fixed inset-0 opacity-90" aria-hidden>
        <CryptoCore state={core} shockKey={shock} side="right" />
      </div>
      <div className="pointer-events-none fixed inset-0 bg-gradient-to-r from-black/85 via-black/40 to-transparent max-lg:bg-gradient-to-t max-lg:from-black max-lg:via-black/70" aria-hidden />

      <header className="absolute inset-x-0 top-0 z-30 flex h-16 items-center justify-between bg-gradient-to-b from-black via-black/80 to-transparent px-6 lg:px-10">
        <button onClick={reset} className="flex items-center gap-2.5" aria-label="Start over">
          <svg viewBox="0 0 20 20" className="size-5" aria-hidden>
            <circle cx="10" cy="10" r="8" fill="none" stroke="white" strokeWidth="1.3" />
            <path d="M2 10h16M10 2c3 2.5 3 13.5 0 16M10 2c-3 2.5-3 13.5 0 16" stroke="white" strokeWidth="1" fill="none" opacity="0.6" />
          </svg>
          <span className="text-[14px] font-medium">PQC Scanner</span>
          {result && <span className="hidden font-mono text-[12px] text-zinc-500 sm:inline">/ {result.domain}</span>}
        </button>
        <ExportMenu enabled={!!result} highlight={complete} onPdf={exportPdf} onJson={exportJson} />
      </header>

      <main className="relative z-10 h-full overflow-y-auto">
        <div className="mx-auto max-w-6xl px-6 pt-24 pb-24 lg:px-10">
          <div className="max-w-[680px] max-lg:pt-[30vh]">
            <Stepper current={step} reached={reached} onSelect={setStep} />

            {demo && (
              <p className="mt-6 flex items-center gap-2 text-[13px] text-zinc-400">
                <span className="size-1.5 rounded-full bg-warn" /> Scanner API unreachable: showing demo data for {result?.domain}.
              </p>
            )}

            <LayoutGroup>
              <Glass className="mt-8 p-6 sm:p-8">
                {/* ── 1 · Detect ─────────────────────────────────────── */}
                {step === 1 && (
                  <motion.div key="detect" variants={stagger} initial="hidden" animate="show">
                    {!result && !scanning && (
                      <>
                        <Heading eyebrow="Step 1 · Detect" title="Scan an endpoint" body="We open a live TLS connection, offer post-quantum key exchange, and read the certificate the server signs with." />
                        <motion.form
                          variants={item}
                          className="mt-6 flex gap-2"
                          onSubmit={(e) => {
                            e.preventDefault()
                            scan(query)
                          }}
                        >
                          <input
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            placeholder="e.g. github.com"
                            aria-label="Endpoint to scan"
                            autoFocus
                            spellCheck={false}
                            autoCapitalize="none"
                            className="h-11 min-w-0 flex-1 rounded-lg border border-white/10 bg-black/40 px-4 font-mono text-[14px] text-white outline-none placeholder:font-sans placeholder:text-zinc-600 focus:border-white/25"
                          />
                          <button type="submit" disabled={!query.trim()} className="inline-flex h-11 items-center gap-2 rounded-lg bg-white px-5 text-[14px] font-semibold text-black hover:bg-zinc-200 disabled:opacity-40">
                            Scan <ArrowRight size={16} />
                          </button>
                        </motion.form>
                        <motion.div variants={item} className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-zinc-600">
                          Try
                          {EXAMPLES.map((d) => (
                            <button key={d} onClick={() => { setQuery(d); scan(d) }} className="font-mono text-zinc-400 hover:text-white">
                              {d}
                            </button>
                          ))}
                        </motion.div>
                        {error && (
                          <motion.p variants={item} className="mt-5 flex items-center gap-2 text-[14px] text-zinc-200" role="alert">
                            <span className="size-1.5 rounded-full bg-risk" /> {error}
                          </motion.p>
                        )}
                      </>
                    )}

                    {scanning && (
                      <>
                        <Heading eyebrow="Step 1 · Detect" title={<>Scanning <span className="font-mono">{query.trim()}</span></>} />
                        <motion.ol variants={item} className="mt-6 space-y-2.5">
                          {SCAN_STEPS.map((s, i) => (
                            <CheckLine key={s} state={i < scanStep ? 'done' : i === scanStep ? 'run' : 'todo'}>{s}</CheckLine>
                          ))}
                        </motion.ol>
                      </>
                    )}

                    {result && before && !scanning && (
                      <>
                        <Heading
                          eyebrow="Step 1 · Detect"
                          title={vulnerable ? `${vulnerable} vulnerable algorithm${vulnerable > 1 ? 's' : ''} found` : 'No vulnerable algorithms found'}
                          body={diag?.meaning}
                        />
                        <motion.div variants={item} className="mt-6 space-y-2.5">
                          {detected.map((a) => <AlgoChip key={a.role} algo={a} />)}
                        </motion.div>
                        {otherFailing.length > 0 && (
                          <motion.p variants={item} className="mt-3 text-[12px] text-zinc-500">
                            Also classical in the chain: <span className="font-mono text-zinc-400">{otherFailing.map((a) => a.name).join(' · ')}</span>
                          </motion.p>
                        )}
                        <motion.div variants={item} className="mt-7">
                          <Primary onClick={() => goto(2)}>Next: score the risk</Primary>
                        </motion.div>
                        <Disclosure label={`Full CBOM (${result.cbom_summary.length} algorithms)`}>
                          <DetectDetails result={result} migrated={false} />
                        </Disclosure>
                      </>
                    )}
                  </motion.div>
                )}

                {/* ── 2 · Score ──────────────────────────────────────── */}
                {step === 2 && m && (
                  <motion.div key="score" variants={stagger} initial="hidden" animate="show">
                    <Heading
                      eyebrow="Step 2 · Score · Mosca's inequality"
                      title={m.verdict === 'critical' ? 'Critical: forgeable while it still matters' : m.verdict === 'safe' ? 'Safe: already post-quantum' : 'Within the window, but only just'}
                      body={
                        m.verdict === 'critical'
                          ? `Data must stay protected until ${BASE_YEAR + m.sum}. A quantum computer could break it from ${BASE_YEAR + m.z}: ${m.exposedYears} years exposed.`
                          : m.verdict === 'safe'
                            ? 'Nothing detected is breakable by a quantum computer.'
                            : `Protection is needed until ${BASE_YEAR + m.sum}, before a ${BASE_YEAR + m.z} quantum computer. Start migrating now.`
                      }
                    />
                    <motion.div variants={item} className="mt-6 grid items-center gap-6 sm:grid-cols-[1.1fr_1fr]">
                      <RiskGauge value={m.sum} threshold={m.z} verdict={m.verdict} />
                      <div>
                        <div className="font-mono text-2xl tracking-tight text-white tabular-nums">
                          {m.x} <span className="text-zinc-600">+</span> {m.y} <span className="text-zinc-600">=</span> {m.sum}{' '}
                          <span className={m.holds ? 'text-risk' : 'text-safe'}>{m.holds ? '>' : '≤'}</span> {m.z}
                        </div>
                        <div className="mt-1 font-mono text-[12px] text-zinc-500">X + Y {m.holds ? '>' : '≤'} Z</div>
                        <div className="mt-5 space-y-4">
                          {([['X · migration time', x, setX, 15], ['Y · data shelf life', y, setY, 30]] as const).map(([label, v, set, max]) => (
                            <label key={label} className="block">
                              <div className="flex justify-between text-[12px]">
                                <span className="text-zinc-400">{label}</span>
                                <span className="font-mono text-white">{v} yrs</span>
                              </div>
                              <input type="range" min={0} max={max} value={v} onChange={(e) => set(Number(e.target.value))} className="mt-1" />
                            </label>
                          ))}
                          <div className="flex justify-between text-[12px]">
                            <span className="text-zinc-400">Z · years to a quantum computer</span>
                            <span className="font-mono text-white">{Z_YEARS} yrs (fixed)</span>
                          </div>
                        </div>
                      </div>
                    </motion.div>
                    <motion.div variants={item} className="mt-7">
                      <Primary onClick={() => goto(3)}>Next: defend</Primary>
                    </motion.div>
                  </motion.div>
                )}

                {/* ── 3 · Defend ─────────────────────────────────────── */}
                {step === 3 && before && (
                  <motion.div key="defend" variants={stagger} initial="hidden" animate="show">
                    <Heading
                      eyebrow="Step 3 · Defend"
                      title={patched ? 'Patched: ML-DSA-65 + ML-KEM-768' : 'Apply the quantum-safe patch'}
                      body={
                        patched
                          ? 'Signatures now use ML-DSA-65 and key exchange uses ML-KEM-768 (as the X25519MLKEM768 hybrid).'
                          : 'Swap the classical signature and key exchange for NIST post-quantum standards.'
                      }
                    />
                    <motion.div variants={item} className="mt-6 space-y-2.5">
                      {(patched ? upgraded : detected).map((a, i) => <AlgoChip key={a.role} algo={a} delay={patched ? i * 0.18 : 0} />)}
                    </motion.div>
                    <motion.div variants={item} className="mt-7 flex flex-wrap items-center gap-3">
                      {patched ? (
                        <Primary onClick={() => goto(4)}>Next: prove it</Primary>
                      ) : (
                        <>
                          <Primary onClick={applyPatch} busy={patching} icon={<ShieldCheck size={16} />}>
                            {patching ? 'Applying patch…' : 'Apply Quantum-Safe Patch'}
                          </Primary>
                          <span className="text-[12px] text-zinc-500">Simulated: the real server is not modified.</span>
                        </>
                      )}
                    </motion.div>
                    <Disclosure label="What the patch does">
                      <DefendDetails domain={result!.domain} before={before} done={patched} />
                    </Disclosure>
                  </motion.div>
                )}

                {/* ── 4 · Prove ──────────────────────────────────────── */}
                {step === 4 && result && (
                  <motion.div key="prove" variants={stagger} initial="hidden" animate="show">
                    <Heading
                      eyebrow="Step 4 · Prove"
                      title={typed && verification?.valid ? 'Proof anchored to the Merkle ledger' : 'Anchor the proof'}
                      body="Each step is fingerprinted with SHA-256, combined into a Merkle root and chained to the previous block. Any later edit breaks it."
                    />
                    {!block ? (
                      <motion.div variants={item} className="mt-7">
                        <Primary onClick={anchorProof} busy={anchoring}>Anchor to Merkle ledger</Primary>
                      </motion.div>
                    ) : (
                      <motion.div variants={item} className="mt-6">
                        <TypeTerminal
                          title={`ledger · block #${block.index}`}
                          onDone={() => setTyped(true)}
                          lines={[
                            { text: `$ ledger anchor --domain ${block.domain}`, tone: 'dim' },
                            ...block.leaves.map((l, i): TermLine => ({ text: `sha256 leaf[${i}] ${l.label.toLowerCase().padEnd(7)} ${l.hash}` })),
                            { text: `merkle_root          ${block.merkle_root}`, tone: 'strong' },
                            { text: `prev_hash            ${block.prev_hash}`, tone: 'dim' },
                            { text: `block_hash           ${block.block_hash}`, tone: 'strong' },
                            { text: `$ ledger verify #${block.index}`, tone: 'dim' },
                            { text: verification?.valid ? '✓ leaves, root, block hash and chain link match' : '✗ verification failed', tone: verification?.valid ? 'ok' : 'bad' },
                          ]}
                        />
                        {typed && (
                          <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease }} className="mt-7">
                            <Primary onClick={() => goto(5)}>Next: rescan</Primary>
                          </motion.div>
                        )}
                        {typed && (
                          <Disclosure label="Verification details and tamper test">
                            <ProveDetails block={block} verification={verification} tampered={tampered} onTamperToggle={toggleTamper} />
                          </Disclosure>
                        )}
                      </motion.div>
                    )}
                  </motion.div>
                )}

                {/* ── 5 · Rescan ─────────────────────────────────────── */}
                {step === 5 && result && before && (
                  <motion.div key="rescan" variants={stagger} initial="hidden" animate="show">
                    <Heading
                      eyebrow="Step 5 · Rescan"
                      title={complete ? <><span className="font-mono">100%</span> PQC-ready</> : 'Run the verification scan'}
                      body={complete ? 'Every algorithm on the patched endpoint is post-quantum.' : 'Re-run the same checks against the patched configuration.'}
                    />
                    {rescan === 'idle' ? (
                      <motion.div variants={item} className="mt-7">
                        <Primary onClick={runRescan}>Run verification scan</Primary>
                      </motion.div>
                    ) : (
                      <motion.div variants={item} className="mt-6 grid items-center gap-6 sm:grid-cols-[1fr_auto]">
                        <ol className="space-y-2.5">
                          <CheckLine state={rescanStep >= 1 ? 'done' : 'run'}>Key exchange negotiated: ML-KEM-768 (X25519MLKEM768)</CheckLine>
                          <CheckLine state={rescanStep >= 2 ? 'done' : rescanStep === 1 ? 'run' : 'todo'}>Certificate: ML-DSA-65 key and signature</CheckLine>
                          <CheckLine state={rescanStep >= 3 ? 'done' : rescanStep === 2 ? 'run' : 'todo'}>CBOM: 0 quantum-vulnerable algorithms</CheckLine>
                        </ol>
                        <ScoreRing from={result.assessment.score} to={complete ? 100 : result.assessment.score} />
                      </motion.div>
                    )}
                    {complete && (
                      <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-4 text-[12px] text-zinc-500">
                        Verification ran against the simulated patched endpoint. The live server at {result.domain} still reports {before.leafKey}.
                      </motion.p>
                    )}
                    {complete && (
                      <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="mt-7 flex flex-wrap gap-2">
                        <Primary onClick={exportPdf} icon={<FileText size={16} />}>Download CBOM report</Primary>
                        <button onClick={reset} className="inline-flex h-11 items-center gap-2 rounded-lg border border-white/10 px-4 text-[14px] text-zinc-200 hover:border-white/20">
                          <RotateCcw size={15} /> Scan another endpoint
                        </button>
                      </motion.div>
                    )}
                  </motion.div>
                )}
              </Glass>
            </LayoutGroup>

            {complete && <ImpactPanel beforeAlgo={before!.leafKey} beforeKex={before!.kex} domain={result!.domain} />}
          </div>
        </div>
      </main>
    </div>
  )
}

/** Before → after PQC score ring. */
function ScoreRing({ from, to }: { from: number; to: number }) {
  const r = 38
  const c = 2 * Math.PI * r
  const done = to === 100
  return (
    <div className="relative size-28 shrink-0 justify-self-center">
      <svg viewBox="0 0 100 100" className="size-full -rotate-90">
        <circle cx="50" cy="50" r={r} fill="none" stroke="rgb(255 255 255 / 0.08)" strokeWidth="6" />
        <motion.circle
          cx="50"
          cy="50"
          r={r}
          fill="none"
          stroke={done ? '#10b981' : '#ef4444'}
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c * (1 - from / 100) }}
          animate={{ strokeDashoffset: c * (1 - to / 100), stroke: done ? '#10b981' : '#ef4444' }}
          transition={{ duration: 1.1, ease }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <motion.span key={to} initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="font-mono text-2xl text-white">
          {to}
        </motion.span>
        <span className="text-[10px] tracking-wide text-zinc-500 uppercase">{done ? 'PQC-ready' : 'PQC score'}</span>
      </div>
    </div>
  )
}

