import type { ReactNode } from 'react'
import { motion } from 'framer-motion'
import { ArrowRight } from 'lucide-react'
import '@fontsource-variable/geist'
import { BASE_YEAR, Z_YEARS } from '../lib/mosca'

// The QuantumLedger gateway: an austere briefing page in front of the 3D console.
// Onyx ground, off-white type, hairline neutral borders; emerald (#059669) is reserved for the one primary action.

const ease = [0.2, 0, 0, 1] as const
const rise = { hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0, transition: { duration: 0.6, ease } } }
const stagger = { hidden: {}, show: { transition: { staggerChildren: 0.08 } } }

const FACTS: [string, string][] = [
  ['FIPS 203 · 204', 'ML-KEM and ML-DSA, the NIST post-quantum standards we test against'],
  ['2029', 'DST task-force deadline for critical information infrastructure'],
  ['0', 'Cloud dependencies'],
]

const TIMELINE: [string, string, string][] = [
  ['Today', 'Harvest', 'Adversaries record encrypted TLS traffic at scale and store it.'],
  ['2029', 'Deadline', 'DST task-force target for post-quantum migration of critical systems.'],
  [`${BASE_YEAR + Z_YEARS}+`, 'Decrypt', 'A cryptographically relevant quantum computer runs Shor’s algorithm on the archive.'],
]

const PILLARS: { n: string; title: string; body: string; detail: ReactNode }[] = [
  {
    n: '01',
    title: 'Mathematical risk scoring',
    body: 'Every asset is scored with Mosca’s theorem. If the years your data must stay secret (X) plus the years your migration will take (Y) exceed the years until a quantum adversary exists (Z), that data is already exposed.',
    detail: (
      <>
        <span className="text-[#FAFAFA]">X + Y &gt; Z</span> <span className="text-neutral-600">⇒</span> exposed today
      </>
    ),
  },
  {
    n: '02',
    title: 'Air-gapped execution',
    body: 'The TLS probe, risk engine, CBOM export and compliance report all run on the operator’s machine. No cloud services, no telemetry, nothing to clear with a third party. Built to be deployed inside CII perimeters.',
    detail: <>scanner · scoring · reporting → localhost</>,
  },
  {
    n: '03',
    title: 'Verifiable proof',
    body: 'Each assessment is sealed into a hash-chained Merkle ledger with hybrid classical and post-quantum signatures, so auditors can independently verify that findings and remediations have not been altered.',
    detail: <>SHA-256 Merkle root · Ed25519 + ML-DSA-65</>,
  },
]

function Section({ id, eyebrow, title, children }: { id: string; eyebrow: string; title: string; children: ReactNode }) {
  return (
    <motion.section id={id} variants={stagger} initial="hidden" whileInView="show" viewport={{ once: true, margin: '-80px' }} className="border-t border-neutral-800 py-24 sm:py-32">
      <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] lg:gap-20">
        <motion.div variants={rise}>
          <p className="font-mono text-[11px] tracking-[0.14em] text-neutral-500 uppercase">{eyebrow}</p>
          <h2 className="mt-4 font-display text-3xl leading-[1.1] font-semibold tracking-[-0.03em] text-[#FAFAFA] sm:text-4xl">{title}</h2>
        </motion.div>
        <div>{children}</div>
      </div>
    </motion.section>
  )
}

