import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type MutableRefObject, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { usePipeline, SCAN_STEPS, type Pipeline } from '../pipeline/usePipeline'
import type { CoreState } from '../scene/CryptoCore'
import { TypeTerminal, type TermLine } from '../components/pipeline'
import { ASSET_TYPES, formulaLine, type AssetType } from '../lib/cwm'
import { BASE_YEAR, Z_YEARS } from '../lib/mosca'
import { HudGlobe } from './HudGlobe'
import { fetchBench, type Bench, type TelemetryEvent } from '../api'
import { exportComplianceReport } from '../lib/compliance'
import { computePerf } from '../lib/perf'
import { Bar, CwmGauge, HudRings, NodeMarkers, TrackingLayer } from './overlays'
import { PerfImpact, TelemetryTerminal, type StreamState, type TLine } from './Proof'
import type { HoloNode, HudMode, Story } from './anchor'
import { StoryOverlay, type StoryData } from './StoryOverlay'
import { ArHandoff } from './ArHandoff'
import { geiger, sfx } from './sfx'
import { SpatialSlot, spatial } from './spatial'
import { useXR } from './xr'
import './hud.css'

const STEPS = ['DETECT', 'SCORE', 'DEFEND', 'PROVE', 'RESCAN'] as const
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

function Panel({ title, right, tone, className = '', children }: { title: string; right?: ReactNode; tone?: 'warn' | 'ok'; className?: string; children: ReactNode }) {
  return (
    <section className={`hud-panel ${tone ?? ''} ${className}`}>
      <header className="hud-panel-head">
        <span className="hud-k">{title}</span>
        {right}
      </header>
      <div className="hud-panel-body">{children}</div>
    </section>
  )
}

