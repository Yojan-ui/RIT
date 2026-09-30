import { Fragment, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type MutableRefObject, type ReactNode } from 'react'
import { Blocks, Cpu, FileDown, Gauge, Radar, RotateCcw, ScanLine, ShieldCheck, type LucideIcon } from 'lucide-react'
import { usePipeline, SCAN_STEPS, type Pipeline } from '../pipeline/usePipeline'
import type { CoreState } from '../scene/CryptoCore'
import { ASSET_TYPES, formulaLine, type AssetType } from '../lib/cwm'
import { BASE_YEAR, Z_YEARS } from '../lib/mosca'
import { HudGlobe } from './HudGlobe'
import { fetchBench, type Bench, type TelemetryEvent } from '../api'
import { exportComplianceReport } from '../lib/compliance'
import { computePerf } from '../lib/perf'
import { Bar, CwmGauge, HudRings, NodeMarkers, TrackingLayer } from './overlays'
import { Comparison, TelemetryTerminal, type StreamState, type TLine } from './Proof'
import { hudAnchor, type HoloNode, type HudMode, type Story } from './anchor'
import { StoryOverlay, type StoryData } from './StoryOverlay'
import { ArHandoff } from './ArHandoff'
import { Pane } from './pane'
import { SpatialSlot, spatial } from './spatial'
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
    push('PATCH', '[1] sig ML-DSA-65 · FIPS 204', 'ok')
    push('PATCH', '[2] kex X25519MLKEM768 · FIPS 203', 'ok')
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
    const n = p.verification?.checks.length
    if (p.verification) push('VERIFY', p.verification.valid ? `#${p.block?.index ?? '?'} verified · ${n}/${n} checks match` : `#${p.block?.index ?? '?'} mismatch`, p.verification.valid ? 'ok' : 'crit')
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

