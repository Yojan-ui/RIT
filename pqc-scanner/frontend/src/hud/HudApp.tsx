import { Fragment, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type MutableRefObject, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { Blocks, Cpu, Crosshair, FileDown, Gauge, Globe, Radar, RotateCcw, ScanLine, ShieldCheck, type LucideIcon } from 'lucide-react'
import { usePipeline, SCAN_STEPS, type Pipeline } from '../pipeline/usePipeline'
import type { CoreState } from '../scene/CryptoCore'
import { ASSET_TYPES, formulaLine, type AssetType } from '../lib/cwm'
import { BASE_YEAR, Z_YEARS } from '../lib/mosca'
import { HudGlobe } from './HudGlobe'
import { fetchBench, type Bench, type TelemetryEvent } from '../api'
import { exportComplianceReport } from '../lib/compliance'
import { computePerf } from '../lib/perf'
import { Bar, CwmGauge, HudRings, NodeMarkers, TrackingLayer } from './overlays'
import { PerfImpact, TelemetryTerminal, type StreamState, type TLine } from './Proof'
import { hudAnchor, type HoloNode, type HudMode, type Story } from './anchor'
import { StoryOverlay, type StoryData } from './StoryOverlay'
import { ArHandoff } from './ArHandoff'
import { Card } from './bento'
import { geiger, sfx } from './sfx'
import { useXR } from './xr'
import './hud.css'

const STEPS: [string, LucideIcon][] = [
  ['Detect', Radar],
  ['Score', Gauge],
  ['Defend', ShieldCheck],
  ['Prove', Blocks],
  ['Rescan', ScanLine],
]
const EXAMPLES = ['github.com', 'microsoft.com', 'nta.ac.in']
// Operator console location (Bengaluru), not the target's.
const CONSOLE = '12.9716°N 77.5946°E'

const MODE: Record<CoreState, HudMode> = { idle: 'idle', scanning: 'scanning', vulnerable: 'alert', critical: 'critical', upgrading: 'upgrading', secured: 'secure' }
const STATUS: Record<HudMode, [string, string]> = {
  idle: ['STANDBY', 'hud-dim'],
  scanning: ['ACQUIRING', 'hud-ice'],
  alert: ['THREAT ELEVATED', 'hud-warn'],
  critical: ['THREAT CRITICAL', 'hud-crit'],
  upgrading: ['DEPLOYING', 'hud-ice'],
  secure: ['SECURED', 'hud-ok'],
}

const stamp = () => new Date().toISOString().slice(11, 23)

type Tone = 'ice' | 'warn' | 'crit' | 'ok' | 'dim'

/** Records one UI log line per real pipeline state change (backend lines arrive over the stream). */
function useEventLog(p: Pipeline, add: (l: Omit<TLine, 'id'>) => void) {
  const push = (tag: string, text: string, tone?: Tone) =>
    add({ t: stamp(), src: 'ui', tag: tag.toLowerCase(), text, level: tone === 'crit' ? 'ERROR' : 'INFO', tone: tone === 'ice' ? undefined : tone })
  const r = p.result

  useEffect(() => {
    if (p.scanning) push('SCAN', `start · target ${p.query.trim()}`, 'dim')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.scanning])
  useEffect(() => {
    if (p.scanning && p.scanStep > 0) push('SCAN', SCAN_STEPS[p.scanStep - 1].toLowerCase(), 'dim')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.scanStep])
  useEffect(() => {
    if (!r) return
    const vuln = r.cbom_summary.filter((a) => !a.quantum_safe).length
    push('SCAN', `result parsed · ${r.tls.key_exchange.group ?? 'unknown'} · ${r.certificate.public_key.name} · ${vuln}/${r.cbom_summary.length} shor-vulnerable${r.cached ? ' · cached' : ''}`, vuln ? 'warn' : 'ok')
    if (p.demo) push('SCAN', 'api unreachable · demo dataset', 'warn')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [r])
  useEffect(() => {
    if (p.error) push('ERR', p.error, 'crit')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.error])
  // CWM: log when first computed on the Score stage and whenever its inputs change
  const cwmKey = p.cwmBefore && p.reached >= 2 ? `${p.cwmBefore.score}|${p.cwmBefore.xml}|${p.y}` : ''
  useEffect(() => {
    if (!cwmKey || !p.cwmBefore) return
    const c = p.cwmBefore
    const t = setTimeout(
      () => push('CWM', `${c.score.toFixed(1)} ${c.severity} · x_ml ${c.xml} y ${c.y} z ${c.z} exp ${c.exposure} frag ${c.fragility}`, c.severity === 'CRITICAL' ? 'crit' : c.severity === 'High' ? 'warn' : 'ok'),
      300,
    )
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cwmKey])
  useEffect(() => {
    if (p.patching) push('PATCH', 'deploy ML-DSA-65 + X25519MLKEM768 (simulated)', 'dim')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.patching])
  useEffect(() => {
    if (!p.patched) return
    push('PATCH', 'sig ML-DSA-65 · FIPS 204', 'ok')
    push('PATCH', 'kex X25519MLKEM768 · FIPS 203', 'ok')
    if (p.cwmAfter) push('CWM', `${p.cwmAfter.score.toFixed(1)} ${p.cwmAfter.severity} · frag ${p.cwmAfter.fragility}`, 'ok')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.patched])
  useEffect(() => {
    const b = p.block
    if (!b) return
    b.leaves.forEach((l, i) => push('MERK', `leaf[${i}] ${l.label.toLowerCase()} ${l.hash.slice(0, 16)}…`))
    push('MERK', `root ${b.merkle_root.slice(0, 24)}…`)
    push('BLOCK', `#${b.index} ${b.block_hash.slice(0, 24)}… prev ${b.prev_hash.slice(0, 8)}…`)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.block])
  useEffect(() => {
    if (p.verification) push('VERIFY', p.verification.valid ? `${p.verification.checks.length}/${p.verification.checks.length} checks match` : 'mismatch', p.verification.valid ? 'ok' : 'crit')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.verification])
  useEffect(() => {
    const labels = ['kex X25519MLKEM768 ok', 'cert ML-DSA-65 ok', 'cbom 0 shor-vulnerable']
    if (p.rescan === 'running' && p.rescanStep > 0) push('RESCAN', labels[p.rescanStep - 1], 'ok')
    if (p.rescan === 'done') push('RESCAN', 'endpoint 100% pqc-ready (simulated config)', 'ok')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.rescanStep, p.rescan])
}

// A kex / cert / CBOM warning naming a Shor-breakable primitive: one more "particle" for the Geiger counter.
const SHOR_HIT = /shor|\brsa\b|ecdsa|ecdhe|secp\d|p-?256|p-?384|x25519(?!mlkem)/i

/**
 * Sound follows the same state as the 3D story: Geiger clicks through DETECT (faster with every
 * Shor-vulnerable primitive parsed), a bass sweep while the lattice deploys and a chime when it locks.
 * The PROVE vault lock is fired by the 3D scene at the frame the block snaps into the chain.
 */
function useSonification(story: Story, p: Pipeline, heat: MutableRefObject<number>, shorVuln: number) {
  const prev = useRef(story)
  useEffect(() => {
    const was = prev.current
    prev.current = story
    if (story.patching && !was.patching) sfx.latticeSweep(1.8)
    if (story.patched && !was.patched) sfx.latticeChime()
  }, [story])

  useEffect(() => {
    if (p.scanning) heat.current = 0
  }, [p.scanning, heat])
  const live = useRef({ scanning: false, detect: 0 })
  live.current = { scanning: p.scanning, detect: !!p.result && p.step === 1 && !p.patched ? shorVuln : 0 }
  useEffect(() => {
    const g = geiger()
    let rate = 0
    // ramp toward the target so the counter audibly accelerates rather than jumping
    const id = setInterval(() => {
      const s = live.current
      const target = s.scanning ? 1.2 + heat.current * 2.4 : s.detect ? 0.7 + s.detect * 1.3 : 0
      rate = target ? rate + (target - rate) * 0.3 : 0
      g.set(Math.min(rate, 14))
    }, 200)
    return () => {
      clearInterval(id)
      g.stop()
    }
  }, [heat])
}

// ── small pieces ─────────────────────────────────────────────────────────────

/** Label / value row. `mono` is for hashes and IP addresses only. */
function Row({ k, children, cls = 'hud-white', mono = false, title }: { k: string; children: ReactNode; cls?: string; mono?: boolean; title?: string }) {
  return (
    <div className="hud-row">
      <span className="hud-k">{k}</span>
      <span className={`truncate text-right ${mono ? 'hud-mono text-[11px]' : ''} ${cls}`} title={title}>
        {children}
      </span>
    </div>
  )
}

function Clock() {
  const [t, setT] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setT(new Date()), 1000)
    return () => clearInterval(id)
  }, [])
  return <>{t.toISOString().slice(11, 19)}Z</>
}