function Row({ k, children, cls = 'hud-white' }: { k: string; children: ReactNode; cls?: string }) {
  return (
    <div className="hud-row">
      <span className="hud-k">{k}</span>
      <span className={`truncate text-right ${cls}`}>{children}</span>
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
        <span className="hud-white block truncate text-[12px]">{name}</span>
      </span>
      <span className="text-right">
        <span className={`block text-[10px] tracking-[0.12em] ${col}`}>{state === 'ok' ? 'PQ-SAFE' : 'SHOR-VULN'}</span>
        <span className="hud-dim block text-[10px]">{note}</span>
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
  const cwm = p.patched ? p.cwmAfter : p.cwmBefore
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
  const spatialOn = wide && !xr.presenting
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
      <div className="fixed inset-0 z-[1]" aria-hidden>
        <HudGlobe mode={mode} nodes={nodes} story={scene} spatialOn={spatialOn} />
      </div>
      {/* CSS3D layer: the floating glass panels (telemetry, score) are rendered here, registered to the WebGL camera */}
      <div ref={(el) => { spatial.mount = el }} className="fixed inset-0 z-[21] pointer-events-none" aria-hidden={!spatialOn} />
      <div className="hud-vignette" aria-hidden />
      <HudRings target={story.active ? null : r ? `${r.domain} · ${r.resolved_ip}` : null} index={1} total={Math.max(1, addrs.length)} dim={!story.active ? 1 : story.scanning || story.stage === 1 || story.stage === 3 ? 0.3 : 0} />
      <StoryOverlay story={story} data={storyData} />
      <NodeMarkers nodes={r && p.step === 2 && p.vulnerable > 0 ? [] : nodes} />
      <TrackingLayer nodes={nodes} active={tracking} />

      {/* ── header ── */}
      <header className="fixed inset-x-0 top-0 z-30 grid h-9 grid-cols-[1fr_auto] items-center border-b border-[var(--line)] bg-[rgb(8_10_15/0.8)] px-4">
        <button onClick={p.reset} className="flex items-center gap-3 text-left" aria-label="Reset">
          <span className="hud-live" />
          <span className="hud-h text-[12px] tracking-[0.2em]">QUANTUMLEDGER</span>
          <span className="hud-k hidden sm:inline">pqc diagnostics · tls quantum-readiness</span>
        </button>
        <div className="flex items-center gap-2 whitespace-nowrap text-[10px] sm:gap-4">
          <span className="hud-dim hidden lg:inline">CONSOLE {CONSOLE}</span>
          <span className="hud-ice hidden sm:inline"><Clock /></span>
          <span className={`${statusCls} hidden tracking-[0.14em] sm:inline`}>{statusText}</span>
          <ArHandoff domain={r?.domain ?? p.query.trim()} />
          <button className="hud-btn quiet" onClick={() => sfx.setEnabled(!sfxOn)} aria-pressed={sfxOn} title="Cryptographic sonification (Web Audio)">
            ♪<span className="hidden sm:inline"> sfx</span> {sfxOn ? 'on' : 'off'}
          </button>
          <button className="hud-btn quiet" disabled={!r} onClick={exportCompliance}><span>REPORT<span className="hidden sm:inline">.PDF</span></span></button>
          <button className="hud-btn quiet" disabled={!r} onClick={p.exportJson}><span>CBOM<span className="hidden sm:inline">.JSON</span></span></button>
        </div>
      </header>

      {/* the centre column is left to the WebGL canvas so OrbitControls receive the pointer */}
      <main className="hud-scroll relative z-20 h-full overflow-y-auto lg:pointer-events-none">
        <div className="grid min-h-full grid-cols-1 gap-3 px-4 pt-12 pb-6 lg:grid-cols-[minmax(0,520px)_1fr_380px]">
          {/* ── left ── */}
          <div className="space-y-3 max-lg:pt-[38vh] lg:pointer-events-auto">
            <nav className="grid grid-cols-5 gap-px bg-[var(--line)]" aria-label="Pipeline">
              {STEPS.map((s, i) => {
                const n = i + 1
                const on = n === p.step
                const open = n <= p.reached
                const done = n < p.reached || (n === 5 && p.complete) || (n === p.reached && n < p.step)
                return (
                  <button
                    key={s}
                    disabled={!open}
                    onClick={() => p.setStep(n)}
                    aria-current={on ? 'step' : undefined}
                    data-state={on ? 'current' : done ? 'done' : open ? 'open' : 'locked'}
                    className={`hud-step bg-[rgb(8_10_15/0.9)] px-2 py-1.5 text-left text-[10px] tracking-[0.14em] ${on ? 'hud-white' : open ? 'hud-steel' : 'text-[#2f3742]'}`}
                  >
                    <span className="hud-sdot" aria-hidden />
                    <span className="hud-dim">0{n}</span> {s}
                  </button>
                )
              })}
            </nav>

            <SpatialSlot id="score" side={-1} on={spatialOn}>
            <Panel title="quantumledger · diagnostics" right={p.scanning ? <span className="hud-live" /> : undefined} tone={mode === 'critical' || mode === 'alert' ? 'warn' : mode === 'secure' ? 'ok' : undefined}>
              <Row k="scan_spectral_analysis" cls={p.scanning ? 'hud-ice' : 'hud-white'}>{p.scanning ? 'running' : r ? 'complete' : 'idle'}</Row>
              <Row k="target">{r ? `${r.domain}:443` : p.scanning ? p.query.trim() : '—'}</Row>
              <Row k="shor_exposure" cls={shorVuln ? 'hud-crit hud-sharp' : r ? 'hud-ok' : 'hud-dim'}>
                {r ? `${total ? ((shorVuln / total) * 100).toFixed(1) : '0.0'}% · ${shorVuln}/${total} alg` : '—'}
              </Row>
              <Row k="decay_rate" cls={cwm?.severity === 'CRITICAL' ? 'hud-crit' : cwm?.severity === 'High' ? 'hud-warn' : cwm ? 'hud-ok' : 'hud-dim'}>
                {cwm ? (cwm.severity === 'CRITICAL' ? 'high' : cwm.severity === 'High' ? 'elevated' : 'low') : '—'}
              </Row>
              <Row k="cwm_risk" cls={cwm?.severity === 'CRITICAL' ? 'hud-crit' : cwm?.severity === 'High' ? 'hud-warn' : cwm ? 'hud-ok' : 'hud-dim'}>
                {cwm ? `${cwm.score.toFixed(1)} / 100 ${cwm.severity.toLowerCase()}` : '—'}
              </Row>
              <Row k="ledger" cls={p.verification?.valid ? 'hud-ok' : 'hud-dim'}>{p.block ? `#${p.block.index} ${p.verification?.valid ? 'verified' : 'unverified'}` : '—'}</Row>
            </Panel>
            </SpatialSlot>

            <motion.div key={`${p.step}-${!!r}-${p.scanning}`} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18 }}>
              {p.step === 1 && <Detect p={p} />}
              {p.step === 2 && <Score p={p} />}
              {p.step === 3 && <Defend p={p} />}
              {p.step === 4 && <Prove p={p} />}
              {p.step === 5 && <Rescan p={p} onReport={exportCompliance} />}
            </motion.div>
          </div>

          <div aria-hidden />

          {/* ── right ── */}
          <aside className="space-y-3 lg:pointer-events-auto">
            <SpatialSlot id="telemetry" side={1} on={spatialOn}>
              <TelemetryTerminal lines={lines} state={stream.state} meta={stream.meta} />
            </SpatialSlot>
            <PerfImpact r={r} bench={bench} benchError={benchErr} legacySig={legacySig} setLegacySig={setLegacySig} />
            <Panel title="link · certificate">
              <Row k="protocol" cls="hud-white text-[10px]">{r ? `${r.tls.version} · ${r.tls.cipher_suite}` : '—'}</Row>
              <Row k="kex group" cls={r ? (r.tls.key_exchange.pq_hybrid ? 'hud-ok' : 'hud-warn') : 'hud-dim'}>{r?.tls.key_exchange.group ?? '—'}</Row>
              <Row k="cert key" cls={r ? (p.patched ? 'hud-ok' : 'hud-warn') : 'hud-dim'}>{r ? (p.patched ? 'ML-DSA-65 (sim)' : `${r.certificate.public_key.name} · ${r.certificate.not_after.slice(0, 10)}`) : '—'}</Row>
              <Row k="scan time">{r ? `${r.duration_ms} ms${r.wire?.hello_rtt_ms ? ` · rtt ${r.wire.hello_rtt_ms.toFixed(0)} ms` : ''}` : '—'}</Row>
              <div className="py-1">
                <Bar value={r?.duration_ms ?? 0} max={1500} />
              </div>
              {addrs.map((ip, i) => {
                const skipped = r?.skipped_addresses?.find((s) => s.ip === ip)
                return (
                  <Row key={ip} k={`addr ${String(i + 1).padStart(2, '0')}`} cls={skipped ? 'hud-warn' : ip === r?.resolved_ip ? 'hud-ice' : 'hud-dim'}>
                    {ip}{skipped ? ' · no resp' : ip === r?.resolved_ip ? ' · active' : ''}
                  </Row>
                )
              })}
            </Panel>
          </aside>
        </div>
      </main>

      <div className="hud-scan" aria-hidden />
    </div>
  )
}