/** `KEY: value` row in the diagnostics format. `mono` is for hashes and IP addresses only. */
function Row({ k, children, cls = 'hud-white', mono = false, title }: { k: string; children: ReactNode; cls?: string; mono?: boolean; title?: string }) {
  return (
    <div className="hud-row">
      <span className="hud-k">{k}:</span>
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
  const add = useCallback((l: Omit<TLine, 'id'>) => {
    spatial.bump('terminal', 0.6) // every log line sends a burst from the terminal into the core
    setLines((ls) => [...ls.slice(-220), { ...l, id: seq.current++ }])
  }, [])
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
  const spatialOn = wide && !xr.presenting
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
  // the ledger is shown as rows (no typing terminal); a verified block counts as read
  const { verification, setTyped } = p
  useEffect(() => {
    if (verification) setTyped(true)
  }, [verification, setTyped])
  // new diagnostics feed the core: a stream burst from the Diagnostics pane
  useEffect(() => {
    if (r) spatial.bump('diagnostics', 2)
  }, [r, p.patched, p.block, p.cwmBefore])

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
      {/* the immersive core: one full-screen WebGL command deck */}
      <div className="fixed inset-0 z-[1]">
        <HudGlobe mode={mode} nodes={nodes} story={scene} spatialOn={spatialOn} />
      </div>
      <div className="pointer-events-none fixed inset-0 z-[4]">
        <div className="hud-vignette" aria-hidden />
        <HudRings target={story.active ? null : r ? `${r.domain} · ${r.resolved_ip}` : null} index={1} total={Math.max(1, addrs.length)} dim={!story.active ? 1 : story.scanning || story.stage === 1 || story.stage === 3 ? 0.3 : 0} />
        <StoryOverlay story={story} data={storyData} />
        <NodeMarkers nodes={r && p.step === 2 && p.vulnerable > 0 ? [] : nodes} />
      </div>
      {/* CSS3D layer: the floating panes, registered to the WebGL camera */}
      <div ref={(el) => { spatial.mount = el }} className="pointer-events-none fixed inset-0 z-[21]" aria-hidden={!spatialOn} />

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
          <span className={`${statusCls} hidden font-semibold tracking-[0.08em] sm:inline`}>{statusText}</span>
          <ArHandoff domain={r?.domain ?? p.query.trim()} />
          <button className="hud-btn quiet" onClick={() => sfx.setEnabled(!sfxOn)} aria-pressed={sfxOn} title="Cryptographic sonification (Web Audio)">
            ♪<span className="hidden sm:inline"> sfx</span> {sfxOn ? 'on' : 'off'}
          </button>
          <button className="hud-btn quiet" disabled={!r} onClick={exportCompliance}><span>REPORT<span className="hidden sm:inline">.PDF</span></span></button>
          <button className="hud-btn quiet" disabled={!r} onClick={p.exportJson}><span>CBOM<span className="hidden sm:inline">.JSON</span></span></button>
        </div>
      </header>

      {/* ── placeholders: the panes float over these cells; the middle cell is the hologram's zone ── */}
      <main className="holo-grid">
        <div className="holo-col" aria-label="Diagnostics">
          <SpatialSlot id="diagnostics" side={-1} fill stream on={spatialOn} className="flex min-h-0 flex-1 flex-col">
            <DiagnosticsPane p={p} addrs={addrs} shorVuln={shorVuln} total={total} />
          </SpatialSlot>
        </div>
        <div ref={(el) => { hudAnchor.zoneEl = el }} className="holo-zone" aria-hidden />
        <div className="holo-col" aria-label="Terminal and score">
          <SpatialSlot id="terminal" side={1} fill stream on={spatialOn} className="flex min-h-0 flex-1 flex-col">
            <TelemetryTerminal lines={lines} state={stream.state} meta={stream.meta} target={r?.domain ?? p.query.trim()} />
          </SpatialSlot>
          <SpatialSlot id="score" side={1} on={spatialOn}>
            <ScorePane p={p} />
          </SpatialSlot>
        </div>
        <div className="holo-bottom">
          <SpatialSlot id="sweep" side={0} on={spatialOn}>
            <SweepPane p={p} onReport={exportCompliance} comparison={<Comparison r={r} bench={bench} benchError={benchErr} legacySig={legacySig} setLegacySig={setLegacySig} />} />
          </SpatialSlot>
        </div>
      </main>
      <TrackingLayer nodes={nodes} active={tracking} />
    </div>
  )
}

// ── panes ────────────────────────────────────────────────────────────────────