function NodeRow({ idx, role, name, state, note, lock }: { idx: number; role: string; name: string; state: 'warn' | 'crit' | 'ok'; note: string; lock?: string }) {
  const col = state === 'ok' ? 'hud-ok' : state === 'crit' ? 'hud-crit hud-sharp' : 'hud-warn'
  return (
    <div className={`hud-node ${state === 'ok' ? 'ok' : 'warn'}`} {...(lock ? { 'data-lock': lock } : {})}>
      <span className="flex items-center gap-2">
        <span className="dot" />
        <span className="hud-dim">N{String(idx).padStart(2, '0')}</span>
      </span>
      <span className="min-w-0">
        <span className="hud-k block">{role}</span>
        <span className="hud-white block truncate text-[13px] font-medium">{name}</span>
      </span>
      <span className="text-right">
        <span className={`block text-[10px] font-semibold tracking-[0.06em] ${col}`}>{state === 'ok' ? 'PQ-SAFE' : 'SHOR-VULN'}</span>
        <span className="hud-dim block text-[10.5px]">{note}</span>
      </span>
    </div>
  )
}

// ── App ──────────────────────────────────────────────────────────────────────

export default function HudApp() {
  // Live telemetry: backend log records streamed over SSE, plus UI pipeline events.
  const [lines, setLines] = useState<TLine[]>([])
  const [stream, setStream] = useState<{ state: StreamState; meta: string }>({ state: 'idle', meta: '' })
  const seq = useRef(0)
  const received = useRef(0)
  const add = useCallback((l: Omit<TLine, 'id'>) => setLines((ls) => [...ls.slice(-220), { ...l, id: seq.current++ }]), [])
  const heat = useRef(0) // Shor-vulnerable primitives seen in this scan's telemetry
  const onTelemetry = useCallback(
    (e: TelemetryEvent) => {
      const sse = e.logger === 'client.sse'
      if (!sse) {
        sfx.click(0.5) // every parsed record ticks the counter once
        if (e.level === 'WARNING' && SHOR_HIT.test(e.msg)) heat.current++
      }
      const state = e.data?.state as StreamState | undefined
      if (sse && state) {
        if (state === 'connecting') received.current = 0
        const meta = state === 'closed' ? `${e.data?.count} ev · ${((e.data?.bytes as number) / 1024).toFixed(1)} KB` : state === 'open' ? 'HTTP 200' : state === 'error' ? 'failed' : '…'
        setStream({ state, meta })
      } else if (!sse) {
        received.current++
        setStream((s) => (s.state === 'open' ? { ...s, meta: `${received.current} ev` } : s))
      }
      add({
        t: new Date(e.t * 1000).toISOString().slice(11, 23),
        src: sse ? 'sse' : 'api',
        tag: e.stage,
        text: e.msg,
        level: (['INFO', 'WARNING', 'ERROR'].includes(e.level) ? e.level : 'INFO') as TLine['level'],
        tone: e.msg.includes('post-quantum hybrid ✓') || e.msg.startsWith('complete') ? 'ok' : e.stage === 'http' ? 'dim' : undefined,
      })
    },
    [add],
  )
  const p = usePipeline({ onTelemetry })
  useEventLog(p, add)

  // Handshake crypto benchmark, measured once on the backend host.
  const [bench, setBench] = useState<Bench | null>(null)
  const [benchErr, setBenchErr] = useState(false)
  const [legacySig, setLegacySig] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    const load = (tries: number) =>
      fetchBench()
        .then((b) => alive && setBench(b))
        .catch(() => (tries > 0 ? setTimeout(() => load(tries - 1), 2500) : alive && setBenchErr(true)))
    load(3)
    return () => {
      alive = false
    }
  }, [])
  const xr = useXR()
  const sfxOn = useSyncExternalStore(sfx.subscribe, () => sfx.enabled)
  const mode = xr.presenting ? 'secure' : MODE[p.core]
  const r = p.result
  const total = r?.cbom_summary.length ?? 0
  const shorVuln = p.patched ? 0 : r ? r.cbom_summary.filter((a) => !a.quantum_safe).length : 0

  // One hologram node per signature / key-exchange algorithm, coloured only by its own state.
  const nodes: HoloNode[] = useMemo(() => {
    if (!r || !p.before) return []
    const list = p.patched || xr.presenting ? p.upgraded : p.detected
    return list.map((a) => ({
      id: `${a.role === 'Signature' ? 'sig' : 'kex'}:${a.name}`,
      label: a.name,
      state: a.safe ? 'ok' : p.cwmBefore?.severity === 'CRITICAL' ? 'crit' : 'warn',
    }))
  }, [r, p.before, p.patched, p.detected, p.upgraded, p.cwmBefore, xr.presenting])

  const [wide, setWide] = useState(() => innerWidth >= 1024)
  useEffect(() => {
    const f = () => setWide(innerWidth >= 1024)
    addEventListener('resize', f)
    return () => removeEventListener('resize', f)
  }, [])
  const tracking = wide && !!r && !p.patched && p.step === 1 && !p.scanning
  const addrs = r ? r.addresses ?? [r.resolved_ip] : []
  const [statusText, statusCls] = STATUS[mode]
  const exportCompliance = () => {
    if (!r) return
    const perf = bench ? computePerf(r, bench, legacySig ?? undefined) : null
    exportComplianceReport({ r, demo: p.demo, patched: p.patched, complete: p.complete, cwmBefore: p.cwmBefore, cwmAfter: p.cwmAfter, mosca: p.m, block: p.block, verification: p.verification, perf })
    add({ t: stamp(), src: 'ui', tag: 'report', text: `QuantumLedger-Compliance-${r.domain}.pdf generated${p.block ? ` · block ${p.block.block_hash.slice(0, 12)}…` : ''}`, level: 'INFO', tone: 'ok' })
  }
  useEffect(() => {
    document.title = 'QuantumLedger · PQC HUD'
  }, [])
  // the ledger is shown as rows now (no typing terminal); a verified block counts as read
  const { verification, setTyped } = p
  useEffect(() => {
    if (verification) setTyped(true)
  }, [verification, setTyped])

  // The 3D narrative (harvest → Q-Day → lattice fix → ledger → sweep) follows the real pipeline state.
  const story: Story = useMemo(
    () => ({
      active: !!r || p.scanning,
      scanning: p.scanning,
      stage: p.step,
      vulnerable: p.vulnerable > 0,
      patching: p.patching,
      patched: p.patched,
      anchored: !!p.block,
      chainIndex: p.block?.index ?? 0,
      rescan: p.rescan,
    }),
    [r, p.scanning, p.step, p.vulnerable, p.patching, p.patched, p.block, p.rescan],
  )
  // AR tabletop: once placed, the lattice shield locks around the link, then the ledger block snaps into
  // the Merkle chain. A composite of stages 3 + 4 so all three structures stand on the table together.
  const [arBeat, setArBeat] = useState(0)
  useEffect(() => {
    if (!xr.placed) return setArBeat(0)
    setArBeat(1)
    const t = setTimeout(() => setArBeat(2), 1600)
    return () => clearTimeout(t)
  }, [xr.placed])
  const arStory: Story = useMemo(
    () => ({ active: true, scanning: false, stage: 4, vulnerable: true, patching: false, patched: arBeat >= 1, anchored: arBeat >= 2, chainIndex: p.block?.index ?? 1, rescan: 'idle' }),
    [arBeat, p.block],
  )
  const scene = xr.presenting ? arStory : story
  useSonification(scene, p, heat, shorVuln)

  const storyData: StoryData = {
    domain: r?.domain ?? p.query.trim(),
    kex: p.before?.kex ?? null,
    sig: p.before?.leafKey ?? null,
    kexPq: !!p.before?.kexPq,
    mosca: p.m ? { x: p.m.x, y: p.m.y, z: p.m.z, sum: p.m.sum, holds: p.m.holds, exposed: p.m.exposedYears } : null,
    qDayYear: BASE_YEAR + Z_YEARS,
    block: p.block ? { index: p.block.index, hash: p.block.block_hash, root: p.block.merkle_root, prev: p.block.prev_hash, timestamp: p.block.timestamp, leaves: p.block.leaves } : null,
    rescanStep: p.rescanStep,
    net: r
      ? {
          ip: r.resolved_ip,
          tls: r.tls.version,
          cipher: r.tls.cipher_suite,
          rttMs: r.wire?.hello_rtt_ms ?? null,
          connectMs: r.wire?.connect_ms ?? null,
          clientHello: r.wire?.client_hello_bytes ?? null,
          serverShare: r.wire?.server_share_bytes ?? null,
          chainBytes: r.wire?.cert_chain_bytes ?? null,
        }
      : null,
    verified: !!p.verification?.valid,
  }

  return (
    <div className="hud-root">
      {/* ── header ── */}
      <header className="fixed inset-x-0 top-0 z-30 grid h-9 grid-cols-[1fr_auto] items-center border-b border-[var(--line)] bg-[rgb(8_10_15/0.8)] px-4">
        <button onClick={p.reset} className="flex items-center gap-3 text-left" aria-label="Reset">
          <span className="hud-live" />
          <span className="hud-h text-[12px] tracking-[0.16em]">QUANTUMLEDGER</span>
          <span className="hud-k hidden sm:inline">PQC diagnostics · TLS quantum-readiness</span>
        </button>
        <div className="flex items-center gap-2 whitespace-nowrap text-[10.5px] sm:gap-4">
          <span className="hud-dim hidden lg:inline">Console {CONSOLE}</span>
          <span className="hud-ice hidden sm:inline"><Clock /></span>
          <ArHandoff domain={r?.domain ?? p.query.trim()} />
          <button className="hud-btn quiet" onClick={() => sfx.setEnabled(!sfxOn)} aria-pressed={sfxOn} title="Cryptographic sonification (Web Audio)">
            ♪<span className="hidden sm:inline"> sfx</span> {sfxOn ? 'on' : 'off'}
          </button>
          <button className="hud-btn quiet" disabled={!r} onClick={exportCompliance}><span>REPORT<span className="hidden sm:inline">.PDF</span></span></button>
          <button className="hud-btn quiet" disabled={!r} onClick={p.exportJson}><span>CBOM<span className="hidden sm:inline">.JSON</span></span></button>
        </div>
      </header>

      {/* ── bento grid: data & risk | 3D viewport | network & logs ── */}
      <main className="bento">
        <div className="bento-col" aria-label="Data and risk">
          <VulnTracker p={p} />
          <Diagnostics p={p} addrs={addrs} />
          <RiskScore p={p} shorVuln={shorVuln} total={total} />
        </div>

        <Card icon={Globe} title="Threat Topology" still className="bento-viewport" right={<span className={`text-[10.5px] font-semibold tracking-[0.08em] ${statusCls}`}>{statusText}</span>}>
          <div ref={(el) => { hudAnchor.viewport = el }} className="absolute inset-0">
            <div className="absolute inset-0 z-[1]">
              <HudGlobe mode={mode} nodes={nodes} story={scene} />
            </div>
            <div className="hud-vignette" aria-hidden />
            <HudRings target={story.active ? null : r ? `${r.domain} · ${r.resolved_ip}` : null} index={1} total={Math.max(1, addrs.length)} dim={!story.active ? 1 : story.scanning || story.stage === 1 || story.stage === 3 ? 0.3 : 0} />
            <StoryOverlay story={story} data={storyData} />
            <NodeMarkers nodes={r && p.step === 2 && p.vulnerable > 0 ? [] : nodes} />
            <div className="hud-scan" aria-hidden />
          </div>
        </Card>

        <div className="bento-col" aria-label="Network and logs">
          <TelemetryTerminal lines={lines} state={stream.state} meta={stream.meta} />
          <PerfImpact r={r} bench={bench} benchError={benchErr} legacySig={legacySig} setLegacySig={setLegacySig} />
        </div>
      </main>
      <TrackingLayer nodes={nodes} active={tracking} />

      <PipelineBar p={p} onReport={exportCompliance} />
    </div>
  )
}

