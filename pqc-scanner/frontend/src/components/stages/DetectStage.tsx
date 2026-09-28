import { motion } from 'framer-motion'
import { ArrowRight, Download } from 'lucide-react'
import type { ScanResult } from '../../api'
import { MIGRATED } from '../../lib/mosca'
import { Button, DataTable, KV, Panel, StageHeader, StatusLabel, Td, Th, algoStatus, reveal } from '../ui'

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })

/** Old value struck through beside the simulated new one. */
function Diff({ was, now, on }: { was: string; now: string; on: boolean }) {
  if (!on || was === now) return <>{now}</>
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-2">
      <span className="text-zinc-600 line-through">{was}</span>
      <span className="text-white">{now}</span>
    </span>
  )
}

export function DetectStage({ result, migrated, onNext, showNext }: { result: ScanResult; migrated: boolean; onNext: () => void; showNext: boolean }) {
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
    const a = document.createElement('a')
    a.href = url
    a.download = `${result.domain}.cbom.cdx.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <motion.div {...reveal}>
      <StageHeader
        n={1}
        title="Detect"
        description={`Live TLS handshake with ${result.domain}:443. We offered X25519MLKEM768 and recorded what the server actually negotiated and signed with.`}
        action={showNext && <Button onClick={onNext} icon={<ArrowRight size={14} />}>Continue to score</Button>}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Key exchange">
          <dl>
            <KV label="Negotiated group" mono>
              <span className="inline-flex flex-wrap items-center gap-3">
                <Diff was={kx.group ?? 'unknown'} now={migrated ? MIGRATED.kex : kx.group ?? 'unknown'} on={migrated} />
                <StatusLabel status={algoStatus(migrated || kx.pq_hybrid)}>{migrated || kx.pq_hybrid ? 'Post-quantum' : 'Classical'}</StatusLabel>
              </span>
            </KV>
            <KV label="Protocol" mono>{result.tls.version}</KV>
            <KV label="Cipher suite" mono>{result.tls.cipher_suite}</KV>
            <KV label="Resolved IP" mono>{result.resolved_ip}</KV>
          </dl>
        </Panel>

        <Panel title="Certificate">
          <dl>
            <KV label="Common name" mono>{cert.subject_cn ?? '—'}</KV>
            <KV label="Issuer">{migrated ? <Diff was={cert.issuer_cn ?? ''} now="ML-DSA-65 issuing CA" on /> : `${cert.issuer_cn ?? ''}${cert.issuer_org ? ` · ${cert.issuer_org}` : ''}`}</KV>
            <KV label="Validity">
              {fmtDate(cert.not_before)} – {fmtDate(cert.not_after)} <span className="text-zinc-500">· {cert.days_remaining}d left</span>
            </KV>
            <KV label="Public key" mono>
              <span className="inline-flex flex-wrap items-center gap-3">
                <Diff was={cert.public_key.name} now={migrated ? 'ML-DSA-65' : cert.public_key.name} on={migrated} />
                <StatusLabel status={algoStatus(migrated || keyPq)}>{migrated || keyPq ? 'Post-quantum' : 'Shor-vulnerable'}</StatusLabel>
              </span>
            </KV>
            <KV label="Signature" mono><Diff was={cert.signature.name} now={migrated ? 'ML-DSA-65' : cert.signature.name} on={migrated} /></KV>
            <KV label="Chain">{cert.trusted ? <StatusLabel status="safe">Trusted</StatusLabel> : <StatusLabel status="risk">{cert.verify_error}</StatusLabel>}</KV>
          </dl>
        </Panel>
      </div>

      <Panel
        className="mt-4"
        title={migrated ? 'Cryptographic bill of materials · after simulated migration' : 'Cryptographic bill of materials · CycloneDX 1.6'}
        action={!migrated && <Button variant="ghost" onClick={downloadCbom} icon={<Download size={13} />}>Download</Button>}
      >
        <DataTable head={<><Th>Algorithm</Th><Th>Primitive</Th><Th>OID</Th><Th>NIST level</Th><Th>Status</Th></>}>
          {rows.map((row) => (
            <tr key={`${migrated}-${row.name}`}>
              <Td mono>
                {row.name}
                {row.sim && <span className="ml-2 font-sans text-[11px] text-zinc-500">simulated</span>}
              </Td>
              <Td>{row.primitive}</Td>
              <Td mono className="text-zinc-500!">{row.oid ?? '—'}</Td>
              <Td mono>{row.nist_level || '—'}</Td>
              <Td><StatusLabel status={algoStatus(row.quantum_safe)}>{row.quantum_safe ? 'Quantum-safe' : 'Shor-vulnerable'}</StatusLabel></Td>
            </tr>
          ))}
        </DataTable>
      </Panel>
    </motion.div>
  )
}