function DiagnosticsPane({ p, addrs, shorVuln, total }: { p: Pipeline; addrs: string[]; shorVuln: number; total: number }) {
  const r = p.result
  const b = p.block
  const v = p.verification
  const cwm = p.patched ? p.cwmAfter : p.cwmBefore
  const crit = p.cwmBefore?.severity === 'CRITICAL'
  const sevCls = cwm?.severity === 'CRITICAL' ? 'hud-crit' : cwm?.severity === 'High' ? 'hud-warn' : cwm ? 'hud-ok' : 'hud-dim'
  const list = p.patched ? p.upgraded : p.detected
  const tone = r && !p.scanning ? (p.patched || !p.vulnerable ? 'ok' : 'warn') : undefined
  return (
    <Pane
      icon={Cpu}
      title="Diagnostics"
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
      <Row k="SCAN_SPECTRAL_ANALYSIS" cls={p.scanning ? 'hud-ice' : r ? 'hud-white' : 'hud-dim'}>{p.scanning ? 'running' : r ? 'complete' : 'idle'}</Row>
      <Row k="TARGET">{r ? `${r.domain}:443` : p.scanning ? p.query.trim() : '—'}</Row>
      <Row k="SHOR_EXPOSURE" cls={shorVuln ? 'hud-crit hud-sharp' : r ? 'hud-ok' : 'hud-dim'}>{r ? `${total ? ((shorVuln / total) * 100).toFixed(1) : '0.0'}% · ${shorVuln}/${total} alg` : '—'}</Row>
      <Row k="DECAY_RATE" cls={sevCls}>{cwm ? (cwm.severity === 'CRITICAL' ? 'high' : cwm.severity === 'High' ? 'elevated' : 'low') : '—'}</Row>
      <Row k="CWM_RISK" cls={sevCls}>{cwm ? `${cwm.score.toFixed(1)} / 100` : '—'}</Row>
      <Row k="KEX_GROUP" cls={r ? (r.tls.key_exchange.pq_hybrid ? 'hud-ok' : 'hud-warn') : 'hud-dim'}>{r?.tls.key_exchange.group ?? '—'}</Row>
      <Row k="CERT_KEY" cls={r ? (p.patched ? 'hud-ok' : 'hud-warn') : 'hud-dim'}>{r ? (p.patched ? 'ML-DSA-65 (sim)' : r.certificate.public_key.name) : '—'}</Row>
      <Row k="SCAN_TIME">{r ? `${r.duration_ms} ms${r.wire?.hello_rtt_ms ? ` · rtt ${r.wire.hello_rtt_ms.toFixed(0)} ms` : ''}` : '—'}</Row>
      <div className="py-1.5">
        <Bar value={r?.duration_ms ?? 0} max={1500} />
      </div>
      {addrs.map((ip, i) => {
        const skipped = r?.skipped_addresses?.find((s) => s.ip === ip)
        return (
          <Row key={ip} k={`ADDR_${String(i + 1).padStart(2, '0')}`} mono cls={skipped ? 'hud-warn' : ip === r?.resolved_ip ? 'hud-ice' : 'hud-dim'}>
            {ip}
            <span className="font-sans">{skipped ? ' · no resp' : ip === r?.resolved_ip ? ' · active' : ''}</span>
          </Row>
        )
      })}
      <Row k="LEDGER" cls={v?.valid ? 'hud-ok' : b ? 'hud-warn' : 'hud-dim'}>{b ? `#${b.index} ${v ? (v.valid ? 'verified' : 'mismatch') : 'unverified'}` : '—'}</Row>
      {b && (
        <>
          <Row k="MERKLE_ROOT" mono cls="text-[#c9d4de]" title={b.merkle_root}>{b.merkle_root}</Row>
          <Row k="BLOCK_HASH" mono cls="text-[#c9d4de]" title={b.block_hash}>{b.block_hash}</Row>
        </>
      )}

      {p.scanning && (
        <ol className="mt-3 space-y-1 border-t border-[var(--line)] pt-3 text-[12px]">
          {SCAN_STEPS.map((s, i) => (
            <li key={s} className={i < p.scanStep ? 'hud-white' : i === p.scanStep ? 'hud-ice' : 'hud-dim'}>
              <span className="hud-dim">{i < p.scanStep ? '[✓]' : i === p.scanStep ? '[·]' : '[ ]'}</span> {s}
            </li>
          ))}
        </ol>
      )}
      {r && !p.scanning && (
        <div className="mt-3 border-t border-[var(--line)] pt-3">
          {!p.patched && p.diag?.meaning && <p className="mb-2.5 text-[11.5px] leading-[17px] text-[#9aa7b4]">{p.diag.meaning}</p>}
          {p.demo && <p className="hud-warn mb-2 text-[11px]">API unreachable · demo dataset</p>}
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
          {!p.patched && p.otherFailing.length > 0 && <p className="hud-dim mt-2 text-[11px]">Chain · {p.otherFailing.map((a) => a.name).join(' · ')}</p>}
        </div>
      )}
    </Pane>
  )
}

