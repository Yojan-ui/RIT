import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { usePipeline, SCAN_STEPS } from '../pipeline/usePipeline'
import type { CoreState } from '../scene/CryptoCore'
import { RiskGauge, TypeTerminal, type TermLine } from '../components/pipeline'
import { ASSET_TYPES, formulaLine, type AssetType } from '../lib/cwm'
import { BASE_YEAR, Z_YEARS } from '../lib/mosca'
import { HudGlobe } from './HudGlobe'
import { BitPattern, HudRings, MatrixRain, PingSweep, TelemetryCascade, TrackingLayer, type TeleLine } from './overlays'
import type { HudMode } from './anchor'
import './hud.css'

const STEPS = ['DETECT', 'SCORE', 'DEFEND', 'PROVE', 'RESCAN'] as const
const EXAMPLES = ['github.com', 'microsoft.com', 'nta.ac.in']
// Console location shown in the header (the operator's station, not the target's).
const CONSOLE_COORDS = 'LAT 12.9716° N / LON 77.5946° E'

const MODE: Record<CoreState, HudMode> = {
  idle: 'idle',
  scanning: 'scanning',
  vulnerable: 'alert',
  critical: 'critical',
  upgrading: 'upgrading',
  secured: 'secure',
}
const MODE_HEX: Record<HudMode, string> = {
  idle: '#22e6ff',
  scanning: '#22e6ff',
  alert: '#ffb020',
  critical: '#ffb020',
  upgrading: '#22e6ff',
  secure: '#34f5c5',
}

function Frame({ children, tone, className = '', title, right }: { children: ReactNode; tone?: 'alert' | 'secure'; className?: string; title?: string; right?: ReactNode }) {
  return (
    <section className={`hud-frame ${tone ?? ''} ${className}`}>
      {title && (
        <header className="flex items-center justify-between border-b border-[var(--hud-line)] px-4 py-2">
          <span className="hud-label">{title}</span>
          {right}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  )
}

function Clock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])
  return <span>{now.toISOString().slice(11, 19)} UTC</span>
}

function Stat({ k, v, tone, blink }: { k: string; v: ReactNode; tone?: 'cyan' | 'amber' | 'green'; blink?: boolean }) {
  const cls = tone === 'amber' ? 'hud-amber' : tone === 'green' ? 'hud-green' : 'hud-cyan'
  return (
    <div className="flex justify-between gap-4 text-[12px] leading-6">
      <span className="hud-dim">{k}:</span>
      <span className={`${cls} hud-glow ${blink ? 'hud-blink' : ''}`}>{v}</span>
    </div>
  )
}