export function LandingPage({ onLaunch, onIntent }: { onLaunch: () => void; onIntent?: () => void }) {
  return (
    <div className="min-h-dvh bg-[#09090B] font-sans text-[#FAFAFA] antialiased selection:bg-white/15">
      <header className="sticky top-0 z-10 border-b border-neutral-800 bg-[#09090B]/90 backdrop-blur-sm">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-8">
          <a href="#top" className="flex items-center gap-2.5" aria-label="QuantumLedger home">
            <svg viewBox="0 0 20 20" className="size-[18px]" aria-hidden>
              <rect x="1.5" y="1.5" width="17" height="17" fill="none" stroke="#FAFAFA" strokeWidth="1.3" />
              <path d="M6 6h8v8H6z" fill="none" stroke="#FAFAFA" strokeWidth="1" opacity="0.5" />
            </svg>
            <span className="font-display text-[15px] font-semibold tracking-[-0.01em]">QuantumLedger</span>
          </a>
          <nav className="flex items-center gap-6 text-[13px] text-neutral-400">
            <a href="#threat" className="hidden transition-colors hover:text-[#FAFAFA] sm:inline">Threat</a>
            <a href="#approach" className="hidden transition-colors hover:text-[#FAFAFA] sm:inline">Approach</a>
            <button onClick={onLaunch} onPointerEnter={onIntent} onFocus={onIntent} className="transition-colors hover:text-[#FAFAFA]">
              Open console
            </button>
          </nav>
        </div>
      </header>

      <main id="top" className="mx-auto max-w-6xl px-4 sm:px-8">
        {/* ── hero ── */}
        <motion.section variants={stagger} initial="hidden" animate="show" className="pt-24 pb-20 sm:pt-36 sm:pb-28">
          <motion.p variants={rise} className="font-mono text-[11px] tracking-[0.14em] text-neutral-500 uppercase">
            Post-quantum readiness · TLS diagnostics
          </motion.p>
          <motion.h1 variants={rise} className="mt-6 max-w-4xl font-display text-[2.5rem] leading-[1.04] font-semibold tracking-[-0.04em] sm:text-6xl lg:text-7xl">
            QuantumLedger: Cryptographic Resilience for Critical Infrastructure.
          </motion.h1>
          <motion.p variants={rise} className="mt-8 max-w-2xl text-[17px] leading-relaxed text-neutral-400">
            Inspect the TLS key exchange and certificate chain of any endpoint, quantify its exposure to quantum attack, and produce
            audit-grade evidence of migration to NIST post-quantum standards.
          </motion.p>
          <motion.div variants={rise} className="mt-12 flex flex-col items-start gap-5 sm:flex-row sm:items-center sm:gap-8">
            <button
              onClick={onLaunch}
              onPointerEnter={onIntent}
              onFocus={onIntent}
              className="group inline-flex h-12 items-center gap-3 rounded-[3px] bg-[#059669] px-6 text-[14px] font-medium text-[#FAFAFA] transition-colors hover:bg-[#047857] focus-visible:outline-1 focus-visible:outline-offset-4 focus-visible:outline-[#FAFAFA] active:translate-y-px"
            >
              Initialize Network Diagnostics
              <ArrowRight size={16} className="transition-transform duration-200 group-hover:translate-x-0.5" aria-hidden />
            </button>
            <span className="text-[13px] text-neutral-500">Runs locally. No data leaves this machine.</span>
          </motion.div>

          <motion.dl variants={rise} className="mt-24 grid border-t border-neutral-800 sm:grid-cols-3">
            {FACTS.map(([k, v], i) => (
              <div key={k} className={`py-6 sm:pr-8 ${i > 0 ? 'border-t border-neutral-800 sm:border-t-0 sm:border-l sm:pl-8' : ''}`}>
                <dt className="font-display text-2xl font-semibold tracking-[-0.02em] tabular-nums">{k}</dt>
                <dd className="mt-2 text-[13px] leading-relaxed text-neutral-500">{v}</dd>
              </div>
            ))}
          </motion.dl>
        </motion.section>

        {/* ── the need of the hour ── */}
        <Section id="threat" eyebrow="The need of the hour" title="Encrypted today does not mean secret tomorrow.">
          <motion.div variants={rise} className="space-y-6 text-[16px] leading-[1.75] text-neutral-400">
            <p>
              <span className="text-[#FAFAFA]">Harvest Now, Decrypt Later.</span> Adversaries are already intercepting and archiving encrypted
              traffic from government, energy, telecom and financial networks. They do not need to break it today. They only need to wait.
            </p>
            <p>
              The public-key cryptography protecting that traffic, RSA and elliptic-curve (ECC), rests on factoring and discrete logarithms.
              Shor’s algorithm solves both efficiently on a sufficiently large quantum computer, which turns every recorded session into
              plaintext and every classical certificate into something that can be forged.
            </p>
            <p>
              India’s DST task force has set <span className="text-[#FAFAFA]">2029</span> as the deadline for critical information infrastructure
              to begin operating on post-quantum cryptography. Migration of this scale takes years; inventory has to start now.
            </p>
          </motion.div>

          <motion.ol variants={rise} className="mt-14 grid border border-neutral-800 sm:grid-cols-3">
            {TIMELINE.map(([year, label, text], i) => (
              <li key={label} className={`p-6 ${i > 0 ? 'border-t border-neutral-800 sm:border-t-0 sm:border-l' : ''}`}>
                <div className="flex items-baseline justify-between gap-4">
                  <span className="font-display text-xl font-semibold tracking-[-0.02em] tabular-nums">{year}</span>
                  <span className="font-mono text-[11px] tracking-[0.12em] text-neutral-500 uppercase">{label}</span>
                </div>
                <p className="mt-4 text-[13px] leading-relaxed text-neutral-400">{text}</p>
              </li>
            ))}
          </motion.ol>
        </Section>

        {/* ── how we are unique ── */}
        <Section id="approach" eyebrow="How we are unique" title="Built for operators who have to prove it.">
          <div className="grid gap-px overflow-hidden border border-neutral-800 bg-neutral-800 md:grid-cols-3">
            {PILLARS.map((p) => (
              <motion.article key={p.n} variants={rise} className="flex flex-col bg-[#09090B] p-7">
                <span className="font-mono text-[11px] tracking-[0.12em] text-neutral-600">{p.n}</span>
                <h3 className="mt-8 font-display text-lg font-semibold tracking-[-0.015em]">{p.title}</h3>
                <p className="mt-3 flex-1 text-[14px] leading-relaxed text-neutral-400">{p.body}</p>
                <p className="mt-8 border-t border-neutral-800 pt-4 font-mono text-[12px] text-neutral-500">{p.detail}</p>
              </motion.article>
            ))}
          </div>
        </Section>

        {/* ── closing action ── */}
        <motion.section variants={stagger} initial="hidden" whileInView="show" viewport={{ once: true }} className="flex flex-col items-start justify-between gap-8 border-t border-neutral-800 py-20 sm:flex-row sm:items-center">
          <motion.h2 variants={rise} className="max-w-xl font-display text-2xl leading-snug font-semibold tracking-[-0.025em] sm:text-3xl">
            Find out which of your endpoints a quantum adversary can already read.
          </motion.h2>
          <motion.button
            variants={rise}
            onClick={onLaunch}
            onPointerEnter={onIntent}
            onFocus={onIntent}
            className="inline-flex h-12 shrink-0 items-center gap-3 rounded-[3px] border border-neutral-700 px-6 text-[14px] font-medium transition-colors hover:border-neutral-500 hover:bg-white/[0.03] focus-visible:outline-1 focus-visible:outline-offset-4 focus-visible:outline-[#FAFAFA]"
          >
            Open the console
            <ArrowRight size={16} aria-hidden />
          </motion.button>
        </motion.section>
      </main>

      <footer className="border-t border-neutral-800">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-8 text-[12px] text-neutral-600 sm:flex-row sm:justify-between sm:px-8">
          <span>QuantumLedger · Post-quantum diagnostics for critical information infrastructure</span>
          <span className="font-mono">NIST FIPS 203 / 204 / 205</span>
        </div>
      </footer>
    </div>
  )
}
