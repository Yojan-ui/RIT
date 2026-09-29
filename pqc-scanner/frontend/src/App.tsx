import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { ArrowRight, Check, ChevronDown, Circle, Download, FileJson, FileText, Loader2, RotateCcw, ShieldCheck } from 'lucide-react'
import { scanDomain, type ScanResult } from './api'
import { CryptoCore, type CoreState } from './scene/CryptoCore'
import { DefendDetails, DetectDetails, ProveDetails } from './components/advanced'
import { cryptoFromScan, mosca, MIGRATED } from './lib/mosca'
import { anchor, verify, type LedgerBlock, type Verification } from './lib/ledger'
import { actionPlan, diagnose, failures } from './lib/diagnosis'
import { exportCbomJson, exportPdfReport } from './lib/report'

const EXAMPLES = ['github.com', 'microsoft.com', 'cloudflare.com']
const SCAN_STEPS = ['Resolving and vetting the address', 'Live TLS handshake offering X25519MLKEM768', 'Reading the certificate chain', 'Building the CBOM']
const ROLE: Record<string, string> = { signature: 'Identity signature', 'key-agree': 'Connection key exchange', kem: 'Connection key exchange' }
const TONE_DOT = { risk: 'bg-risk', warn: 'bg-warn', safe: 'bg-safe' } as const
const TONE_LABEL = { risk: 'Critical', warn: 'At risk', safe: 'Secure' } as const
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

type Deploy = 'idle' | 'running' | 'done'

// ── Small building blocks ────────────────────────────────────────────────────

function Section({ n, title, state, children }: { n: number; title: string; state: 'upcoming' | 'active' | 'done'; children?: ReactNode }) {
  return (
    <section className={`border-b border-zinc-800 py-8 transition-opacity duration-300 last:border-0 ${state === 'upcoming' ? 'opacity-40' : ''}`}>
      <header className="flex items-center gap-3">
        <span
          className={`grid size-6 place-items-center rounded-full border font-mono text-[11px] ${
            state === 'done' ? 'border-safe/60 text-safe' : state === 'active' ? 'border-white text-white' : 'border-zinc-700 text-zinc-500'
          }`}
        >
          {state === 'done' ? <Check size={12} strokeWidth={2.5} /> : n}
        </span>
        <h2 className="text-[15px] font-medium text-white">{title}</h2>
      </header>
      {children && <div className="mt-5 pl-9">{children}</div>}
    </section>
  )
}