export default function HudApp() {
  const p = usePipeline()
  const mode = MODE[p.core]
  const hex = MODE_HEX[mode]
  const r = p.result
  const cwm = p.patched ? p.cwmAfter : p.cwmBefore
  const total = r?.cbom_summary.length ?? 0
  const shorVuln = r ? r.cbom_summary.filter((a) => !a.quantum_safe).length : 0
  const shorExposure = p.patched ? 0 : total ? (shorVuln / total) * 100 : 0
  const decay = !cwm ? '—' : cwm.severity === 'CRITICAL' ? 'HIGH' : cwm.severity === 'High' ? 'ELEVATED' : 'LOW'
  const certBytes = useMemo(() => {
    const serial = r?.certificate.serial
    if (!serial) return []
    return (serial.length % 2 ? `0${serial}` : serial).match(/.{2}/g)!.map((b) => `0x${b.toUpperCase()}`)
  }, [r])
  const bytes = certBytes.length ? certBytes : ['0x8F', '0x4C', '0x00', '0x1D', '0x11', '0xEC', '0x03', '0x04']

  // telemetry feed, built from the real scan (and patch) state
  const feed: TeleLine[] = useMemo(() => {
    if (p.scanning) return SCAN_STEPS.map((s) => ({ text: `${s.toUpperCase()} ...`, tone: 'cyan' as const }))
    if (!r || !p.before) {
      return [
        { text: 'SENSOR ARRAY NOMINAL', tone: 'dim' },
        { text: 'PQ CLIENTHELLO READY · X25519MLKEM768', tone: 'cyan' },
        { text: 'AWAITING TARGET DESIGNATION', tone: 'dim' },
        { text: 'LEDGER CHAIN ONLINE · SHA-256', tone: 'cyan' },
      ]
    }
    const lines: TeleLine[] = [
      { text: `TARGET ${r.domain} → ${r.resolved_ip}`, tone: 'cyan' },
      { text: `${r.tls.version} · ${r.tls.cipher_suite}`, tone: 'cyan' },
      { text: `HANDSHAKE ${r.duration_ms} ms${r.cached ? ' (cached)' : ''}`, tone: 'dim' },
      ...r.cbom_summary.map((a): TeleLine => ({
        text: `${a.name.padEnd(24, '.')} ${p.patched ? 'REPLACED' : a.quantum_safe ? 'PQ-SAFE' : 'SHOR-VULN'}`,
        tone: p.patched ? 'green' : a.quantum_safe ? 'green' : 'amber',
      })),
      { text: `CERT SERIAL ${bytes.slice(0, 6).join(' ')}`, tone: 'dim' },
    ]
    if (cwm) lines.push({ text: `CWM ${cwm.score.toFixed(1)} ${cwm.severity.toUpperCase()} · X_ML ${cwm.xml}y`, tone: cwm.severity === 'Low' ? 'green' : 'amber' })
    if (p.patched) lines.push({ text: 'SIG ML-DSA-65 ....... FIPS-204 OK', tone: 'green' }, { text: 'KEX X25519MLKEM768 .. FIPS-203 OK', tone: 'green' })
    if (p.block) lines.push({ text: `LEDGER BLOCK #${p.block.index} ${p.block.block_hash.slice(0, 16)}…`, tone: p.verification?.valid ? 'green' : 'amber' })
    if (r.skipped_addresses?.length) lines.push({ text: `SKIPPED ${r.skipped_addresses.map((s) => s.ip).join(', ')}`, tone: 'amber' })
    return lines
  }, [p.scanning, r, p.before, p.patched, cwm, p.block, p.verification, bytes])

  // Tracking lines need the gap between the panels and the globe, so wide screens only.
  const [wide, setWide] = useState(() => innerWidth >= 1024)
  useEffect(() => {
    const onResize = () => setWide(innerWidth >= 1024)
    addEventListener('resize', onResize)
    return () => removeEventListener('resize', onResize)
  }, [])
  const locksActive = wide && !!r && !p.patched && p.step <= 2 && !p.scanning
  const blips = r ? (r.addresses ?? [r.resolved_ip]).map((ip) => ({ label: ip, ok: !r.skipped_addresses?.some((s) => s.ip === ip) })) : []
  const matrixWords = useMemo(
    () => ['0x8F', '0x4C', 'RSA', 'ECDSA', 'ECDHE', 'ML-KEM', 'ML-DSA', 'SHA256', 'X25519', 'FIPS203', 'FIPS204', ...bytes.slice(0, 12), ...(r ? r.cbom_summary.map((a) => a.name) : [])],
    [bytes, r],
  )

  return (
    <div className="hud-root">
      <div className="hud-grid" aria-hidden />
      <MatrixRain words={matrixWords} color={hex} />
      <div className="fixed inset-0 z-[2]" aria-hidden>
        <HudGlobe mode={mode} />
      </div>
      <HudRings
        mode={mode}
        target={r ? `${r.domain} · ${r.resolved_ip}` : null}
        subline={r ? (p.patched ? 'ML-DSA-65 + X25519MLKEM768 · SECURED' : `${p.before?.leafKey} + ${p.before?.kex}`) : null}
      />
      <TrackingLayer active={locksActive} />

      {/* ── top bar ── */}
      <header className="fixed inset-x-0 top-0 z-30 flex flex-wrap items-center justify-between gap-3 border-b border-[var(--hud-line)] bg-[rgb(2_6_15/0.75)] px-5 py-3 backdrop-blur-md">
        <button onClick={p.reset} className="flex items-center gap-3 text-left" aria-label="Reset scan">
          <span className="grid size-8 place-items-center border border-[var(--hud-cyan)] hud-cyan">
            <svg viewBox="0 0 20 20" className="size-4" aria-hidden>
              <circle cx="10" cy="10" r="7" fill="none" stroke="currentColor" strokeWidth="1.4" />
              <circle cx="10" cy="10" r="2" fill="currentColor" />
            </svg>
          </span>
          <span>
            <span className="hud-title block">STARK-HUD // PQC DIAGNOSTICS</span>
            <span className="hud-label">quantum-readiness scanner · jarvis mode</span>
          </span>
        </button>
        <div className="flex flex-wrap items-center gap-4 text-[11px] tracking-[0.16em]">
          <span className="hud-dim hidden md:inline">CONSOLE {CONSOLE_COORDS}</span>
          <span className="hud-cyan hud-glow"><Clock /></span>
          <span className={`border px-2 py-1 ${mode === 'critical' || mode === 'alert' ? 'border-[var(--hud-amber)] hud-amber hud-blink' : mode === 'secure' ? 'border-[var(--hud-green)] hud-green' : 'border-[var(--hud-line)] hud-cyan'}`}>
            {mode === 'critical' ? 'THREAT: CRITICAL' : mode === 'alert' ? 'THREAT: ELEVATED' : mode === 'secure' ? 'STATUS: SECURED' : mode === 'scanning' || mode === 'upgrading' ? 'STATUS: ACTIVE' : 'STATUS: STANDBY'}
          </span>
          <button className="hud-btn ghost" disabled={!r} onClick={p.exportPdf}>PDF</button>
          <button className="hud-btn ghost" disabled={!r} onClick={p.exportJson}>CBOM.JSON</button>
        </div>
      </header>

      <main className="hud-scroll relative z-20 h-full overflow-y-auto">
        <div className="grid min-h-full grid-cols-1 gap-5 px-5 pt-24 pb-10 lg:grid-cols-[minmax(0,560px)_1fr_280px]">
          {/* ── left: stepper + stage ── */}
          <div className="space-y-4 max-lg:pt-[38vh]">
            <nav aria-label="Pipeline" className="flex gap-1">
              {STEPS.map((s, i) => {
                const n = i + 1
                const on = n === p.step
                const open = n <= p.reached
                return (
                  <button
                    key={s}
                    disabled={!open}
                    onClick={() => p.setStep(n)}
                    aria-current={on ? 'step' : undefined}
                    className={`flex-1 border px-2 py-2 text-left text-[10px] tracking-[0.2em] transition-colors ${
                      on ? 'border-[var(--hud-cyan)] bg-[rgb(34_230_255/0.14)] hud-cyan hud-glow' : open ? 'border-[var(--hud-line)] hud-cyan' : 'border-[rgb(34_230_255/0.12)] text-[rgb(160_220_255/0.3)]'
                    }`}
                  >
                    <span className="block opacity-70">0{n}</span>
                    {s}
                  </button>
                )
              })}
            </nav>

            {/* diagnostic status block */}
            {(p.scanning || r) && (
              <Frame title="diagnostic status" tone={mode === 'critical' || mode === 'alert' ? 'alert' : mode === 'secure' ? 'secure' : undefined}>
                <Stat k="SCAN_SPECTRAL_ANALYSIS" v={p.scanning ? 'RUNNING...' : 'COMPLETE'} blink={p.scanning} />
                <Stat k="DECAY_RATE" v={p.scanning ? 'CALCULATING' : decay} tone={decay === 'HIGH' || decay === 'ELEVATED' ? 'amber' : decay === 'LOW' ? 'green' : 'cyan'} blink={p.scanning || decay === 'HIGH'} />
                <Stat k="SHOR_EXPOSURE" v={p.scanning ? 'CALCULATING' : `${shorExposure.toFixed(1)}% (${p.patched ? 0 : shorVuln}/${total} ALGORITHMS)`} tone={shorExposure > 0 ? 'amber' : 'green'} blink={p.scanning} />
                {cwm && !p.scanning && <Stat k="CWM_RISK" v={`${cwm.score.toFixed(1)} / 100 · ${cwm.severity.toUpperCase()}`} tone={cwm.severity === 'Low' ? 'green' : 'amber'} />}
              </Frame>
            )}

            {/* keyed fade-in (no exit phase: rapid idle → scanning → result changes must never stall) */}
            <motion.div key={`${p.step}-${!!r}-${p.scanning}`} initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.22 }}>
                {p.step === 1 && <DetectStage p={p} />}
                {p.step === 2 && <ScoreStage p={p} />}
                {p.step === 3 && <DefendStage p={p} />}
                {p.step === 4 && <ProveStage p={p} />}
                {p.step === 5 && <RescanStage p={p} />}
            </motion.div>
          </div>

          <div aria-hidden />

          {/* ── right: telemetry cascade ── */}
          <aside className="space-y-4">
            <Frame title="telemetry cascade" right={<span className="hud-label hud-blink hud-cyan">● LIVE</span>}>
              <TelemetryCascade source={feed} />
            </Frame>
            <Frame title="network ping sweep">
              <div className="flex items-center gap-4">
                <PingSweep blips={blips} color={hex} />
                <div className="space-y-1 text-[11px]">
                  <div className="hud-dim">ADDRESSES</div>
                  {blips.length ? blips.map((b) => <div key={b.label} className={b.ok ? 'hud-green' : 'hud-amber'}>{b.ok ? '●' : '○'} {b.label}</div>) : <div className="hud-dim">—</div>}
                  <div className="hud-dim pt-1">SCAN SPEED</div>
                  <div className="hud-cyan hud-glow">{r ? `${r.duration_ms} ms` : '—'}</div>
                </div>
              </div>
            </Frame>
            <Frame title={r ? 'cert serial · bit pattern' : 'bit pattern'}>
              <BitPattern bytes={bytes} color={hex} />
            </Frame>
          </aside>
        </div>
      </main>

      <div className="hud-crt" aria-hidden />
    </div>
  )
}