function ScorePane({ p }: { p: Pipeline }) {
  const r = p.result
  const c = p.patched ? p.cwmAfter : p.cwmBefore
  const m = p.m
  if (!r || !c || !m) {
    return (
      <Pane icon={Gauge} title="Risk Score · CWM">
        <p className="hud-dim text-[12px] leading-[18px]">Context-weighted Mosca risk appears once a target is scanned.</p>
      </Pane>
    )
  }
  const sev = (s: string) => (s === 'CRITICAL' ? 'hud-crit' : s === 'High' ? 'hud-warn' : 'hud-ok')
  const before = p.cwmBefore
  return (
    <Pane icon={Gauge} title="Risk Score · CWM" tone={c.severity === 'Low' ? 'ok' : 'warn'} right={<span className={`text-[11px] font-semibold ${sev(c.severity)}`}>{c.severity === 'CRITICAL' ? 'Critical' : c.severity}</span>}>
      <div className="grid grid-cols-[124px_minmax(0,1fr)] items-center gap-4">
        <CwmGauge score={c.score} severity={c.severity} />
        <div>
          <Row k="TRUST_UNTIL">{Math.ceil(BASE_YEAR + m.sum)}</Row>
          <Row k="CRQC" cls={m.holds && !p.patched ? 'hud-warn' : 'hud-white'}>{BASE_YEAR + m.z}{m.holds && !p.patched ? ` · ${m.exposedYears.toFixed(1).replace('.0', '')} yr gap` : ''}</Row>
          {p.patched && before && (
            <Row k="CWM" cls="hud-white">
              <span className="hud-crit">{before.score.toFixed(1)}</span> <span className="hud-dim">→</span> <span className="hud-ok">{c.score.toFixed(1)}</span>
            </Row>
          )}
        </div>
      </div>
      {!p.patched && (
        <div className="mt-3 grid grid-cols-2 gap-3 text-[12px]">
          <label className="block">
            <div className="flex justify-between"><span className="hud-k">X · migration</span><span className="hud-white">{c.xml} yr</span></div>
            <select className="hud-select mt-1" value={p.assetType} onChange={(e) => p.setAssetType(e.target.value as AssetType)} aria-label="Asset type">
              {ASSET_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          </label>
          <label className="block">
            <div className="flex justify-between"><span className="hud-k">Y · shelf life</span><span className="hud-white">{p.y} yr</span></div>
            <input className="mt-1" type="range" min={0} max={30} value={p.y} onChange={(e) => p.setY(Number(e.target.value))} aria-label="Data shelf life in years" />
          </label>
        </div>
      )}
      <div className="mt-3 rounded-md border border-[var(--line-2)] bg-[rgb(0_0_0/0.3)] px-3 py-2 text-[11px] leading-[16px]">
        <div className="hud-steel">risk = ((X + Y) / Z) × exposure × fragility × 100 · Z = {Z_YEARS} yr</div>
        <div className={sev(c.severity)}>{formulaLine(c).toLowerCase()}</div>
      </div>
    </Pane>
  )
}

/** Focus without scrolling: autoFocus would scroll the page (and the CSS3D pane layer) to the console. */
const focusQuietly = (el: HTMLInputElement | null) => {
  if (el && innerWidth >= 1024) el.focus({ preventScroll: true })
}

/** Stage title for the console status line (`STAGE 05: 100% PQC-READY`) and its sub-line. */
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
        ? { title: `Proof anchored · #${p.block.index} verified`, sub: 'Leaves, root, block hash and chain link match' }
        : { title: 'Anchor proof', sub: 'SHA-256 stage records → Merkle root → chained block' }
    default:
      return p.complete ? { title: '100% PQC-ready', sub: 'Every algorithm on the patched configuration is post-quantum' } : { title: 'Verification sweep', sub: 'Re-run the checks against the patched configuration' }
  }
}