function Disclosure({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="mt-5">
      <button onClick={() => setOpen(!open)} className="inline-flex items-center gap-1.5 text-[13px] text-zinc-400 transition-colors hover:text-white" aria-expanded={open}>
        <ChevronDown size={14} className={`transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
        {label}
      </button>
      {open && (
        <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18 }} className="mt-4 rounded-lg border border-zinc-800 bg-black/40 p-5">
          {children}
        </motion.div>
      )}
    </div>
  )
}

function ExportMenu({ enabled, highlight, onPdf, onJson }: { enabled: boolean; highlight: boolean; onPdf: () => void; onJson: () => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])
  return (
    <div ref={ref} className="relative">
      <button
        disabled={!enabled}
        onClick={() => setOpen(!open)}
        title={enabled ? 'Download the Cryptographic Bill of Materials' : 'Scan an endpoint first'}
        className={`inline-flex h-9 items-center gap-2 rounded-md border px-3.5 text-[13px] font-medium backdrop-blur-xl transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
          highlight ? 'border-white bg-white text-black hover:bg-zinc-200' : 'border-zinc-800 bg-black/50 text-zinc-200 hover:border-zinc-600'
        }`}
      >
        <Download size={14} /> Export CBOM Report (PDF/JSON) <ChevronDown size={13} />
      </button>
      {open && (
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.15 }}
          className="absolute right-0 mt-2 w-64 overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950/95 p-1 shadow-2xl backdrop-blur-xl"
        >
          {[
            { icon: <FileText size={15} />, label: 'PDF report', hint: 'For compliance and audit', run: onPdf },
            { icon: <FileJson size={15} />, label: 'CycloneDX 1.6 JSON', hint: 'Machine-readable CBOM', run: onJson },
          ].map((o) => (
            <button
              key={o.label}
              onClick={() => {
                o.run()
                setOpen(false)
              }}
              className="flex w-full items-start gap-3 rounded-md px-3 py-2.5 text-left transition-colors hover:bg-white/[0.06]"
            >
              <span className="mt-0.5 text-zinc-400">{o.icon}</span>
              <span>
                <span className="block text-[13px] text-white">{o.label}</span>
                <span className="block text-[12px] text-zinc-500">{o.hint}</span>
              </span>
            </button>
          ))}
        </motion.div>
      )}
    </div>
  )
}

// ── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  const [query, setQuery] = useState(() => new URLSearchParams(location.search).get('domain') ?? '')
  const [scanning, setScanning] = useState(false)
  const [scanStep, setScanStep] = useState(0)
  const [result, setResult] = useState<ScanResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [deploy, setDeploy] = useState<Deploy>('idle')
  const [ticked, setTicked] = useState(0)
  const [block, setBlock] = useState<LedgerBlock | null>(null)
  const [verification, setVerification] = useState<Verification | null>(null)
  const [tampered, setTampered] = useState(false)
  const [shock, setShock] = useState(0)
  const abort = useRef<AbortController | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const planRef = useRef<HTMLDivElement>(null)
  const proofRef = useRef<HTMLDivElement>(null)

  const before = useMemo(() => (result ? cryptoFromScan(result) : null), [result])
  const plan = useMemo(() => (result && before ? actionPlan(result, before) : []), [result, before])
  const fixed = deploy === 'done'
  const diag = result && before ? diagnose(result, before, fixed) : null
  const failed = result ? failures(result) : []
  const nothingToFix = plan.length > 0 && plan.filter((p) => p.id !== 'ledger').every((p) => p.preexisting)

  const scan = useCallback(async (raw: string) => {
    const domain = raw.trim()
    if (!domain) return
    abort.current?.abort()
    const ctrl = new AbortController()
    abort.current = ctrl
    setError(null)
    setResult(null)
    setDeploy('idle')
    setTicked(0)
    setBlock(null)
    setVerification(null)
    setTampered(false)
    setScanning(true)
    setScanStep(0)
    const url = new URL(location.href)
    url.searchParams.set('domain', domain)
    history.replaceState(null, '', url)
    try {
      const [res] = await Promise.all([scanDomain(domain, ctrl.signal), sleep(1500)])
      if (ctrl.signal.aborted) return
      setResult(res)
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError((e as Error).message)
    } finally {
      if (!ctrl.signal.aborted) setScanning(false)
    }
  }, [])

  useEffect(() => {
    if (!scanning) return
    const id = setInterval(() => setScanStep((s) => Math.min(SCAN_STEPS.length - 1, s + 1)), 360)
    return () => clearInterval(id)
  }, [scanning])

  const booted = useRef(false)
  useEffect(() => {
    if (booted.current) return
    booted.current = true
    if (query) scan(query)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const deployPatch = async () => {
    if (!result || !before) return
    setDeploy('running')
    for (let i = 1; i <= plan.length - 1; i++) {
      await sleep(650)
      setTicked(i)
    }
    const m = mosca(4, 10, before)
    const records = [
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
      { label: 'Assess', data: { urgency: result.assessment.urgency.level, failing: failed.map((f) => f.name), mosca: { x: m.x, y: m.y, z: m.z, verdict: m.verdict } } },
      { label: 'Remediate', data: { simulated: true, before, after: MIGRATED, plan: plan.map((p) => p.title) } },
    ]
    const [b] = await Promise.all([anchor(result.domain, records), sleep(600)])
    setBlock(b)
    setVerification(await verify(b))
    setTicked(plan.length)
    setDeploy('done')
    setShock((s) => s + 1)
    setTimeout(() => proofRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 200)
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
    setScanning(false)
    setDeploy('idle')
    setError(null)
    setQuery('')
    history.replaceState(null, '', location.pathname)
    setTimeout(() => inputRef.current?.focus(), 50)
  }

  const exportPdf = () => result && exportPdfReport(result, { fixed, plan, block, verification })
  const exportJson = () => result && exportCbomJson(result)

  const core: CoreState = scanning
    ? 'scanning'
    : !result || !diag
      ? 'idle'
      : deploy === 'running'
        ? 'upgrading'
        : diag.tone === 'safe'
          ? 'secured'
          : diag.tone === 'risk'
            ? 'critical'
            : 'vulnerable'

  // Left-panel copy
  const headline = scanning
    ? `Checking ${query.trim()}…`
    : diag
      ? diag.headline
      : 'Find the locks quantum computers will break.'
  const meaning = scanning
    ? 'Opening a live, encrypted connection and reading which locks this server uses to prove its identity and protect traffic.'
    : diag
      ? diag.meaning
      : 'Every website proves who it is with a digital lock. Quantum computers are being built to pick today’s locks. Scan an endpoint to see if yours is at risk, then fix it in one click.'

  return (
    <div className="relative min-h-dvh bg-black text-white lg:h-dvh lg:overflow-hidden">
      <div className="fixed inset-0" aria-hidden>
        <CryptoCore state={core} shockKey={shock} side="left" />
      </div>
      <div className="pointer-events-none fixed inset-0 bg-gradient-to-t from-black via-black/10 to-transparent lg:bg-gradient-to-tr lg:from-black/90 lg:via-transparent" aria-hidden />

      {/* Top bar with the sticky export */}
      <header className="fixed inset-x-0 top-0 z-30 flex h-16 items-center justify-between border-b border-zinc-800/70 bg-black/40 px-6 backdrop-blur-xl lg:px-10">
        <button onClick={reset} className="flex items-center gap-2.5" aria-label="New scan">
          <svg viewBox="0 0 20 20" className="size-5" aria-hidden>
            <circle cx="10" cy="10" r="8" fill="none" stroke="white" strokeWidth="1.3" />
            <path d="M2 10h16M10 2c3 2.5 3 13.5 0 16M10 2c-3 2.5-3 13.5 0 16" stroke="white" strokeWidth="1" fill="none" opacity="0.6" />
          </svg>
          <span className="text-[14px] font-medium">PQC Scanner</span>
          <span className="hidden text-[13px] text-zinc-500 sm:inline">· Quantum readiness for TLS endpoints</span>
        </button>
        <ExportMenu enabled={!!result} highlight={fixed} onPdf={exportPdf} onJson={exportJson} />
      </header>

      <div className="relative z-10 grid lg:h-full lg:grid-cols-2">
        {/* Left: diagnosis over the 3D core */}
        <section className="flex min-h-[80vh] flex-col justify-end px-6 pt-[42vh] pb-12 lg:min-h-0 lg:px-12 lg:pb-16">
          <motion.div key={headline} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease: [0.2, 0, 0, 1] }} className="max-w-xl">
              {diag && !scanning && (
                <span className="inline-flex items-center gap-2 rounded-full border border-zinc-800 bg-black/50 px-3 py-1 text-[12px] text-zinc-300 backdrop-blur-xl">
                  <span className={`size-1.5 rounded-full ${TONE_DOT[diag.tone]}`} /> {TONE_LABEL[diag.tone]}
                </span>
              )}
              <h1 className="mt-4 text-4xl leading-[1.08] font-semibold tracking-[-0.035em] text-balance sm:text-5xl">{headline}</h1>
              <div className="mt-6 border-l border-zinc-700 pl-4">
                <div className="text-[12px] font-medium tracking-wide text-zinc-500 uppercase">What this means</div>
                <p className="mt-1.5 text-[17px] leading-relaxed text-zinc-300">{meaning}</p>
              </div>
          </motion.div>
        </section>

        {/* Right: the engineer's action plan */}
        <aside className="border-zinc-800 bg-black/50 backdrop-blur-xl lg:flex lg:min-h-0 lg:flex-col lg:border-l lg:pt-16">
          <div ref={planRef} className="px-6 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:px-10">
          <div className="mx-auto max-w-xl py-4">
            <div className="pt-6 pb-2">
              <div className="text-[12px] font-medium tracking-wide text-zinc-500 uppercase">Action plan</div>
              <form
                className="mt-4 flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault()
                  scan(query)
                }}
              >
                <input
                  ref={inputRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Endpoint to check, e.g. github.com"
                  aria-label="Endpoint to scan"
                  autoFocus={!query}
                  spellCheck={false}
                  autoCapitalize="none"
                  className="h-11 min-w-0 flex-1 rounded-md border border-zinc-800 bg-black/50 px-4 font-mono text-[13px] text-white transition-colors outline-none placeholder:font-sans placeholder:text-zinc-600 focus:border-zinc-500"
                />
                <button
                  type="submit"
                  disabled={scanning || !query.trim()}
                  className={`inline-flex h-11 items-center gap-2 rounded-md px-5 text-[13px] font-medium transition-colors disabled:opacity-40 ${
                    result ? 'border border-zinc-800 text-zinc-200 hover:border-zinc-600' : 'bg-white text-black hover:bg-zinc-200'
                  }`}
                >
                  {scanning ? <Loader2 size={14} className="animate-spin" /> : <ArrowRight size={14} />}
                  {scanning ? 'Scanning' : result ? 'Rescan' : 'Scan'}
                </button>
              </form>
              {!result && !scanning && (
                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-zinc-600">
                  Try
                  {EXAMPLES.map((d) => (
                    <button key={d} onClick={() => { setQuery(d); scan(d) }} className="font-mono text-zinc-400 hover:text-white">
                      {d}
                    </button>
                  ))}
                </div>
              )}
              {scanning && (
                <ol className="mt-5 space-y-2 font-mono text-[12px]">
                  {SCAN_STEPS.map((s, i) => (
                    <li key={s} className={`flex items-center gap-2 ${i < scanStep ? 'text-zinc-400' : i === scanStep ? 'text-white' : 'text-zinc-700'}`}>
                      {i < scanStep ? <Check size={12} className="text-safe" /> : i === scanStep ? <Loader2 size={12} className="animate-spin" /> : <Circle size={12} />}
                      {s}
                    </li>
                  ))}
                </ol>
              )}
              {error && (
                <p className="mt-4 flex items-center gap-2 text-[13px] text-zinc-200" role="alert">
                  <span className="size-1.5 rounded-full bg-risk" /> {error}
                </p>
              )}
            </div>

            {/* 1 · Vulnerability */}
            <Section n={1} title="The vulnerability" state={!result ? 'upcoming' : fixed ? 'done' : 'active'}>
              {result && before ? (
                <>
                  <div className="font-mono text-[15px] text-white">{result.domain}:443</div>
                  <div className="mt-1 font-mono text-[12px] text-zinc-500">
                    {result.resolved_ip} · {result.tls.version} · issued by {result.certificate.issuer_cn}
                  </div>
                  {failed.length ? (
                    <ul className="mt-5 divide-y divide-zinc-800 rounded-lg border border-zinc-800">
                      {failed.map((f) => (
                        <li key={f.name} className="flex items-center justify-between gap-4 px-4 py-3">
                          <span className="flex items-center gap-3">
                            <span className={`size-1.5 rounded-full ${fixed ? 'bg-zinc-600' : 'bg-risk'}`} />
                            <span className={`font-mono text-[13px] ${fixed ? 'text-zinc-500 line-through' : 'text-white'}`}>{f.name}</span>
                          </span>
                          <span className="text-[12px] text-zinc-500">{ROLE[f.primitive] ?? f.primitive} · {fixed ? 'replaced (simulated)' : 'breakable by quantum'}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-4 flex items-center gap-2 text-[13px] text-zinc-300"><span className="size-1.5 rounded-full bg-safe" /> No quantum-vulnerable algorithms found.</p>
                  )}
                  {!fixed && failed.length > 0 && (
                    <p className="mt-4 text-[13px] text-zinc-400">
                      <span className="text-zinc-200">Priority {result.assessment.urgency.level.toLowerCase()}.</span> {result.assessment.urgency.deadline}.
                    </p>
                  )}
                  <Disclosure label={`View full CBOM (${result.cbom_summary.length} algorithms)`}>
                    <DetectDetails result={result} migrated={false} />
                  </Disclosure>
                </>
              ) : (
                <p className="text-[13px] text-zinc-500">The failing asset and algorithms appear here after a scan.</p>
              )}
            </Section>

            {/* 2 · Fix */}
            <Section n={2} title="The 1-click fix" state={!result ? 'upcoming' : fixed ? 'done' : 'active'}>
              {result && before ? (
                <>
                  <ul className="space-y-3">
                    {plan.map((p, i) => {
                      const done = p.preexisting || i < ticked || fixed
                      const running = deploy === 'running' && i === ticked && !p.preexisting
                      return (
                        <li key={p.id} className="flex gap-3">
                          <span className="mt-0.5 shrink-0">
                            {done ? <Check size={15} className="text-safe" /> : running ? <Loader2 size={15} className="animate-spin text-zinc-300" /> : <Circle size={15} className="text-zinc-600" />}
                          </span>
                          <span>
                            <span className={`block text-[14px] ${done ? 'text-zinc-300' : 'text-white'}`}>{p.title}</span>
                            <span className="mt-0.5 block text-[12px] text-zinc-500">
                              {p.standard} · {p.preexisting ? 'already compliant' : p.detail}
                            </span>
                          </span>
                        </li>
                      )
                    })}
                  </ul>
                  <Disclosure label="What the patch does">
                    <DefendDetails domain={result.domain} before={before} done={fixed} />
                  </Disclosure>
                </>
              ) : (
                <p className="text-[13px] text-zinc-500">A step-by-step fix and a one-click patch appear here.</p>
              )}
            </Section>

            {/* 3 · Proof */}
            <div ref={proofRef} className="scroll-mt-4" />
            <Section n={3} title="The proof" state={fixed ? (verification?.valid ? 'done' : 'active') : 'upcoming'}>
              {fixed && block && verification ? (
                <>
                  <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }} className="rounded-lg border border-zinc-800 bg-black/40 p-5">
                    <div className="flex items-center gap-3">
                      <span className={`grid size-8 place-items-center rounded-full ${verification.valid ? 'bg-safe/15 text-safe' : 'bg-risk/15 text-risk'}`}>
                        {verification.valid ? <Check size={17} strokeWidth={2.5} /> : '!'}
                      </span>
                      <div className="text-[16px] font-medium text-white">
                        {verification.valid ? 'Endpoint Secured. Hash anchored to Ledger.' : 'Record altered: the ledger no longer verifies.'}
                      </div>
                    </div>
                    <dl className="mt-4 grid grid-cols-[110px_1fr] gap-y-1.5 font-mono text-[12px]">
                      <dt className="text-zinc-500">block</dt>
                      <dd className="text-zinc-200">#{block.index}</dd>
                      <dt className="text-zinc-500">block hash</dt>
                      <dd className="truncate text-zinc-200" title={block.block_hash}>{block.block_hash}</dd>
                      <dt className="text-zinc-500">verified</dt>
                      <dd className={verification.valid ? 'text-safe' : 'text-risk'}>{String(verification.valid)}</dd>
                    </dl>
                  </motion.div>

                  <p className="mt-4 text-[13px] text-zinc-400">
                    Next: send the CBOM report to your compliance team. It includes this proof, the certificate details and the action plan.
                  </p>
                  <Disclosure label="View ledger proof">
                    <ProveDetails block={block} verification={verification} tampered={tampered} onTamperToggle={toggleTamper} />
                  </Disclosure>
                </>
              ) : (
                <p className="text-[13px] text-zinc-500">After the fix, a SHA-256 proof is anchored to the ledger and shown here.</p>
              )}
            </Section>
          </div>
          </div>

          {/* Sticky next action: the admin never has to hunt for the button */}
          {result && (
            <div className="sticky bottom-0 z-10 border-t border-zinc-800 bg-black/80 px-6 py-4 backdrop-blur-xl lg:px-10">
              <div className="mx-auto max-w-xl">
                {!fixed ? (
                  <>
                    <button
                      onClick={deployPatch}
                      disabled={deploy === 'running'}
                      className="inline-flex h-12 w-full items-center justify-center gap-2.5 rounded-md bg-white text-[15px] font-semibold text-black transition-colors hover:bg-zinc-200 disabled:opacity-60"
                    >
                      {deploy === 'running' ? <Loader2 size={17} className="animate-spin" /> : <ShieldCheck size={17} />}
                      {deploy === 'running' ? 'Deploying patch…' : nothingToFix ? 'Anchor scan to ledger' : 'Deploy ML-DSA-65 Quantum Patch'}
                    </button>
                    <p className="mt-2 text-center text-[12px] text-zinc-500">Simulation: builds and verifies the patch; your server is not modified.</p>
                  </>
                ) : (
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="flex w-full items-center gap-2 text-[13px] text-zinc-300">
                      <span className={`size-1.5 rounded-full ${verification?.valid ? 'bg-safe' : 'bg-risk'}`} />
                      {verification?.valid ? `Endpoint secured · block #${block?.index} verified` : 'Ledger check failed'}
                    </span>
                    <button onClick={exportPdf} className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-md bg-white px-4 text-[14px] font-semibold text-black hover:bg-zinc-200">
                      <FileText size={15} /> Download PDF report
                    </button>
                    <button onClick={reset} className="inline-flex h-11 items-center gap-2 rounded-md border border-zinc-800 px-4 text-[13px] text-zinc-200 hover:border-zinc-600">
                      <RotateCcw size={14} /> Next endpoint
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}
