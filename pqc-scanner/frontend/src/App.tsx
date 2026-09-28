import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { AlertCircle, ArrowRight, Loader2, Search } from 'lucide-react'
import { scanDomain, type ScanResult } from './api'
import { CipherGlobe, type Phase } from './scene/CipherGlobe'
import { Results, TONE } from './components/Results'

const EXAMPLES = ['cloudflare.com', 'google.com', 'github.com', 'microsoft.com', 'example.org']
const STEPS = [
  'Resolving and vetting address…',
  'Sending ClientHello with X25519MLKEM768…',
  'Reading the ServerHello key share…',
  'Fetching the certificate chain…',
  'Scoring PQC readiness…',
]
const MIN_SCAN_MS = 1600 // let the scan animation read, even when the API is fast

export default function App() {
  const [query, setQuery] = useState(() => new URLSearchParams(location.search).get('domain') ?? '')
  const [phase, setPhase] = useState<Phase>('idle')
  const [result, setResult] = useState<ScanResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [step, setStep] = useState(0)
  const abort = useRef<AbortController | null>(null)
  const resultsRef = useRef<HTMLDivElement>(null)

  const scan = useCallback(async (raw: string) => {
    const domain = raw.trim()
    if (!domain) return
    abort.current?.abort()
    const ctrl = new AbortController()
    abort.current = ctrl
    setError(null)
    setPhase('scanning')
    setStep(0)
    const url = new URL(location.href)
    url.searchParams.set('domain', domain)
    history.replaceState(null, '', url)
    try {
      const [res] = await Promise.all([scanDomain(domain, ctrl.signal), new Promise((r) => setTimeout(r, MIN_SCAN_MS))])
      if (ctrl.signal.aborted) return
      setResult(res)
      setPhase('result')
      setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 350)
    } catch (e) {
      if ((e as Error).name === 'AbortError') return
      setError((e as Error).message)
      setPhase(result ? 'result' : 'idle')
    }
  }, [result])

  // Cycle the scanning status line.
  useEffect(() => {
    if (phase !== 'scanning') return
    const id = setInterval(() => setStep((s) => Math.min(STEPS.length - 1, s + 1)), 380)
    return () => clearInterval(id)
  }, [phase])

  // Deep link: ?domain=example.org scans on load.
  const booted = useRef(false)
  useEffect(() => {
    if (booted.current) return
    booted.current = true
    if (query) scan(query)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const tone = phase === 'result' && result ? result.assessment.color : null
  const busy = phase === 'scanning'

  return (
    <div className="relative min-h-full overflow-x-hidden">
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
          Live TLS handshake · FIPS 203 ML-KEM · FIPS 204 ML-DSA
        </span>
      </header>

      <main className="relative z-10 mx-auto max-w-5xl px-5 pb-24">
        <section className="pt-6 text-center sm:pt-10">
          <h1 className="text-3xl font-semibold tracking-tight text-balance text-white sm:text-5xl">
            Is your domain ready for <span className="bg-gradient-to-r from-sky-300 via-emerald-300 to-teal-200 bg-clip-text text-transparent">quantum computers</span>?
          </h1>
          <p className="mx-auto mt-3 max-w-2xl text-sm text-balance text-zinc-400 sm:text-base">
            We open a real TLS connection, offer hybrid post-quantum key exchange, and inspect the certificate the server signs with.
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
              disabled={busy || !query.trim()}
              className="flex shrink-0 items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-zinc-950 transition hover:bg-sky-100 disabled:opacity-50"
            >
              {busy ? <Loader2 size={16} className="animate-spin" /> : <ArrowRight size={16} />}
              {busy ? 'Scanning' : 'Scan'}
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
                disabled={busy}
                className="rounded-full border border-white/10 px-3 py-1 font-mono text-xs text-zinc-400 transition hover:border-white/25 hover:text-white disabled:opacity-40"
              >
                {d}
              </button>
            ))}
          </div>

          <AnimatePresence>
            {error && (
              <motion.p
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                role="alert"
                className="mx-auto mt-4 flex max-w-xl items-center justify-center gap-2 text-sm text-rose-300"
              >
                <AlertCircle size={15} /> {error}
              </motion.p>
            )}
          </AnimatePresence>
        </section>

        <section className="relative mt-4 h-[44vh] min-h-[300px] sm:h-[48vh]" aria-label="Scan visualisation">
          {/* soft radial mask so the canvas has no visible edges */}
          <div className="absolute inset-0 [mask-image:radial-gradient(ellipse_at_center,black_45%,transparent_78%)]">
            <CipherGlobe phase={phase} tone={tone} />
          </div>
          <div className="pointer-events-none absolute inset-x-0 bottom-2 text-center">
            {phase === 'scanning' && (
              <motion.p key={step} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="font-mono text-xs text-sky-300/90">
                {STEPS[step]}
              </motion.p>
            )}
            {phase === 'result' && result && (
              <p className={`font-mono text-xs ${TONE[result.assessment.color].text}`}>
                {result.domain} · {result.tls.key_exchange.group} · {result.certificate.public_key.name}
              </p>
            )}
            {phase === 'idle' && <p className="font-mono text-xs text-zinc-600">awaiting target</p>}
          </div>
        </section>

        <div ref={resultsRef} className="scroll-mt-6">
          <AnimatePresence mode="popLayout">{result && <Results key={result.domain + result.scanned_at} result={result} />}</AnimatePresence>
        </div>

        <footer className="mt-12 text-center text-xs text-zinc-600">
          Only the public TLS handshake is read. Nothing is stored beyond a 5-minute result cache. Private and internal addresses are refused.
        </footer>
      </main>
    </div>
  )
}
