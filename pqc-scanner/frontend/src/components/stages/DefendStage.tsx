import { motion } from 'framer-motion'
import { ArrowRight, CheckCircle2, Loader2, ShieldCheck, Wrench } from 'lucide-react'
import { forwardRef, type ReactNode } from 'react'
import { MIGRATED, type CryptoState } from '../../lib/mosca'
import { Card, NextButton, Stage, Verdict, type StageStatus } from '../ui'

export type MigrationPhase = 'idle' | 'migrating' | 'done'
export const MIGRATE_MS = 2600

function steps(domain: string, before: CryptoState) {
  return [
    { label: 'Generate ML-DSA-65 key pair (FIPS 204)', cmd: `openssl genpkey -algorithm ML-DSA-65 -out ${domain}.mldsa65.key` },
    { label: 'Issue ML-DSA-65 certificate', cmd: `openssl req -new -x509 -key ${domain}.mldsa65.key -subj "/CN=${domain}" -days 90` },
    {
      label: before.kexPq ? 'Hybrid key exchange already enabled' : 'Enable hybrid ML-KEM key exchange (FIPS 203)',
      cmd: before.kexPq ? `server already negotiates ${before.kex}` : 'ssl_ecdh_curve X25519MLKEM768:X25519;   # nginx + OpenSSL 3.5',
    },
    { label: 'Re-probe and confirm', cmd: `openssl s_client -connect ${domain}:443 -groups X25519MLKEM768 -sigalgs mldsa65` },
  ]
}

function Stack({ title, state, tone }: { title: string; state: CryptoState; tone: 'before' | 'after' }) {
  const rows: [string, string, boolean][] = [
    ['Key exchange', state.kex, state.kexPq],
    ['Server key', state.leafKey, state.leafPq],
    ['Certificate signature', state.signature, state.sigPq],
  ]
  return (
    <div className={`flex-1 rounded-2xl p-4 ring-1 ${tone === 'after' ? 'bg-emerald-400/[0.06] ring-emerald-400/40' : 'bg-white/[0.03] ring-white/10'}`}>
      <div className={`mb-2 text-[11px] font-semibold tracking-[0.14em] uppercase ${tone === 'after' ? 'text-emerald-300' : 'text-zinc-400'}`}>{title}</div>
      <dl className="space-y-2">
        {rows.map(([role, alg, pq]) => (
          <div key={role} className="flex flex-wrap items-center justify-between gap-2">
            <dt className="text-xs text-zinc-500">{role}</dt>
            <dd className="flex items-center gap-2">
              <span className="font-mono text-[13px] text-zinc-100">{alg}</span>
              <Verdict safe={pq} />
            </dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

export const DefendStage = forwardRef<HTMLElement, {
  status: StageStatus
  domain: string
  before: CryptoState
  phase: MigrationPhase
  scoreBefore: number
  onMigrate: () => void
  children?: ReactNode
}>(function DefendStage({ status, domain, before, phase, scoreBefore, onMigrate, children }, ref) {
  const plan = steps(domain, before)
  return (
    <Stage ref={ref} n={3} title="Defend" subtitle="simulated PQC migration" status={status} accent="#34d399">
      <div className="flex flex-col items-stretch gap-3 md:flex-row md:items-center">
        <Stack title="Before · live scan" state={before} tone="before" />
        <ArrowRight className="mx-auto shrink-0 rotate-90 text-zinc-600 md:rotate-0" size={22} />
        {phase === 'done' ? (
          <motion.div className="flex-1" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }}>
            <Stack title="After · simulated" state={MIGRATED} tone="after" />
          </motion.div>
        ) : (
          <div className="flex flex-1 items-center justify-center rounded-2xl border border-dashed border-white/15 p-4">
            <p className="text-center text-sm text-zinc-500">Target: ML-DSA-65 (FIPS 204) signatures + X25519MLKEM768 key exchange</p>
          </div>
        )}
      </div>

      {phase === 'idle' && (
        <div className="mt-5 flex justify-center">
          <NextButton onClick={onMigrate} tone="emerald" icon={<ShieldCheck size={20} />}>
            Simulate PQC Migration
          </NextButton>
        </div>
      )}

      {phase !== 'idle' && (
        <Card title="Migration runbook · OpenSSL 3.5 (simulated, not executed)" icon={<Wrench size={14} />} className="mt-4">
          <ol className="space-y-2.5">
            {plan.map((s, i) => {
              const delay = (i * MIGRATE_MS) / plan.length / 1000
              return (
                <motion.li key={s.label} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay }} className="flex gap-3">
                  <motion.span initial={{ opacity: 1 }} animate={{ opacity: 1 }} className="mt-0.5 shrink-0">
                    {phase === 'done' ? (
                      <CheckCircle2 size={18} className="text-emerald-300" />
                    ) : (
                      <Loader2 size={18} className="animate-spin text-sky-300" style={{ animationDelay: `${delay}s` }} />
                    )}
                  </motion.span>
                  <div className="min-w-0">
                    <div className="text-sm text-zinc-100">{s.label}</div>
                    <code className="block overflow-x-auto font-mono text-xs whitespace-nowrap text-zinc-500">{s.cmd}</code>
                  </div>
                </motion.li>
              )
            })}
          </ol>
        </Card>
      )}

      {phase === 'done' && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl bg-emerald-400/10 p-4 ring-1 ring-emerald-400/40"
        >
          <ShieldCheck className="text-emerald-300" size={26} />
          <div className="text-sm text-emerald-100">
            <span className="font-bold text-emerald-300">Endpoint protected (simulated).</span> Re-scored: Mosca verdict <b>SAFE</b>, PQC score{' '}
            <span className="font-mono">{scoreBefore} → 100</span>.
          </div>
        </motion.div>
      )}
      {children}
    </Stage>
  )
})
