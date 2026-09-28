import { motion } from 'framer-motion'
import { AlertTriangle, ArrowRight, BadgeCheck, Clock, Download, FileKey2, KeyRound, Lock, ShieldAlert, ShieldCheck, Waypoints } from 'lucide-react'
import type { ReactNode } from 'react'
import type { ScanResult, Tone } from '../api'

export const TONE: Record<Tone, { text: string; bg: string; ring: string; hex: string }> = {
  emerald: { text: 'text-emerald-300', bg: 'bg-emerald-400/10', ring: 'ring-emerald-400/40', hex: '#34d399' },
  amber: { text: 'text-amber-300', bg: 'bg-amber-400/10', ring: 'ring-amber-400/40', hex: '#fbbf24' },
  crimson: { text: 'text-rose-300', bg: 'bg-rose-500/10', ring: 'ring-rose-400/50', hex: '#f43f5e' },
}

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })

function Card({ title, icon, children, className = '' }: { title: string; icon: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl border border-white/[0.08] bg-white/[0.03] p-5 ${className}`}>
      <h3 className="mb-3 flex items-center gap-2 text-[11px] font-semibold tracking-[0.14em] text-zinc-400 uppercase">
        <span className="text-zinc-500">{icon}</span>
        {title}
      </h3>
      {children}
    </section>
  )
}

function Field({ label, children, mono }: { label: string; children: ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-white/[0.05] py-2 last:border-0">
      <dt className="shrink-0 text-xs text-zinc-500">{label}</dt>
      <dd className={`min-w-0 text-right text-sm break-words text-zinc-100 ${mono ? 'font-mono text-[13px]' : ''}`}>{children}</dd>
    </div>
  )
}

function Verdict({ safe }: { safe: boolean }) {
  return safe ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-400/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-300">
      <ShieldCheck size={12} /> Quantum-safe
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/10 px-2 py-0.5 text-[11px] font-semibold text-rose-300">
      <ShieldAlert size={12} /> Shor-vulnerable
    </span>
  )
}

function ScoreRing({ score, tone, grade }: { score: number; tone: Tone; grade: string }) {
  const r = 46
  const c = 2 * Math.PI * r
  return (
    <div className="relative size-32 shrink-0">
      <svg viewBox="0 0 120 120" className="size-full -rotate-90">
        <circle cx="60" cy="60" r={r} fill="none" stroke="rgb(255 255 255 / 0.08)" strokeWidth="9" />
        <motion.circle
          cx="60"
          cy="60"
          r={r}
          fill="none"
          stroke={TONE[tone].hex}
          strokeWidth="9"
          strokeLinecap="round"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: c * (1 - score / 100) }}
          transition={{ duration: 1.2, ease: [0.22, 1, 0.36, 1] }}
          style={{ filter: `drop-shadow(0 0 8px ${TONE[tone].hex})` }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-semibold tracking-tight text-white tabular-nums">{score}</span>
        <span className="text-[10px] tracking-widest text-zinc-500 uppercase">PQC score</span>
        <span className="mt-0.5 text-[11px] font-semibold text-zinc-300">Grade {grade}</span>
      </div>
    </div>
  )
}

export function Results({ result }: { result: ScanResult }) {
  const a = result.assessment
  const tone = TONE[a.color]
  const cert = result.certificate
  const kx = result.tls.key_exchange
  const downloadCbom = () => {
    const blob = new Blob([JSON.stringify(result.cbom, null, 2)], { type: 'application/vnd.cyclonedx+json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${result.domain}.cbom.cdx.json`
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 160, damping: 22 }}
      className="rounded-3xl border border-white/10 bg-zinc-950/60 p-4 shadow-[0_40px_120px_-40px_rgb(0_0_0/0.9)] backdrop-blur-2xl sm:p-6"
    >
      {/* Verdict */}
      <div className={`flex flex-col gap-5 rounded-2xl p-5 ring-1 sm:flex-row sm:items-center ${tone.bg} ${tone.ring}`}>
        <ScoreRing score={a.score} tone={a.color} grade={a.grade} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold tracking-wider ring-1 ${tone.text} ${tone.ring}`}>
              {a.color === 'emerald' ? <ShieldCheck size={14} /> : <AlertTriangle size={14} />}
              {a.badge}
            </span>
            <span className="font-mono text-xs text-zinc-400">
              {result.domain} · {result.resolved_ip} · {result.duration_ms} ms{result.cached ? ' · cached' : ''}
            </span>
          </div>
          <h2 className={`mt-2 text-lg leading-snug font-semibold sm:text-xl ${tone.text}`}>{a.headline}</h2>
          <p className="mt-2 text-sm text-zinc-400">
            <span className="font-semibold text-zinc-200">Urgency: {a.urgency.level}.</span> {a.urgency.reason}{' '}
            <span className="text-zinc-300">{a.urgency.deadline}.</span>
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="Key exchange & protocol" icon={<Waypoints size={14} />}>
          <dl>
            <Field label="Negotiated group" mono>
              <span className="mr-2">{kx.group ?? 'unknown'}</span>
              <Verdict safe={kx.pq_hybrid} />
            </Field>
            <Field label="Protocol" mono>{result.tls.version}</Field>
            <Field label="Cipher suite" mono>{result.tls.cipher_suite}</Field>
            <Field label="We offered">
              <span className="font-mono text-xs text-zinc-400">{kx.offered.join(' · ')}</span>
            </Field>
          </dl>
          {kx.notes.map((n) => (
            <p key={n} className="mt-2 text-xs text-zinc-500">{n}</p>
          ))}
        </Card>

        <Card title="Certificate" icon={<FileKey2 size={14} />}>
          <dl>
            <Field label="Common name" mono>{cert.subject_cn ?? '—'}</Field>
            <Field label="Issuer">{cert.issuer_cn}{cert.issuer_org ? ` · ${cert.issuer_org}` : ''}</Field>
            <Field label="Validity">
              {fmtDate(cert.not_before)} → {fmtDate(cert.not_after)}
              <span className={`ml-2 text-xs ${cert.days_remaining < 30 ? 'text-amber-300' : 'text-zinc-500'}`}>({cert.days_remaining} d left)</span>
            </Field>
            <Field label="Public key" mono>
              <span className="mr-2">{cert.public_key.name}</span>
              <Verdict safe={['ML-DSA', 'SLH-DSA'].includes(cert.public_key.family)} />
            </Field>
            <Field label="Signature" mono>{cert.signature.name}</Field>
            <Field label="Trust">
              {cert.trusted ? (
                <span className="inline-flex items-center gap-1 text-emerald-300"><BadgeCheck size={14} /> Valid chain</span>
              ) : (
                <span className="text-rose-300">{cert.verify_error}</span>
              )}
            </Field>
          </dl>
        </Card>
      </div>

      <Card title="Risk breakdown" icon={<Lock size={14} />} className="mt-4">
        <div className="space-y-3">
          {a.breakdown.map((b) => (
            <div key={b.component}>
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <div className="text-sm text-zinc-100">
                  {b.component} <span className="ml-1 font-mono text-xs text-zinc-400">{b.algorithm}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`text-xs font-medium ${b.quantum_safe ? 'text-emerald-300' : 'text-rose-300'}`}>{b.category}</span>
                  <span className="w-14 text-right font-mono text-xs text-zinc-400 tabular-nums">{b.points}/{b.weight}</span>
                </div>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                <motion.div
                  className={`h-full rounded-full ${b.quantum_safe ? 'bg-emerald-400' : 'bg-rose-500/70'}`}
                  initial={{ width: 0 }}
                  animate={{ width: b.quantum_safe ? '100%' : '6%' }}
                  transition={{ duration: 0.9, delay: 0.2 }}
                />
              </div>
              <p className="mt-1 text-xs text-zinc-500">{b.threat}</p>
            </div>
          ))}
        </div>
        <p className="mt-4 border-t border-white/[0.06] pt-3 text-xs text-zinc-500">
          The best score a public website can reach today is {a.max_achievable_today}/100: public certificate authorities don't issue ML-DSA
          (FIPS 204) certificates yet.
        </p>
      </Card>

      <Card title="Cryptographic bill of materials" icon={<KeyRound size={14} />} className="mt-4">
        <div className="-mx-1 overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead>
              <tr className="text-[11px] tracking-wider text-zinc-500 uppercase">
                <th className="px-1 pb-2 font-medium">Algorithm</th>
                <th className="px-1 pb-2 font-medium">Primitive</th>
                <th className="px-1 pb-2 font-medium">OID</th>
                <th className="px-1 pb-2 font-medium">NIST level</th>
                <th className="px-1 pb-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {result.cbom_summary.map((row) => (
                <tr key={row.name} className="border-t border-white/[0.05]">
                  <td className="px-1 py-2 font-mono text-[13px] text-zinc-100">{row.name}</td>
                  <td className="px-1 py-2 text-zinc-400">{row.primitive}</td>
                  <td className="px-1 py-2 font-mono text-xs text-zinc-500">{row.oid ?? '—'}</td>
                  <td className="px-1 py-2 font-mono text-zinc-300">{row.nist_level || '—'}</td>
                  <td className="px-1 py-2"><Verdict safe={row.quantum_safe} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button
          onClick={downloadCbom}
          className="mt-3 inline-flex items-center gap-2 rounded-full border border-white/10 px-3 py-1.5 text-xs font-medium text-zinc-300 transition hover:border-white/25 hover:text-white"
        >
          <Download size={13} /> Download CycloneDX 1.6 CBOM
        </button>
      </Card>

      <Card title="Recommended migration path" icon={<Clock size={14} />} className="mt-4">
        <ol className="space-y-3">
          {a.recommendations.map((r, i) => (
            <li key={r.title} className="flex gap-3">
              <span className="grid size-6 shrink-0 place-items-center rounded-full bg-white/[0.06] font-mono text-xs text-zinc-300">{i + 1}</span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-zinc-100">
                  {r.title}
                  {r.standard && <span className="rounded-full bg-sky-400/10 px-2 py-0.5 text-[11px] font-medium text-sky-300">{r.standard}</span>}
                </div>
                <p className="mt-1 text-sm break-words text-zinc-400">{r.detail}</p>
              </div>
            </li>
          ))}
        </ol>
        <p className="mt-4 flex items-center gap-1.5 text-xs text-zinc-500">
          <ArrowRight size={12} /> Target state: X25519MLKEM768 (FIPS 203) key exchange + ML-DSA-65 (FIPS 204) certificates.
        </p>
      </Card>
    </motion.div>
  )
}
