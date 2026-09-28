import { motion } from 'framer-motion'
import { AlertTriangle, BadgeCheck, Download, FileKey2, KeyRound, ShieldCheck, Waypoints } from 'lucide-react'
import { forwardRef, type ReactNode } from 'react'
import type { ScanResult } from '../../api'
import { MIGRATED } from '../../lib/mosca'
import { Card, Changed, Field, ScoreRing, Stage, TONE, Verdict, type StageStatus } from '../ui'

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })

export const DetectStage = forwardRef<HTMLElement, { result: ScanResult; migrated: boolean; status: StageStatus; children?: ReactNode }>(
  function DetectStage({ result, migrated, status, children }, ref) {
    const a = result.assessment
    const tone = migrated ? 'emerald' : a.color
    const t = TONE[tone]
    const cert = result.certificate
    const kx = result.tls.key_exchange
    const keyPq = ['ML-DSA', 'SLH-DSA'].includes(cert.public_key.family)

    const rows = migrated
      ? [
          { name: MIGRATED.kex, primitive: 'kem', oid: '2.16.840.1.101.3.4.4.2', nist_level: 3, quantum_safe: true, sim: kx.group !== MIGRATED.kex },
          { name: 'ML-DSA-65', primitive: 'signature', oid: '2.16.840.1.101.3.4.3.18', nist_level: 3, quantum_safe: true, sim: true },
        ]
      : result.cbom_summary.map((r) => ({ ...r, sim: false }))

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
      <Stage ref={ref} n={1} title="Detect" subtitle="live cryptographic bill of materials" status={status} accent="#38bdf8">
        <div className={`flex flex-col gap-5 rounded-2xl p-5 ring-1 transition-colors duration-700 sm:flex-row sm:items-center ${t.bg} ${t.ring}`}>
          <ScoreRing score={migrated ? 100 : a.score} tone={tone} grade={migrated ? 'A' : a.grade} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold tracking-wider ring-1 ${t.text} ${t.ring}`}>
                {tone === 'emerald' ? <ShieldCheck size={14} /> : <AlertTriangle size={14} />}
                {migrated ? 'QUANTUM READY · SIMULATED' : a.badge}
              </span>
              <span className="font-mono text-xs text-zinc-400">
                {result.domain} · {result.resolved_ip} · {result.duration_ms} ms{result.cached ? ' · cached' : ''}
              </span>
            </div>
            <h4 className={`mt-2 text-lg leading-snug font-semibold sm:text-xl ${t.text}`}>
              {migrated ? `QUANTUM READY: ${MIGRATED.kex} key exchange with ML-DSA-65 (FIPS 204) certificate` : a.headline}
            </h4>
            {!migrated && (
              <p className="mt-2 text-sm text-zinc-400">
                Live handshake with {result.domain}:443. We offered X25519MLKEM768; the server chose{' '}
                <span className="font-mono text-zinc-200">{kx.group}</span> and presented a{' '}
                <span className="font-mono text-zinc-200">{cert.public_key.name}</span> certificate.
              </p>
            )}
          </div>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <Card title="Key exchange & protocol" icon={<Waypoints size={14} />}>
            <dl>
              <Field label="Negotiated group" mono>
                <span className="mr-2"><Changed was={kx.group ?? 'unknown'} now={migrated ? MIGRATED.kex : kx.group ?? 'unknown'} migrated={migrated} /></span>
                <Verdict safe={migrated || kx.pq_hybrid} />
              </Field>
              <Field label="Protocol" mono>{result.tls.version}</Field>
              <Field label="Cipher suite" mono>{result.tls.cipher_suite}</Field>
            </dl>
          </Card>

          <Card title="Certificate" icon={<FileKey2 size={14} />}>
            <dl>
              <Field label="Common name" mono>{cert.subject_cn ?? '—'}</Field>
              <Field label="Issuer">{migrated ? <Changed was={cert.issuer_cn ?? ''} now="ML-DSA-65 issuing CA" migrated /> : `${cert.issuer_cn ?? ''}${cert.issuer_org ? ` · ${cert.issuer_org}` : ''}`}</Field>
              <Field label="Validity">
                {fmtDate(cert.not_before)} → {fmtDate(cert.not_after)}
                <span className={`ml-2 text-xs ${cert.days_remaining < 30 ? 'text-amber-300' : 'text-zinc-500'}`}>({cert.days_remaining} d left)</span>
              </Field>
              <Field label="Public key" mono>
                <span className="mr-2"><Changed was={cert.public_key.name} now={migrated ? 'ML-DSA-65 (FIPS 204)' : cert.public_key.name} migrated={migrated} /></span>
                <Verdict safe={migrated || keyPq} />
              </Field>
              <Field label="Signature" mono>
                <Changed was={cert.signature.name} now={migrated ? 'ML-DSA-65 (FIPS 204)' : cert.signature.name} migrated={migrated} />
              </Field>
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

        <Card title={migrated ? 'CBOM · after simulated migration' : 'Cryptographic bill of materials · CycloneDX 1.6'} icon={<KeyRound size={14} />} className="mt-4">
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
                {rows.map((row, i) => (
                  <motion.tr
                    key={`${migrated}-${row.name}`}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.05 * i }}
                    className="border-t border-white/[0.05]"
                  >
                    <td className="px-1 py-2 font-mono text-[13px] text-zinc-100">
                      {row.name}
                      {row.sim && <span className="ml-2 rounded bg-emerald-400/10 px-1.5 py-0.5 font-sans text-[10px] text-emerald-300">simulated</span>}
                    </td>
                    <td className="px-1 py-2 text-zinc-400">{row.primitive}</td>
                    <td className="px-1 py-2 font-mono text-xs text-zinc-500">{row.oid ?? '—'}</td>
                    <td className="px-1 py-2 font-mono text-zinc-300">{row.nist_level || '—'}</td>
                    <td className="px-1 py-2"><Verdict safe={row.quantum_safe} /></td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
          {!migrated && (
            <button
              onClick={downloadCbom}
              className="mt-3 inline-flex items-center gap-2 rounded-full border border-white/10 px-3 py-1.5 text-xs font-medium text-zinc-300 transition hover:border-white/25 hover:text-white"
            >
              <Download size={13} /> Download live CBOM (JSON)
            </button>
          )}
        </Card>
        {children}
      </Stage>
    )
  },
)