// ── left column cards ────────────────────────────────────────────────────────

function VulnTracker({ p }: { p: Pipeline }) {
  const r = p.result
  const crit = p.cwmBefore?.severity === 'CRITICAL'
  const list = p.patched ? p.upgraded : p.detected
  const tone = r && !p.scanning ? (p.patched || !p.vulnerable ? 'ok' : 'warn') : undefined
  const checks = ['Key exchange X25519MLKEM768 · FIPS 203', 'Certificate ML-DSA-65 key + signature · FIPS 204', 'CBOM: 0 Shor-vulnerable algorithms']
  return (
    <Card
      icon={Crosshair}
      title="Vulnerability Tracker"
      tone={tone}
      right={
        p.scanning ? (
          <span className="hud-live" />
        ) : r ? (
          <button className="hud-btn quiet" onClick={p.reset}>
            <RotateCcw size={11} aria-hidden /> new target
          </button>
        ) : undefined
      }
    >
      <motion.div key={`${!!r}-${p.scanning}-${p.patched}`} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18 }}>
        {!r && !p.scanning ? (
          <>
            <p className="text-[12px] leading-[18px] text-[#9aa7b4]">Live TLS handshake. The probe offers X25519MLKEM768 and records what the server negotiates and signs with.</p>
            <form className="mt-4 flex gap-2" onSubmit={(e) => { e.preventDefault(); p.scan(p.query) }}>
              <input className="hud-input" value={p.query} onChange={(e) => p.setQuery(e.target.value)} placeholder="hostname" aria-label="Domain to scan" autoFocus spellCheck={false} autoCapitalize="none" />
              <button className="hud-btn" type="submit" disabled={!p.query.trim()}>scan</button>
            </form>
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px]">
              <span className="hud-k">Presets</span>
              {EXAMPLES.map((d) => (
                <button key={d} className="hud-steel hover:text-white" onClick={() => { p.setQuery(d); p.scan(d) }}>{d}</button>
              ))}
            </div>
            {p.error && <p className="hud-crit mt-3 text-[12px]" role="alert">{p.error}</p>}
          </>
        ) : p.scanning ? (
          <>
            <div className="hud-h">Scanning {p.query.trim()}</div>
            <ol className="mt-3 space-y-1.5 text-[12px]">
              {SCAN_STEPS.map((s, i) => (
                <li key={s} className={i < p.scanStep ? 'hud-white' : i === p.scanStep ? 'hud-ice' : 'hud-dim'}>
                  <span className="hud-dim">{i < p.scanStep ? '✓' : i === p.scanStep ? '›' : '·'}</span> {s}
                </li>
              ))}
            </ol>
          </>
        ) : (
          <>
            <div className="hud-h">{p.patched ? 'Patched · no Shor-vulnerable locks' : p.vulnerable ? `${p.vulnerable} legacy lock${p.vulnerable > 1 ? 's' : ''} acquired` : 'No legacy locks'}</div>
            {!p.patched && p.diag?.meaning && <p className="mt-1.5 text-[12px] leading-[18px] text-[#9aa7b4]">{p.diag.meaning}</p>}
            {p.demo && <p className="hud-warn mt-2 text-[11px]">API unreachable · demo dataset</p>}
            <div className="mt-4">
              {list.map((a, i) => (
                <NodeRow
                  key={`${a.role}${a.name}`}
                  idx={i + 1}
                  role={a.role}
                  name={a.name}
                  state={a.safe ? 'ok' : crit ? 'crit' : 'warn'}
                  note={a.safe ? (p.patched ? (a.role === 'Signature' ? 'FIPS 204' : 'FIPS 203') : 'post-quantum') : a.role === 'Signature' ? 'cert key' : 'session keys'}
                  lock={a.safe ? undefined : `${a.role === 'Signature' ? 'sig' : 'kex'}:${a.name}`}
                />
              ))}
            </div>
            {!p.patched && p.otherFailing.length > 0 && <p className="hud-dim mt-3 text-[11px]">Chain · {p.otherFailing.map((a) => a.name).join(' · ')}</p>}
            {p.step === 5 && p.rescan !== 'idle' && (
              <ol className="mt-4 space-y-1.5 border-t border-[var(--line)] pt-4 text-[12px]">
                {checks.map((s, i) => (
                  <li key={s} className={p.rescanStep > i ? 'hud-ok' : p.rescanStep === i ? 'hud-ice' : 'hud-dim'}>
                    <span className="hud-dim">{p.rescanStep > i ? '✓' : p.rescanStep === i ? '›' : '·'}</span> {s}
                  </li>
                ))}
              </ol>
            )}
            {p.complete && p.before && <p className="hud-dim mt-3 text-[11px]">Verified against the simulated patched endpoint; live {r!.domain} still reports {p.before.leafKey}.</p>}
          </>
        )}
      </motion.div>
    </Card>
  )
}

