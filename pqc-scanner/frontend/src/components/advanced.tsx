// Technical detail sections (CBOM, runbook, ledger) shown behind disclosures in the action plan.
import type { ReactNode } from 'react'
import { Download, FlaskConical } from 'lucide-react'
import type { ScanResult } from '../api'
import type { LedgerBlock, Verification } from '../lib/ledger'
import { MIGRATED, type CryptoState } from '../lib/mosca'
import { Button, DataTable, KV, StatusLabel, Td, Terminal, Th, algoStatus } from './ui'

function Section({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="mt-6 first:mt-0">
      <div className="mb-2 flex items-center justify-between">
        <h4 className="text-[11px] font-medium tracking-[0.12em] text-zinc-500 uppercase">{title}</h4>
        {action}
      </div>
      {children}
    </section>
  )
}

const download = (name: string, data: unknown, type = 'application/json') => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

// ── Step 1 ───────────────────────────────────────────────────────────────────

export function DetectDetails({ result, migrated }: { result: ScanResult; migrated: boolean }) {
  const cert = result.certificate
  const kx = result.tls.key_exchange
  const rows = migrated
    ? [
        { name: MIGRATED.kex, primitive: 'kem', oid: '2.16.840.1.101.3.4.4.2', nist_level: 3, quantum_safe: true },
        { name: 'ML-DSA-65', primitive: 'signature', oid: '2.16.840.1.101.3.4.3.18', nist_level: 3, quantum_safe: true },
      ]
    : result.cbom_summary
  return (
    <>
      <Section title="Live handshake">
        <dl>
          <KV label="Negotiated group" mono>{kx.group}</KV>
          <KV label="Protocol" mono>{result.tls.version} · {result.tls.cipher_suite}</KV>
          <KV label="Resolved IP" mono>{result.resolved_ip}</KV>
          <KV label="Certificate key" mono>{cert.public_key.name}</KV>
          <KV label="Signature" mono>{cert.signature.name}</KV>
          <KV label="Issuer">{cert.issuer_cn}{cert.issuer_org ? ` · ${cert.issuer_org}` : ''}</KV>
          <KV label="Expires">{new Date(cert.not_after).toLocaleDateString()} ({cert.days_remaining} days)</KV>
        </dl>
      </Section>
      <Section
        title={migrated ? 'CBOM · after simulated upgrade' : 'Cryptographic bill of materials · CycloneDX 1.6'}
        action={!migrated && <Button variant="ghost" onClick={() => download(`${result.domain}.cbom.cdx.json`, result.cbom, 'application/vnd.cyclonedx+json')} icon={<Download size={13} />}>CBOM</Button>}
      >
        <DataTable head={<><Th>Algorithm</Th><Th>Primitive</Th><Th>OID</Th><Th>Level</Th><Th>Status</Th></>} minWidth={520}>
          {rows.map((r) => (
            <tr key={r.name}>
              <Td mono>{r.name}</Td>
              <Td>{r.primitive}</Td>
              <Td mono className="text-zinc-500!">{r.oid ?? '—'}</Td>
              <Td mono>{r.nist_level || '—'}</Td>
              <Td><StatusLabel status={algoStatus(r.quantum_safe)}>{r.quantum_safe ? 'PQ-safe' : 'Shor-vulnerable'}</StatusLabel></Td>
            </tr>
          ))}
        </DataTable>
      </Section>
    </>
  )
}

// ── Step 3 ───────────────────────────────────────────────────────────────────