type P = ReturnType<typeof usePipeline>

function StageHead({ n, title, sub }: { n: number; title: string; sub?: string }) {
  return (
    <div className="mb-4">
      <div className="hud-label">stage 0{n}</div>
      <h2 className="hud-title mt-1 text-[16px]">{title}</h2>
      {sub && <p className="mt-2 text-[12px] leading-relaxed text-[rgb(200_236_255/0.8)]">{sub}</p>}
    </div>
  )
}

function Target({ label, name, safe, note, lock }: { label: string; name: string; safe: boolean; note: string; lock?: boolean }) {
  return (
    <div className={`hud-target ${safe ? 'safe' : 'vuln'}`} {...(lock ? { 'data-lock': `${label}-${name}`, 'data-lock-label': name } : {})}>
      <div className="min-w-0">
        <div className="hud-label">{label}</div>
        <div className={`mt-0.5 text-[16px] font-bold ${safe ? 'hud-green' : 'hud-amber'} hud-glow`}>[ {name} ]</div>
        <div className="hud-dim mt-0.5 text-[11px]">{note}</div>
      </div>
      <div className={`shrink-0 text-[11px] tracking-[0.18em] ${safe ? 'hud-green' : 'hud-amber hud-blink'}`}>{safe ? 'PQ-SAFE' : 'SHOR-VULN'}</div>
    </div>
  )
}