function SweepPane({ p, onReport, comparison }: { p: Pipeline; onReport: () => void; comparison: ReactNode }) {
  const r = p.result
  const info = stageInfo(p)
  const checks = ['kex X25519MLKEM768 · FIPS 203', 'cert ML-DSA-65 key + signature · FIPS 204', 'cbom 0 Shor-vulnerable']
  const action = (() => {
    switch (p.step) {
      case 1:
        if (p.scanning) return <span className="hud-ice text-[11.5px]">Handshake in progress…</span>
        if (!r)
          return (
            <form className="flex w-full gap-2" onSubmit={(e) => { e.preventDefault(); p.scan(p.query) }}>
              <input ref={focusQuietly} className="hud-input hud-mono" value={p.query} onChange={(e) => p.setQuery(e.target.value)} placeholder="hostname" aria-label="Domain to scan" spellCheck={false} autoCapitalize="none" />
              <button className="hud-btn" type="submit" disabled={!p.query.trim()}>scan</button>
            </form>
          )
        return <button className="hud-btn" onClick={() => p.goto(2)}>analyse risk »</button>
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
          <button className="hud-btn" onClick={onReport}><FileDown size={13} aria-hidden /> compliance report</button>
        ) : (
          <span className="hud-ice text-[11.5px]">Sweeping…</span>
        )
    }
  })()
  const done = p.step === 5 && p.complete
  return (
    <Pane icon={ScanLine} title="Verification Sweep · Pipeline" tone={done ? 'ok' : undefined} bodyClassName="holo-sweep">
      <div className="min-w-0">
        <div className={`text-[14px] font-semibold tracking-[0.04em] ${done ? 'hud-ok' : 'hud-white'}`}>
          STAGE 0{p.step}: {info.title.toUpperCase()}
        </div>
        {info.sub && <div className="hud-dim mt-0.5 truncate text-[11px]">{info.sub}</div>}
        <div className="mt-3 flex items-center gap-2">{action}</div>
        {p.step === 1 && !r && !p.scanning && (
          <div className="mt-2 flex flex-wrap items-center gap-x-3 text-[11px]">
            <span className="hud-k">presets</span>
            {EXAMPLES.map((d) => (
              <button key={d} className="hud-steel hover:text-white" onClick={() => { p.setQuery(d); p.scan(d) }}>{d}</button>
            ))}
          </div>
        )}
        {p.error && <p className="hud-crit mt-2 text-[11.5px]" role="alert">{p.error}</p>}
      </div>

      <div className="min-w-0">
        <nav className="holo-steps" aria-label="Pipeline stages">
          {STEPS.map(([label, Icon], i) => {
            const n = i + 1
            const on = n === p.step
            const open = n <= p.reached
            const stepDone = n < p.reached || (n === 5 && p.complete) || (n === p.reached && n < p.step)
            return (
              <Fragment key={label}>
                {i > 0 && <span className="holo-link" data-on={n <= p.reached ? '' : undefined} aria-hidden />}
                <button className="holo-step" disabled={!open} onClick={() => p.setStep(n)} aria-current={on ? 'step' : undefined} data-state={on ? 'current' : stepDone ? 'done' : open ? 'open' : 'locked'} title={`0${n} ${label}`}>
                  <span className="ico"><Icon size={13} strokeWidth={1.75} aria-hidden /></span>
                  <span className="lbl">{label}</span>
                </button>
              </Fragment>
            )
          })}
        </nav>
        <ol className="mt-3 space-y-0.5 text-[11.5px]">
          {checks.map((s, i) => (
            <li key={s} className={p.rescan === 'idle' ? 'hud-dim' : p.rescanStep > i ? 'hud-ok' : p.rescanStep === i ? 'hud-ice' : 'hud-dim'}>
              <span className="hud-dim">{p.rescan !== 'idle' && p.rescanStep > i ? '[✓]' : p.rescan !== 'idle' && p.rescanStep === i ? '[·]' : '[ ]'}</span> {s}
            </li>
          ))}
        </ol>
      </div>

      <div className="min-w-0">{comparison}</div>
    </Pane>
  )
}