export function DefendDetails({ domain, before, done }: { domain: string; before: CryptoState; done: boolean }) {
  const rows: [string, string, string][] = [
    ['Key exchange', before.kex, MIGRATED.kex],
    ['Server key', before.leafKey, MIGRATED.leafKey],
    ['Certificate signature', before.signature, MIGRATED.signature],
  ]
  const cmds = [
    `openssl genpkey -algorithm ML-DSA-65 -out ${domain}.key`,
    `openssl req -new -x509 -key ${domain}.key -subj "/CN=${domain}" -days 90 -out ${domain}.pem`,
    before.kexPq ? `# key exchange already ${before.kex}` : `echo 'ssl_ecdh_curve X25519MLKEM768:X25519;' >> nginx.conf`,
    `openssl s_client -connect ${domain}:443 -groups X25519MLKEM768 -sigalgs mldsa65 -brief`,
  ]
  return (
    <>
      <Section title="Change set">
        <DataTable head={<><Th>Component</Th><Th>Before</Th><Th>After</Th></>} minWidth={460}>
          {rows.map(([role, was, now]) => (
            <tr key={role}>
              <Td>{role}</Td>
              <Td mono><span className={done && was !== now ? 'text-zinc-600 line-through' : ''}>{was}</span></Td>
              <Td mono><span className={done ? 'text-white' : 'text-zinc-500'}>{now}</span></Td>
            </tr>
          ))}
        </DataTable>
        <p className="mt-2 text-[12px] text-zinc-500">Standards: FIPS 204 (ML-DSA-65, NIST category 3) · FIPS 203 (ML-KEM-768 in X25519MLKEM768).</p>
      </Section>
      <Section title="Runbook · simulated, not executed">
        <Terminal title={`migrate ${domain}`}>
          {cmds.map((c) => (
            <div key={c}>
              <span className="text-zinc-600">$ </span>
              {c}
              {done && <span className="ml-2 text-safe">✓</span>}
            </div>
          ))}
        </Terminal>
      </Section>
    </>
  )
}

// ── Step 4 ───────────────────────────────────────────────────────────────────

const pad = (s: string, n = 14) => s.padEnd(n, ' ')
function checkName(name: string) {
  const leaf = name.match(/^Leaf (\d+) · (.+)$/)
  if (leaf) return `leaf[${Number(leaf[1]) - 1}] ${leaf[2].toLowerCase()}`
  return ({ 'Merkle root': 'merkle_root', 'Block hash': 'block_hash', 'Chain link': 'prev_hash link' } as Record<string, string>)[name] ?? name
}

export function ProveDetails({ block, verification, tampered, onTamperToggle }: { block: LedgerBlock; verification: Verification | null; tampered: boolean; onTamperToggle: () => void }) {
  return (
    <Section
      title={`Merkle ledger · block #${block.index}`}
      action={
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onTamperToggle} icon={<FlaskConical size={13} />}>{tampered ? 'Restore' : 'Tamper test'}</Button>
          <Button variant="ghost" onClick={() => download(`${block.domain}.ledger-block-${block.index}.json`, block)} icon={<Download size={13} />}>Proof</Button>
        </div>
      }
    >
      <Terminal title={`ledger · block #${block.index}`}>
        <div><span className="text-zinc-600">$ </span>ledger anchor --domain {block.domain}</div>
        <div>{pad('timestamp')}{block.timestamp}</div>
        <div>{pad('prev_hash')}<span className="text-zinc-500">{block.prev_hash}</span></div>
        {block.leaves.map((l, i) => (
          <div key={l.label}>{pad(`leaf[${i}]`)}<span className="text-zinc-500">{l.label.toLowerCase().padEnd(8, ' ')}</span>{l.hash}</div>
        ))}
        <div>{pad('merkle_root')}<span className="text-white">{block.merkle_root}</span></div>
        <div>{pad('block_hash')}<span className="text-white">{block.block_hash}</span></div>
        {verification && (
          <>
            <div className="mt-3"><span className="text-zinc-600">$ </span>ledger verify #{block.index}{tampered && <span className="text-zinc-500">   # defend record altered: after.signature = RSA-2048</span>}</div>
            {verification.checks.map((c) => (
              <div key={c.name}>
                <span className={c.ok ? 'text-safe' : 'text-risk'}>{c.ok ? '✓' : '✗'}</span> {pad(checkName(c.name), 22)}
                <span className="text-zinc-500">{c.ok ? 'match' : 'MISMATCH'}</span>
              </div>
            ))}
            <div className="mt-1">{pad('verified')}<span className={verification.valid ? 'text-safe' : 'text-risk'}>{String(verification.valid)}</span></div>
          </>
        )}
      </Terminal>
    </Section>
  )
}