function DetectStage({ p }: { p: P }) {
  if (!p.result && !p.scanning) {
    return (
      <Frame title="target designation">
        <StageHead n={1} title="designate a target" sub="Live TLS handshake. The sensor offers X25519MLKEM768 and records what the server negotiates and signs with." />
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            p.scan(p.query)
          }}
        >
          <input className="hud-input" value={p.query} onChange={(e) => p.setQuery(e.target.value)} placeholder="domain, e.g. github.com" aria-label="Domain to scan" autoFocus spellCheck={false} autoCapitalize="none" />
          <button className="hud-btn" type="submit" disabled={!p.query.trim()}>scan</button>
        </form>
        <div className="mt-3 flex flex-wrap gap-3 text-[11px]">
          <span className="hud-dim">QUICK LOCK:</span>
          {EXAMPLES.map((d) => (
            <button key={d} className="hud-cyan underline decoration-[var(--hud-line)] underline-offset-4 hover:text-white" onClick={() => { p.setQuery(d); p.scan(d) }}>
              {d}
            </button>
          ))}
        </div>
        {p.error && <p className="hud-amber mt-4 text-[12px]" role="alert">⚠ {p.error}</p>}
      </Frame>
    )
  }
  if (p.scanning) {
    return (
      <Frame title="acquiring">
        <StageHead n={1} title={`scanning ${p.query.trim()}`} />
        <ol className="space-y-1.5 text-[12px]">
          {SCAN_STEPS.map((s, i) => (
            <li key={s} className={i < p.scanStep ? 'hud-green' : i === p.scanStep ? 'hud-cyan hud-blink' : 'hud-dim opacity-50'}>
              {i < p.scanStep ? '[✓]' : i === p.scanStep ? '[»]' : '[ ]'} {s.toUpperCase()}
            </li>
          ))}
        </ol>
      </Frame>
    )
  }
  return (
    <Frame title="detected cryptography" tone={p.vulnerable ? 'alert' : 'secure'}>
      <StageHead n={1} title={p.vulnerable ? `${p.vulnerable} legacy lock${p.vulnerable > 1 ? 's' : ''} acquired` : 'no legacy locks'} sub={p.diag?.meaning} />
      {p.demo && <p className="hud-amber mb-3 text-[11px]">⚠ SCANNER API OFFLINE · DEMO DATA</p>}
      <div className="space-y-2">
        {p.detected.map((a) => (
          <Target key={a.role} label={a.role} name={a.name} safe={a.safe} note={a.note} lock={!a.safe} />
        ))}
      </div>
      {p.otherFailing.length > 0 && <p className="hud-dim mt-3 text-[11px]">ALSO IN CHAIN: {p.otherFailing.map((a) => a.name).join(' · ')}</p>}
      <div className="mt-5">
        <button className="hud-btn" onClick={() => p.goto(2)}>analyse threat »</button>
      </div>
    </Frame>
  )
}