// ── stages ───────────────────────────────────────────────────────────────────

function Head({ n, title, sub }: { n: number; title: string; sub?: string }) {
  return (
    <div className="mb-3">
      <div className="hud-k">stage 0{n}</div>
      <div className="hud-h mt-0.5">{title}</div>
      {sub && <p className="mt-1.5 text-[11px] leading-[16px] text-[#9aa7b4]">{sub}</p>}
    </div>
  )
}

function Detect({ p }: { p: Pipeline }) {
  if (!p.result && !p.scanning) {
    return (
      <Panel title="target designation">
        <Head n={1} title="designate target" sub="Live TLS handshake. The probe offers X25519MLKEM768 and records what the server negotiates and signs with." />
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); p.scan(p.query) }}>
          <input className="hud-input" value={p.query} onChange={(e) => p.setQuery(e.target.value)} placeholder="hostname" aria-label="Domain to scan" autoFocus spellCheck={false} autoCapitalize="none" />
          <button className="hud-btn" type="submit" disabled={!p.query.trim()}>scan</button>
        </form>
        <div className="mt-2 flex flex-wrap gap-x-3 text-[10px]">
          <span className="hud-k">presets</span>
          {EXAMPLES.map((d) => (
            <button key={d} className="hud-steel hover:text-white" onClick={() => { p.setQuery(d); p.scan(d) }}>{d}</button>
          ))}
        </div>
        {p.error && <p className="hud-crit mt-3 text-[11px]" role="alert">{p.error}</p>}
      </Panel>
    )
  }
  if (p.scanning) {
    return (
      <Panel title="acquiring" right={<span className="hud-live" />}>
        <Head n={1} title={`scanning ${p.query.trim()}`} />
        <ol className="space-y-0.5 text-[11px]">
          {SCAN_STEPS.map((s, i) => (
            <li key={s} className={i < p.scanStep ? 'hud-white' : i === p.scanStep ? 'hud-ice' : 'hud-dim'}>
              <span className="hud-dim">{i < p.scanStep ? '[✓]' : i === p.scanStep ? '[·]' : '[ ]'}</span> {s.toLowerCase()}
            </li>
          ))}
        </ol>
      </Panel>
    )
  }
  const crit = p.cwmBefore?.severity === 'CRITICAL'
  return (
    <Panel title="detected cryptography" tone={p.vulnerable ? 'warn' : 'ok'}>
      <Head n={1} title={p.vulnerable ? `${p.vulnerable} legacy lock${p.vulnerable > 1 ? 's' : ''} acquired` : 'no legacy locks'} sub={p.diag?.meaning} />
      {p.demo && <p className="hud-warn mb-2 text-[10px]">api unreachable · demo dataset</p>}
      {p.detected.map((a, i) => (
        <NodeRow key={a.role} idx={i + 1} role={a.role} name={a.name} state={a.safe ? 'ok' : crit ? 'crit' : 'warn'} note={a.role === 'Signature' ? 'cert key' : 'session keys'} lock={a.safe ? undefined : `${a.role === 'Signature' ? 'sig' : 'kex'}:${a.name}`} />
      ))}
      {p.otherFailing.length > 0 && <p className="hud-dim mt-2 text-[10px]">chain · {p.otherFailing.map((a) => a.name).join(' · ')}</p>}
      <div className="mt-3"><button className="hud-btn" onClick={() => p.goto(2)}>analyse »</button></div>
    </Panel>
  )
}

