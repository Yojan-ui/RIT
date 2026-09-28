import { motion } from 'framer-motion'
import { ArrowRight, Loader2 } from 'lucide-react'
import { MIGRATED, type CryptoState } from '../../lib/mosca'
import { Button, Callout, DataTable, Panel, StageHeader, StatusLabel, Td, Terminal, Th, algoStatus, reveal } from '../ui'

export type MigrationPhase = 'idle' | 'migrating' | 'done'
export const MIGRATE_MS = 2000

function runbook(domain: string, before: CryptoState) {
  return [
    `openssl genpkey -algorithm ML-DSA-65 -out ${domain}.key`,
    `openssl req -new -x509 -key ${domain}.key -subj "/CN=${domain}" -days 90 -out ${domain}.pem`,
    before.kexPq ? `# key exchange already ${before.kex}` : `echo 'ssl_ecdh_curve X25519MLKEM768:X25519;' >> nginx.conf`,
    `openssl s_client -connect ${domain}:443 -groups X25519MLKEM768 -sigalgs mldsa65 -brief`,
  ]
}

export function DefendStage({ domain, before, phase, scoreBefore, onMigrate, onNext, showNext }: {
  domain: string
  before: CryptoState
  phase: MigrationPhase
  scoreBefore: number
  onMigrate: () => void
  onNext: () => void
  showNext: boolean
}) {
  const steps = runbook(domain, before)
  const rows: [string, string, boolean, string, boolean][] = [
    ['Key exchange', before.kex, before.kexPq, MIGRATED.kex, true],
    ['Server key', before.leafKey, before.leafPq, MIGRATED.leafKey, true],
    ['Certificate signature', before.signature, before.sigPq, MIGRATED.signature, true],
  ]
  const done = phase === 'done'

  return (
    <motion.div {...reveal}>
      <StageHeader
        n={3}
        title="Defend"
        description="Simulate migrating the endpoint to ML-DSA-65 (FIPS 204) signatures and X25519MLKEM768 (FIPS 203) hybrid key exchange. Nothing is changed on the real server."
        action={
          phase === 'idle' ? (
            <Button onClick={onMigrate}>Simulate PQC migration</Button>
          ) : phase === 'migrating' ? (
            <Button disabled icon={<Loader2 size={14} className="animate-spin" />}>Migrating</Button>
          ) : (
            showNext && <Button onClick={onNext} icon={<ArrowRight size={14} />}>Continue to prove</Button>
          )
        }
      />

      <Panel title="Change set">
        <DataTable head={<><Th>Component</Th><Th>Current</Th><Th>Target</Th></>}>
          {rows.map(([role, was, wasPq, now]) => (
            <tr key={role}>
              <Td>{role}</Td>
              <Td mono>
                <span className="inline-flex flex-wrap items-center gap-3">
                  <span className={done && was !== now ? 'text-zinc-600 line-through' : ''}>{was}</span>
                  {!done && <StatusLabel status={algoStatus(wasPq)}>{wasPq ? 'PQ' : 'Classical'}</StatusLabel>}
                </span>
              </Td>
              <Td mono>
                <span className="inline-flex flex-wrap items-center gap-3">
                  <span className={done ? 'text-white' : 'text-zinc-500'}>{now}</span>
                  {done && <StatusLabel status="safe">{was === now ? 'Unchanged' : 'Applied'}</StatusLabel>}
                </span>
              </Td>
            </tr>
          ))}
        </DataTable>
      </Panel>

      {phase !== 'idle' && (
        <div className="mt-4">
          <Terminal title={`migrate ${domain} · simulated, not executed`}>
            {steps.map((cmd, i) => (
              <motion.div
                key={cmd}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: (i * MIGRATE_MS) / steps.length / 1000, duration: 0.15 }}
              >
                <span className="text-zinc-600">$ </span>
                {cmd}
                {done && <span className="ml-2 text-safe">✓</span>}
              </motion.div>
            ))}
          </Terminal>
        </div>
      )}

      {done && (
        <div className="mt-6">
          <Callout status="safe" title="Endpoint protected (simulated)">
            Re-scored against Mosca: safe. PQC score <span className="font-mono text-zinc-200">{scoreBefore} → 100</span>.
          </Callout>
        </div>
      )}
    </motion.div>
  )
}