function ScoreStage({ p }: { p: P }) {
  const c = p.cwmBefore
  const m = p.m
  if (!c || !m) return null
  const crit = c.severity === 'CRITICAL'
  return (
    <Frame title="threat analysis · context-weighted mosca" tone={crit || c.severity === 'High' ? 'alert' : 'secure'}>
      <StageHead
        n={2}
        title={crit ? 'critical: forgeable by crqc' : c.severity === 'High' ? 'high risk' : 'low risk'}
        sub={m.holds ? `Protection needed until ${Math.ceil(BASE_YEAR + m.sum)}; a quantum computer could break ${c.signature} from ${BASE_YEAR + m.z}.` : `Protection needed until ${Math.ceil(BASE_YEAR + m.sum)}, before a ${BASE_YEAR + m.z} quantum computer.`}
      />
      <div className="grid items-center gap-4 sm:grid-cols-[1fr_1fr]">
        <RiskGauge score={c.score} severity={c.severity} />
        <div className="space-y-3 text-[12px]">
          <label className="block">
            <div className="flex justify-between"><span className="hud-dim">X_ML · PREDICTED MIGRATION</span><span className="hud-cyan">{c.xml} Y</span></div>
            <select className="hud-select mt-1" value={p.assetType} onChange={(e) => p.setAssetType(e.target.value as AssetType)} aria-label="Asset type">
              {ASSET_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          </label>
          <label className="block">
            <div className="flex justify-between"><span className="hud-dim">Y · DATA SHELF LIFE</span><span className="hud-cyan">{p.y} Y</span></div>
            <input type="range" min={0} max={30} value={p.y} onChange={(e) => p.setY(Number(e.target.value))} />
          </label>
          <div className="flex justify-between"><span className="hud-dim">Z · YEARS TO CRQC</span><span className="hud-cyan">{Z_YEARS} Y (FIXED)</span></div>
        </div>
      </div>
      <div className="mt-4 border border-[var(--hud-line)] bg-[rgb(0_6_16/0.8)] p-3 text-[11.5px] leading-relaxed">
        <div className="hud-label">validate math</div>
        <div className="mt-1 text-white">RISK = ((X_ML + Y) / Z) × EXP × FRAGILITY × 100</div>
        <div className={crit ? 'hud-amber' : 'hud-green'}>{formulaLine(c)} · {c.severity.toUpperCase()}</div>
      </div>
      <div className="mt-4 space-y-2">
        {p.detected.filter((a) => !a.safe).map((a) => (
          <Target key={a.role} label={`locked · ${a.role}`} name={a.name} safe={false} note="tracked for remediation" lock />
        ))}
      </div>
      <div className="mt-5">
        <button className="hud-btn amber" onClick={() => p.goto(3)}>engage countermeasures »</button>
      </div>
    </Frame>
  )
}

function DefendStage({ p }: { p: P }) {
  const list = p.patched ? p.upgraded : p.detected
  return (
    <Frame title="countermeasures" tone={p.patched ? 'secure' : 'alert'}>
      <StageHead
        n={3}
        title={p.patched ? 'patched: ml-dsa-65 + x25519mlkem768' : 'deploy quantum-safe patch'}
        sub={p.patched ? 'Signatures: ML-DSA-65 (NIST FIPS 204). Key exchange: X25519MLKEM768 (NIST FIPS 203).' : 'Replace the legacy signature and key exchange with NIST post-quantum standards.'}
      />
      <div className="space-y-2">
        {list.map((a) => <Target key={`${a.role}-${a.name}`} label={a.role} name={a.name} safe={a.safe} note={a.note} />)}
      </div>
      <div className="mt-5 flex flex-wrap items-center gap-3">
        {p.patched ? (
          <button className="hud-btn" onClick={() => p.goto(4)}>seal the record »</button>
        ) : (
          <>
            <button className="hud-btn" onClick={p.applyPatch} disabled={p.patching}>{p.patching ? 'deploying…' : 'deploy ML-DSA/ML-KEM patch'}</button>
            <span className="hud-dim text-[11px]">SIMULATION · LIVE SERVER UNCHANGED</span>
          </>
        )}
      </div>
    </Frame>
  )
}

function ProveStage({ p }: { p: P }) {
  const b = p.block
  return (
    <Frame title="merkle ledger" tone={p.typed && p.verification?.valid ? 'secure' : undefined}>
      <StageHead n={4} title={p.typed && p.verification?.valid ? 'proof anchored' : 'anchor proof'} sub="Each stage is fingerprinted with SHA-256, combined into a Merkle root and chained to the previous block." />
      {!b ? (
        <button className="hud-btn" onClick={p.anchorProof} disabled={p.anchoring}>{p.anchoring ? 'hashing…' : 'anchor to merkle ledger'}</button>
      ) : (
        <>
          <div className="hud-term">
            <TypeTerminal
              title={`ledger · block #${b.index}`}
              onDone={() => p.setTyped(true)}
              lines={[
                { text: `$ ledger anchor --domain ${b.domain}`, tone: 'dim' },
                ...b.leaves.map((l, i): TermLine => ({ text: `sha256 leaf[${i}] ${l.label.toLowerCase().padEnd(7)} ${l.hash}` })),
                { text: `merkle_root          ${b.merkle_root}`, tone: 'strong' },
                { text: `prev_hash            ${b.prev_hash}`, tone: 'dim' },
                { text: `block_hash           ${b.block_hash}`, tone: 'strong' },
                { text: `$ ledger verify #${b.index}`, tone: 'dim' },
                { text: p.verification?.valid ? '✓ leaves, root, block hash and chain link match' : '✗ verification failed', tone: p.verification?.valid ? 'ok' : 'bad' },
              ]}
            />
          </div>
          {p.typed && (
            <div className="mt-4">
              <button className="hud-btn" onClick={() => p.goto(5)}>run verification sweep »</button>
            </div>
          )}
        </>
      )}
    </Frame>
  )
}

function RescanStage({ p }: { p: P }) {
  const r = p.result
  const before = p.before
  if (!r || !before) return null
  const done = p.complete
  return (
    <div className="space-y-4">
      <Frame title="verification sweep" tone={done ? 'secure' : undefined}>
        <StageHead n={5} title={done ? '100% pqc-ready' : 'verification sweep'} sub={done ? 'Every algorithm on the patched endpoint is post-quantum.' : 'Re-run the checks against the patched configuration.'} />
        {p.rescan === 'idle' ? (
          <button className="hud-btn" onClick={p.runRescan}>run verification sweep</button>
        ) : (
          <ol className="space-y-1.5 text-[12px]">
            {['KEY EXCHANGE: X25519MLKEM768 (FIPS 203)', 'CERTIFICATE: ML-DSA-65 KEY + SIGNATURE (FIPS 204)', 'CBOM: 0 SHOR-VULNERABLE ALGORITHMS'].map((s, i) => (
              <li key={s} className={p.rescanStep > i ? 'hud-green' : p.rescanStep === i ? 'hud-cyan hud-blink' : 'hud-dim opacity-50'}>
                {p.rescanStep > i ? '[✓]' : p.rescanStep === i ? '[»]' : '[ ]'} {s}
              </li>
            ))}
          </ol>
        )}
        {done && <p className="hud-dim mt-3 text-[11px]">VERIFIED AGAINST THE SIMULATED PATCHED ENDPOINT · LIVE {r.domain} STILL REPORTS {before.leafKey}</p>}
      </Frame>
      {done && p.cwmBefore && p.cwmAfter && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Frame title="before · classical" tone="alert">
            <div className="hud-amber hud-glow text-[14px] font-bold">[ {before.leafKey} + {before.kex} ]</div>
            <p className="mt-2 text-[11.5px] leading-relaxed text-[rgb(200_236_255/0.8)]">Shor-vulnerable. A CRQC could forge signatures to impersonate the server{before.kexPq ? '.' : ' and decrypt traffic recorded today.'}</p>
            <div className="mt-3 space-y-0.5">
              <Stat k="CWM" v={`${p.cwmBefore.score} ${p.cwmBefore.severity.toUpperCase()}`} tone="amber" />
              <Stat k="PQC SCORE" v={`${r.assessment.score}/100`} tone="amber" />
              <Stat k="SHOR-VULN" v={r.cbom_summary.filter((a) => !a.quantum_safe).length} tone="amber" />
            </div>
          </Frame>
          <Frame title="after · post-quantum" tone="secure">
            <div className="hud-green hud-glow text-[14px] font-bold">[ ML-DSA-65 + X25519MLKEM768 ]</div>
            <p className="mt-2 text-[11.5px] leading-relaxed text-[rgb(200_236_255/0.8)]">Lattice-based (Module-LWE), no known efficient quantum attack; NIST FIPS 204 and FIPS 203.</p>
            <div className="mt-3 space-y-0.5">
              <Stat k="CWM" v={`${p.cwmAfter.score} ${p.cwmAfter.severity.toUpperCase()}`} tone="green" />
              <Stat k="PQC SCORE" v="100/100" tone="green" />
              <Stat k="SHOR-VULN" v={0} tone="green" />
            </div>
          </Frame>
        </div>
      )}
      {done && (
        <div className="flex flex-wrap gap-2">
          <button className="hud-btn" onClick={p.exportPdf}>download report</button>
          <button className="hud-btn ghost" onClick={p.reset}>new target</button>
        </div>
      )}
    </div>
  )
}