function Diagnostics({ p, addrs }: { p: Pipeline; addrs: string[] }) {
  const r = p.result
  const b = p.block
  const v = p.verification
  return (
    <Card icon={Cpu} title="Cryptographic Diagnostics" right={p.scanning ? <span className="hud-live" /> : undefined}>
      <Row k="Scan" cls={p.scanning ? 'hud-ice' : r ? 'hud-white' : 'hud-dim'}>{p.scanning ? 'running' : r ? 'complete' : 'idle'}</Row>
      <Row k="Target">{r ? `${r.domain}:443` : p.scanning ? p.query.trim() : '—'}</Row>
      <Row k="Protocol" title={r ? `${r.tls.version} · ${r.tls.cipher_suite}` : undefined}>{r ? `${r.tls.version} · ${r.tls.cipher_suite}` : '—'}</Row>
      <Row k="Key exchange" cls={r ? (r.tls.key_exchange.pq_hybrid ? 'hud-ok' : 'hud-warn') : 'hud-dim'}>{r?.tls.key_exchange.group ?? '—'}</Row>
      <Row k="Certificate key" cls={r ? (p.patched ? 'hud-ok' : 'hud-warn') : 'hud-dim'}>{r ? (p.patched ? 'ML-DSA-65 (sim)' : `${r.certificate.public_key.name} · exp ${r.certificate.not_after.slice(0, 10)}`) : '—'}</Row>
      <Row k="Scan time">{r ? `${r.duration_ms} ms${r.wire?.hello_rtt_ms ? ` · rtt ${r.wire.hello_rtt_ms.toFixed(0)} ms` : ''}` : '—'}</Row>
      <div className="py-2">
        <Bar value={r?.duration_ms ?? 0} max={1500} />
      </div>
      {addrs.map((ip, i) => {
        const skipped = r?.skipped_addresses?.find((s) => s.ip === ip)
        return (
          <Row key={ip} k={`Address ${String(i + 1).padStart(2, '0')}`} mono cls={skipped ? 'hud-warn' : ip === r?.resolved_ip ? 'hud-ice' : 'hud-dim'}>
            {ip}
            <span className="font-sans">{skipped ? ' · no resp' : ip === r?.resolved_ip ? ' · active' : ''}</span>
          </Row>
        )
      })}
      {b && (
        <div className="mt-3 border-t border-[var(--line)] pt-3">
          <Row k="Ledger block" cls={v?.valid ? 'hud-ok' : 'hud-warn'}>#{b.index} · {v ? (v.valid ? `verified ${v.checks.length}/${v.checks.length}` : 'mismatch') : 'unverified'}</Row>
          <Row k="Merkle root" mono cls="text-[#c9d4de]" title={b.merkle_root}>{b.merkle_root}</Row>
          <Row k="Block hash" mono cls="text-[#c9d4de]" title={b.block_hash}>{b.block_hash}</Row>
          <Row k="Prev hash" mono cls="hud-dim" title={b.prev_hash}>{b.prev_hash}</Row>
        </div>
      )}
    </Card>
  )
}