function Score({ p }: { p: Pipeline }) {
  const c = p.cwmBefore
  const m = p.m
  if (!c || !m) return null
  const crit = c.severity === 'CRITICAL'
  return (
    <Panel title="threat analysis · context-weighted mosca" tone={c.severity === 'Low' ? 'ok' : 'warn'}>
      <Head
        n={2}
        title={crit ? 'critical · forgeable by crqc' : c.severity === 'High' ? 'high risk' : 'low risk'}
        sub={`Must stay trustworthy until ${Math.ceil(BASE_YEAR + m.sum)}; CRQC horizon ${BASE_YEAR + m.z}${m.holds ? ` (${m.exposedYears.toFixed(1).replace('.0', '')} yr exposed)` : ''}.`}
      />
      <div className="grid items-center gap-4 sm:grid-cols-[1fr_1fr]">
        <CwmGauge score={c.score} severity={c.severity} />
        <div className="space-y-2 text-[11px]">
          <label className="block">
            <div className="flex justify-between"><span className="hud-k">x_ml · migration</span><span className="hud-white">{c.xml} yr</span></div>
            <select className="hud-select mt-1" value={p.assetType} onChange={(e) => p.setAssetType(e.target.value as AssetType)} aria-label="Asset type">
              {ASSET_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          </label>
          <label className="block">
            <div className="flex justify-between"><span className="hud-k">y · shelf life</span><span className="hud-white">{p.y} yr</span></div>
            <input type="range" min={0} max={30} value={p.y} onChange={(e) => p.setY(Number(e.target.value))} />
          </label>
          <div className="flex justify-between"><span className="hud-k">z · crqc</span><span className="hud-white">{Z_YEARS} yr fixed</span></div>
        </div>
      </div>
      <div className="mt-3 border border-[var(--line)] bg-[rgb(0_0_0/0.35)] px-2.5 py-2 text-[10.5px] leading-[15px]">
        <div className="hud-k">validate</div>
        <div className="hud-steel">risk = ((x_ml + y) / z) × exp × fragility × 100</div>
        <div className={crit ? 'hud-crit' : c.severity === 'High' ? 'hud-warn' : 'hud-ok'}>{formulaLine(c).toLowerCase()} · {c.severity.toLowerCase()}</div>
      </div>
      <div className="mt-3">
        {p.detected.filter((a) => !a.safe).map((a, i) => (
          <NodeRow key={a.role} idx={i + 1} role={`tracked · ${a.role}`} name={a.name} state={crit ? 'crit' : 'warn'} note="remediate" lock={`${a.role === 'Signature' ? 'sig' : 'kex'}:${a.name}`} />
        ))}
      </div>
      <div className="mt-3"><button className="hud-btn warn" onClick={() => p.goto(3)}>countermeasures »</button></div>
    </Panel>
  )
}

function Defend({ p }: { p: Pipeline }) {
  const list = p.patched ? p.upgraded : p.detected
  return (
    <Panel title="countermeasures" tone={p.patched ? 'ok' : 'warn'}>
      <Head n={3} title={p.patched ? 'patched · ml-dsa-65 + x25519mlkem768' : 'deploy quantum-safe patch'} sub={p.patched ? 'Signature ML-DSA-65 (NIST FIPS 204) · key exchange X25519MLKEM768 (NIST FIPS 203).' : 'Replace the legacy signature and key exchange with NIST post-quantum standards.'} />
      {list.map((a, i) => (
        <NodeRow key={`${a.role}${a.name}`} idx={i + 1} role={a.role} name={a.name} state={a.safe ? 'ok' : 'warn'} note={a.safe ? (a.role === 'Signature' ? 'fips 204' : 'fips 203') : 'legacy'} />
      ))}
      <div className="mt-3 flex items-center gap-3">
        {p.patched ? (
          <button className="hud-btn" onClick={() => p.goto(4)}>prove »</button>
        ) : (
          <>
            <button className="hud-btn" onClick={p.applyPatch} disabled={p.patching}>{p.patching ? 'deploying…' : 'deploy ML-DSA/ML-KEM patch'}</button>
            <span className="hud-dim text-[10px]">simulation · live server unchanged</span>
          </>
        )}
      </div>
    </Panel>
  )
}

function Prove({ p }: { p: Pipeline }) {
  const b = p.block
  return (
    <Panel title="quantumledger · merkle ledger" tone={p.typed && p.verification?.valid ? 'ok' : undefined}>
      <Head n={4} title={p.typed && p.verification?.valid ? 'proof anchored' : 'anchor proof'} sub="Each stage record is hashed (SHA-256), combined into a Merkle root and chained to the previous block." />
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
                ...b.leaves.map((l, i): TermLine => ({ text: `leaf[${i}] ${l.label.toLowerCase().padEnd(7)} ${l.hash}` })),
                { text: `root     ${b.merkle_root}`, tone: 'strong' },
                { text: `prev     ${b.prev_hash}`, tone: 'dim' },
                { text: `block    ${b.block_hash}`, tone: 'strong' },
                { text: p.verification?.valid ? 'verify   ok · leaves, root, block hash, chain link' : 'verify   FAILED', tone: p.verification?.valid ? 'ok' : 'bad' },
              ]}
            />
          </div>
          {p.typed && <div className="mt-3"><button className="hud-btn" onClick={() => p.goto(5)}>rescan »</button></div>}
        </>
      )}
    </Panel>
  )
}

function Rescan({ p, onReport }: { p: Pipeline; onReport: () => void }) {
  const r = p.result
  const before = p.before
  if (!r || !before) return null
  const done = p.complete
  const checks = ['kex X25519MLKEM768 · fips 203', 'cert ML-DSA-65 key + signature · fips 204', 'cbom 0 shor-vulnerable algorithms']
  return (
    <div className="space-y-3">
      <Panel title="verification sweep" tone={done ? 'ok' : undefined}>
        <Head n={5} title={done ? '100% pqc-ready' : 'verification sweep'} sub={done ? 'Every algorithm on the patched configuration is post-quantum.' : 'Re-run the checks against the patched configuration.'} />
        {p.rescan === 'idle' ? (
          <button className="hud-btn" onClick={p.runRescan}>run verification sweep</button>
        ) : (
          <ol className="space-y-0.5 text-[11px]">
            {checks.map((s, i) => (
              <li key={s} className={p.rescanStep > i ? 'hud-ok' : p.rescanStep === i ? 'hud-ice' : 'hud-dim'}>
                <span className="hud-dim">{p.rescanStep > i ? '[✓]' : p.rescanStep === i ? '[·]' : '[ ]'}</span> {s}
              </li>
            ))}
          </ol>
        )}
        {done && <p className="hud-dim mt-2 text-[10px]">verified against the simulated patched endpoint · live {r.domain} still reports {before.leafKey}</p>}
      </Panel>
      {done && p.cwmBefore && p.cwmAfter && (
        <div className="grid grid-cols-2 gap-3">
          <Panel title="before · classical" tone="warn">
            <div className="hud-crit text-[12px]">{before.leafKey} + {before.kex}</div>
            <p className="mt-1.5 text-[10.5px] leading-[15px] text-[#9aa7b4]">Shor-breakable. A CRQC could forge signatures and impersonate the server{before.kexPq ? '.' : ', and decrypt recorded traffic.'}</p>
            <div className="mt-2">
              <Row k="cwm" cls="hud-crit">{p.cwmBefore.score.toFixed(1)}</Row>
              <Row k="pqc score" cls="hud-crit">{r.assessment.score}/100</Row>
              <Row k="shor-vuln" cls="hud-crit">{r.cbom_summary.filter((a) => !a.quantum_safe).length}</Row>
            </div>
          </Panel>
          <Panel title="after · post-quantum" tone="ok">
            <div className="hud-ok text-[12px]">ML-DSA-65 + X25519MLKEM768</div>
            <p className="mt-1.5 text-[10.5px] leading-[15px] text-[#9aa7b4]">Lattice-based (Module-LWE), no known efficient quantum attack. NIST FIPS 204 / 203.</p>
            <div className="mt-2">
              <Row k="cwm" cls="hud-ok">{p.cwmAfter.score.toFixed(1)}</Row>
              <Row k="pqc score" cls="hud-ok">100/100</Row>
              <Row k="shor-vuln" cls="hud-ok">0</Row>
            </div>
          </Panel>
        </div>
      )}
      {done && (
        <motion.section initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, delay: 0.2 }} className="hud-panel ok">
          <div className="hud-panel-body">
            <div className="hud-k">deliverable</div>
            <button className="hud-cta mt-2" onClick={onReport}>
              <span className="text-[15px] leading-none">⤓</span>
              <span>quantumledger compliance report</span>
              <span className="hud-dim ml-auto text-[10px] tracking-[0.12em]">PDF</span>
            </button>
            <div className="hud-dim mt-2 grid grid-cols-3 gap-2 text-[10px]">
              <span>final risk <span className="hud-ok">{p.cwmAfter?.score.toFixed(1)} {p.cwmAfter?.severity.toLowerCase()}</span></span>
              <span>cwm math <span className="hud-ok">✓</span></span>
              <span className="truncate">block <span className="hud-ok">{p.block ? `#${p.block.index} ${p.block.block_hash.slice(0, 8)}…` : 'not anchored'}</span></span>
            </div>
            <div className="mt-3 flex gap-2">
              <button className="hud-btn quiet" onClick={p.exportJson}>cbom.json</button>
              <button className="hud-btn quiet" onClick={p.reset}>new target</button>
            </div>
          </div>
        </motion.section>
      )}
    </div>
  )
}