function RiskScore({ p, shorVuln, total }: { p: Pipeline; shorVuln: number; total: number }) {
  const r = p.result
  const c = p.patched ? p.cwmAfter : p.cwmBefore
  const m = p.m
  if (!r || !c || !m) {
    return (
      <Card icon={Gauge} title="Risk Score">
        <p className="hud-dim text-[12px] leading-[18px]">Context-weighted Mosca risk (CWM) appears once a target is scanned.</p>
      </Card>
    )
  }
  const sev = (s: string) => (s === 'CRITICAL' ? 'hud-crit' : s === 'High' ? 'hud-warn' : 'hud-ok')
  const before = p.cwmBefore
  return (
    <Card icon={Gauge} title="Risk Score" tone={c.severity === 'Low' ? 'ok' : 'warn'} right={<span className={`text-[11px] font-semibold ${sev(c.severity)}`}>{c.severity === 'CRITICAL' ? 'Critical' : c.severity}</span>}>
      <div className="grid grid-cols-[140px_minmax(0,1fr)] items-center gap-4">
        <CwmGauge score={c.score} severity={c.severity} />
        <div>
          <Row k="Shor exposure" cls={shorVuln ? 'hud-crit' : 'hud-ok'}>{total ? ((shorVuln / total) * 100).toFixed(0) : '0'}% · {shorVuln}/{total}</Row>
          <Row k="Trust until">{Math.ceil(BASE_YEAR + m.sum)}</Row>
          <Row k="CRQC" cls={m.holds && !p.patched ? 'hud-warn' : 'hud-white'}>{BASE_YEAR + m.z}{m.holds && !p.patched ? ` · ${m.exposedYears.toFixed(1).replace('.0', '')} yr gap` : ''}</Row>
        </div>
      </div>
      {!p.patched && (
        <div className="mt-4 space-y-3 text-[12px]">
          <label className="block">
            <div className="flex justify-between"><span className="hud-k">X · migration time</span><span className="hud-white">{c.xml} yr</span></div>
            <select className="hud-select mt-1.5" value={p.assetType} onChange={(e) => p.setAssetType(e.target.value as AssetType)} aria-label="Asset type">
              {ASSET_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          </label>
          <label className="block">
            <div className="flex justify-between"><span className="hud-k">Y · shelf life</span><span className="hud-white">{p.y} yr</span></div>
            <input type="range" min={0} max={30} value={p.y} onChange={(e) => p.setY(Number(e.target.value))} aria-label="Data shelf life in years" />
          </label>
          <div className="flex justify-between"><span className="hud-k">Z · CRQC arrival</span><span className="hud-white">{Z_YEARS} yr fixed</span></div>
        </div>
      )}
      <div className="mt-4 rounded-lg border border-[var(--line-2)] bg-[rgb(0_0_0/0.3)] px-3 py-2.5 text-[11.5px] leading-[17px]">
        <div className="hud-steel">risk = ((X + Y) / Z) × exposure × fragility × 100</div>
        <div className={sev(c.severity)}>{formulaLine(c).toLowerCase()}</div>
      </div>
      {p.patched && before && (
        <div className="mt-4 grid grid-cols-3 gap-2 text-center">
          {[
            ['CWM', before.score.toFixed(1), c.score.toFixed(1)],
            ...(p.complete
              ? [
                  ['PQC score', String(r.assessment.score), '100'],
                  ['Shor-vuln', String(r.cbom_summary.filter((a) => !a.quantum_safe).length), '0'],
                ]
              : []),
          ].map(([k, a, b]) => (
            <div key={k} className="rounded-lg border border-[var(--line)] px-2 py-2">
              <div className="hud-k">{k}</div>
              <div className="mt-1 text-[13px] font-medium">
                <span className="hud-crit">{a}</span> <span className="hud-dim">→</span> <span className="hud-ok">{b}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

// ── pipeline control bar ─────────────────────────────────────────────────────

function stageInfo(p: Pipeline): { title: string; sub?: string } {
  const r = p.result
  const m = p.m
  switch (p.step) {
    case 1:
      if (p.scanning) return { title: `Scanning ${p.query.trim()}`, sub: SCAN_STEPS[Math.min(p.scanStep, SCAN_STEPS.length - 1)] }
      if (!r) return { title: 'Designate target', sub: 'Live TLS handshake offering X25519MLKEM768' }
      return { title: p.vulnerable ? `${p.vulnerable} legacy lock${p.vulnerable > 1 ? 's' : ''} acquired` : 'No legacy locks', sub: `${r.domain} · ${r.tls.version}` }
    case 2: {
      const s = p.cwmBefore?.severity
      return { title: s === 'CRITICAL' ? 'Critical · forgeable by a CRQC' : s === 'High' ? 'High risk' : 'Low risk', sub: m ? `Must stay trustworthy until ${Math.ceil(BASE_YEAR + m.sum)} · CRQC horizon ${BASE_YEAR + m.z}` : undefined }
    }
    case 3:
      return p.patched
        ? { title: 'Patched · ML-DSA-65 + X25519MLKEM768', sub: 'NIST FIPS 204 / FIPS 203 · simulated, live server unchanged' }
        : { title: 'Deploy quantum-safe patch', sub: 'Replace the legacy signature and key exchange · simulation' }
    case 4:
      return p.verification?.valid && p.block
        ? { title: 'Proof anchored', sub: `Block #${p.block.index} · leaves, root, block hash and chain link verified` }
        : { title: 'Anchor proof', sub: 'SHA-256 stage records → Merkle root → chained block' }
    default:
      return p.complete ? { title: '100% PQC-ready', sub: 'Every algorithm on the patched configuration is post-quantum' } : { title: 'Verification sweep', sub: 'Re-run the checks against the patched configuration' }
  }
}

function PipelineBar({ p, onReport }: { p: Pipeline; onReport: () => void }) {
  const r = p.result
  const info = stageInfo(p)
  const action = (() => {
    switch (p.step) {
      case 1:
        return r && !p.scanning ? <button className="hud-btn" onClick={() => p.goto(2)}>analyse risk »</button> : <span className="hud-dim text-[11.5px]">{p.scanning ? 'Handshake in progress…' : 'Enter a hostname to begin'}</span>
      case 2:
        return <button className="hud-btn warn" onClick={() => p.goto(3)}>countermeasures »</button>
      case 3:
        return p.patched ? (
          <button className="hud-btn" onClick={() => p.goto(4)}>prove »</button>
        ) : (
          <button className="hud-btn" onClick={p.applyPatch} disabled={p.patching}>{p.patching ? 'deploying…' : 'deploy ML-DSA / ML-KEM patch'}</button>
        )
      case 4:
        return !p.block ? (
          <button className="hud-btn" onClick={p.anchorProof} disabled={p.anchoring}>{p.anchoring ? 'hashing…' : 'anchor to merkle ledger'}</button>
        ) : p.verification ? (
          <button className="hud-btn" onClick={() => p.goto(5)}>rescan »</button>
        ) : null
      default:
        return p.rescan === 'idle' ? (
          <button className="hud-btn" onClick={p.runRescan}>run verification sweep</button>
        ) : p.complete ? (
          <>
            <button className="hud-btn quiet" onClick={p.exportJson}>cbom.json</button>
            <button className="hud-btn" onClick={onReport}><FileDown size={13} aria-hidden /> compliance report</button>
          </>
        ) : (
          <span className="hud-ice text-[11.5px]">Sweeping…</span>
        )
    }
  })()
  return (
    <footer className="bento-bar" aria-label="Pipeline">
      <div className="bento-stage min-w-0">
        <div className="hud-k">Stage 0{p.step} · {STEPS[p.step - 1][0]}</div>
        <div className="hud-h mt-0.5 truncate">{info.title}</div>
        {info.sub && <div className="hud-dim truncate text-[11px]">{info.sub}</div>}
      </div>
      <nav className="bento-steps" aria-label="Pipeline stages">
        {STEPS.map(([label, Icon], i) => {
          const n = i + 1
          const on = n === p.step
          const open = n <= p.reached
          const done = n < p.reached || (n === 5 && p.complete) || (n === p.reached && n < p.step)
          return (
            <Fragment key={label}>
              {i > 0 && <span className="bento-link" data-on={n <= p.reached ? '' : undefined} aria-hidden />}
              <button className="bento-step" disabled={!open} onClick={() => p.setStep(n)} aria-current={on ? 'step' : undefined} data-state={on ? 'current' : done ? 'done' : open ? 'open' : 'locked'}>
                <span className="ico"><Icon size={14} strokeWidth={1.75} aria-hidden /></span>
                <span className="lbl"><span className="num">0{n}</span>{label}</span>
              </button>
            </Fragment>
          )
        })}
      </nav>
      <div className="flex items-center gap-2">{action}</div>
    </footer>
  )
}
