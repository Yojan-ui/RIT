// DOM captions registered to the 3D story anchors, the QuantumLedger status banner, and the
// plain-language narration bar.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { columnCenter, hudAnchor, type Story } from './anchor'

export interface StoryData {
  domain: string
  kex: string | null
  sig: string | null
  kexPq: boolean
  mosca: { x: number; y: number; z: number; sum: number; holds: boolean; exposed: number } | null
  qDayYear: number
  block: { index: number; hash: string; root: string; prev: string; timestamp: string; leaves: { label: string; hash: string }[] } | null
  rescanStep: number
}

function useFrameLoop(fn: () => void) {
  const ref = useRef(fn)
  useLayoutEffect(() => {
    ref.current = fn
  })
  useEffect(() => {
    let raf = 0
    const loop = () => {
      ref.current()
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [])
}

/** Positioned each frame at a named 3D anchor; `className` sets the offset from it. */
function At({ k, className = '', children }: { k: string; className?: string; children: ReactNode }) {
  return (
    <div data-at={k} className="hud-at absolute top-0 left-0">
      <div className={`absolute ${className}`}>{children}</div>
    </div>
  )
}

const AMBER = '#f97316'
const EMERALD = '#10b981'
const fmt = (n: number) => String(Number(n.toFixed(1)))

// ── Q-Day countdown (text beside the 3D dial) ────────────────────────────────

function Countdown({ year }: { year: number }) {
  const target = Date.UTC(year, 0, 1)
  const span = target - Date.UTC(year - 7, 0, 1)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  const left = Math.max(0, target - now)
  const yrs = Math.floor(left / (365.25 * 864e5))
  const days = Math.floor((left - yrs * 365.25 * 864e5) / 864e5)
  const rest = left % 864e5
  const hh = String(Math.floor(rest / 36e5)).padStart(2, '0')
  const mm = String(Math.floor((rest % 36e5) / 6e4)).padStart(2, '0')
  const ss = String(Math.floor((rest % 6e4) / 1e3)).padStart(2, '0')
  return (
    <div className="whitespace-nowrap">
      <div className="hud-k">q-day countdown · shor breaks rsa / ecc</div>
      <div className="text-[18px] leading-[24px] tracking-[0.04em]" style={{ color: AMBER, textShadow: `0 0 3px ${AMBER}` }}>
        T− {yrs}y {String(days).padStart(3, '0')}d {hh}:{mm}:{ss}
      </div>
      <div className="hud-dim text-[10px]">est. {year}-01-01 · {((left / span) * 100).toFixed(1)}% of the 7-yr window left</div>
    </div>
  )
}

// ── Mosca's theorem ──────────────────────────────────────────────────────────

function Mosca({ m }: { m: NonNullable<StoryData['mosca']> }) {
  const [shown, setShown] = useState(false)
  useEffect(() => {
    const id = setTimeout(() => setShown(true), 900)
    return () => clearTimeout(id)
  }, [])
  const bad = m.holds
  const col = shown ? (bad ? AMBER : EMERALD) : '#ffffff'
  const op = shown ? (bad ? '>' : '≤') : '?'
  return (
    <div className="text-center whitespace-nowrap">
      <div className="hud-k">mosca’s theorem</div>
      <motion.div className="mt-1 text-[28px] leading-[32px] tracking-[0.08em]" animate={{ color: col, textShadow: shown ? `0 0 3px ${col}` : '0 0 0px #fff' }} transition={{ duration: 0.6 }}>
        X + Y {op} Z
      </motion.div>
      <motion.div className="text-[12px] tracking-[0.06em]" animate={{ color: shown ? col : '#c9d4de' }} transition={{ duration: 0.6 }}>
        {fmt(m.x)} + {fmt(m.y)} = {fmt(m.sum)} yr {op} {m.z} yr
      </motion.div>
      <div className="hud-dim mt-1 text-[10px]">x years to migrate · y years data must stay secret · z years to q-day</div>
      <motion.div className="mt-1 text-[10px] tracking-[0.14em]" style={{ color: bad ? AMBER : EMERALD }} initial={{ opacity: 0 }} animate={{ opacity: shown ? 1 : 0 }} transition={{ duration: 0.4, delay: 0.3 }}>
        {bad ? `SHELF-LIFE EXPIRING · ${fmt(m.exposed)} YR PAST Q-DAY` : 'MIGRATION FINISHES BEFORE Q-DAY'}
      </motion.div>
    </div>
  )
}

// ── banner + narration ───────────────────────────────────────────────────────

function banner(s: Story, d: StoryData): [string, string] {
  if (!s.active) return ['STANDBY', 'hud-dim']
  if (s.scanning) return ['ACQUIRING TARGET', 'hud-ice']
  switch (s.stage) {
    case 1:
      return s.vulnerable ? ['HARVESTING IN PROGRESS', 'hud-crit'] : ['NO HARVESTABLE TRAFFIC', 'hud-ok']
    case 2:
      return d.mosca?.holds ? ['DATA SHELF-LIFE EXPIRING', 'hud-warn'] : ['WITHIN SAFE WINDOW', 'hud-ok']
    case 3:
      return s.patching || s.patched ? ['LATTICE CRYPTOGRAPHY ENGAGED', 'hud-okc'] : ['AWAITING PQC PATCH', 'hud-ice']
    case 4:
      return s.anchored ? ['STATE ANCHORED TO BLOCKCHAIN', 'hud-ok'] : ['READY TO ANCHOR', 'hud-ice']
    default:
      return s.rescan === 'done' ? ['100% POST-QUANTUM READY', 'hud-ok'] : s.rescan === 'running' ? ['VERIFICATION SWEEP', 'hud-ice'] : ['READY TO VERIFY', 'hud-ice']
  }
}

function narrate(s: Story, d: StoryData): { chip: string; title: string; text: string; tone: string } {
  if (!s.active) return { chip: 'ready', title: 'Enter a website to begin', text: 'QuantumLedger inspects the digital lock that protects its traffic and shows what a future quantum computer could do to it.', tone: 'hud-ice' }
  if (s.scanning) return { chip: '00 · connecting', title: `Reading how ${d.domain} locks its traffic`, text: 'A real TLS handshake: we record the lock used to agree session keys and the lock that proves the server’s identity.', tone: 'hud-ice' }
  const lock = `${d.kex ?? '?'} / ${d.sig ?? '?'}`
  switch (s.stage) {
    case 1:
      return s.vulnerable
        ? {
            chip: '01 · the vulnerability',
            title: 'Harvest now, decrypt later',
            text: d.kexPq
              ? `Traffic can be copied and stored today. Its session keys are already post-quantum, but the ${d.sig} identity lock is not: a quantum computer could forge it and impersonate the site.`
              : `The thin white line is today’s ${lock} connection. An adversary taps it and stores everything; it is safe from today’s computers, not from a quantum one.`,
            tone: 'hud-crit',
          }
        : { chip: '01 · the vulnerability', title: 'Nothing worth harvesting', text: 'This site already uses post-quantum locks; recorded traffic stays sealed.', tone: 'hud-ok' }
    case 2:
      return {
        chip: '02 · the risk',
        title: d.mosca?.holds ? 'The stolen data outlives its lock' : 'Migration beats the deadline',
        text: 'Q-Day is when a quantum computer can run Shor’s algorithm. If the years to migrate (X) plus the years data must stay secret (Y) exceed the years left (Z), what is in that vault will still matter when it is unlocked.',
        tone: d.mosca?.holds ? 'hud-warn' : 'hud-ok',
      }
    case 3:
      if (s.patched)
        return { chip: '03 · the patch', title: 'The wiretap snaps on the lattice', text: 'Client and server are wrapped in ML-KEM / ML-DSA lattice cryptography. Every new tap dissolves on contact. (Simulated patch: the live server is unchanged.)', tone: 'hud-okc' }
      if (s.patching) return { chip: '03 · the patch', title: 'Shattering the fragile link…', text: 'Replacing RSA / ECDSA with NIST post-quantum standards FIPS 203 and FIPS 204.', tone: 'hud-ice' }
      return { chip: '03 · the patch', title: 'Swap the lock for a lattice', text: 'ML-KEM and ML-DSA are built on lattice problems that have no known quantum shortcut, unlike RSA and elliptic curves.', tone: 'hud-ice' }
    case 4:
      return s.anchored
        ? { chip: '04 · the proof', title: 'Locked into the chain', text: 'The secured state was compressed into a hash block and snapped into a Merkle-tree chain. Changing any record later breaks the chain, so the audit trail can be verified.', tone: 'hud-ok' }
        : { chip: '04 · the proof', title: 'Seal the evidence', text: 'Compress this quantum-safe state into a cryptographic block and lock it into a tamper-evident chain.', tone: 'hud-ice' }
    default:
      if (s.rescan === 'done') return { chip: '05 · the verification', title: 'Every node is post-quantum', text: 'The radar sweep checked the whole topology: every node is locked green. Verified against the simulated patched configuration.', tone: 'hud-ok' }
      if (s.rescan === 'running') return { chip: '05 · the verification', title: 'Sweeping the network…', text: 'Re-checking key exchange, certificate and the full crypto inventory.', tone: 'hud-ice' }
      return { chip: '05 · the verification', title: 'Verify every node', text: 'A radar plane sweeps the whole network topology and re-checks every link.', tone: 'hud-ice' }
  }
}

// ── overlay ──────────────────────────────────────────────────────────────────

export function StoryOverlay({ story: s, data: d }: { story: Story; data: StoryData }) {
  const box = useRef<HTMLDivElement>(null)
  const cols = useRef<HTMLDivElement[]>([])
  const stats = useRef<HTMLSpanElement>(null)
  useFrameLoop(() => {
    box.current?.querySelectorAll<HTMLElement>('[data-at]').forEach((el) => {
      const p = hudAnchor.points[el.dataset.at!]
      if (!p) return
      el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px)`
      el.style.opacity = p.on ? '1' : '0'
    })
    if (stats.current) {
      const st = hudAnchor.stats
      stats.current.textContent = `${st.fps} fps · ${st.calls} draw calls · ${st.points.toLocaleString()} prims`
    }
    const cx = `${columnCenter(innerWidth)}px`
    cols.current.forEach((el) => el && (el.style.left = cx))
  })
  const results = s.active && !s.scanning
  const harvest = results && s.vulnerable && s.stage <= 3
  const done = results && s.stage === 5 && s.rescan === 'done'
  const n = narrate(s, d)
  const [status, tone] = banner(s, d)
  const b = d.block
  const short = (h: string, k = 8) => `${h.slice(0, k)}…`

  return (
    <div ref={box} className="pointer-events-none fixed inset-0 z-[7] hidden text-[10px] leading-[13px] lg:block" aria-hidden>
      {/* QuantumLedger status banner */}
      <div ref={(el) => { if (el) cols.current[0] = el }} className="absolute top-[50px] -translate-x-1/2">
        <motion.div key={status} initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }} className="hud-panel px-4 py-1.5 whitespace-nowrap">
          <span className="hud-white text-[13px] tracking-[0.08em]">QuantumLedger:</span> <span className={`${tone} hud-sharp text-[13px] tracking-[0.16em]`}>{status}</span>
        </motion.div>
      </div>

      {/* proof of render: live frame stats + camera controls */}
      <div ref={(el) => { if (el) cols.current[2] = el }} className="absolute top-[88px] -translate-x-1/2 text-center whitespace-nowrap">
        <div className="hud-dim text-[9.5px] tracking-[0.12em] uppercase">
          <span className="hud-okc">● live webgl</span> · <span ref={stats} className="hud-steel" />
        </div>
        <div className="hud-dim mt-0.5 text-[9.5px] tracking-[0.1em]">drag to orbit · scroll to zoom · right-drag to pan · double-click to re-frame</div>
      </div>

      {s.active && !(s.stage === 2 && results && s.vulnerable) && (
        <>
          <At k="client" className="top-[50px] right-[-24px] text-right whitespace-nowrap">
            <div className="hud-k">client</div>
            <div className={done ? 'hud-ok' : 'hud-white'}>browser session</div>
            {s.patched && s.stage >= 3 && <div className="hud-okc">ml-kem shield</div>}
          </At>
          <At k="server" className="top-[58px] left-[-24px] whitespace-nowrap">
            <div className="hud-k">server</div>
            <div className={done ? 'hud-ok' : 'hud-white'}>{d.domain}</div>
            {s.patched && s.stage >= 3 && <div className="hud-okc">ml-dsa shield</div>}
          </At>
        </>
      )}

      {results && (s.stage === 1 || s.stage === 3) && d.kex && (
        <At k="tap" className="left-[54px] top-[14px] whitespace-nowrap">
          <div className="hud-k">connection</div>
          {s.patched ? (
            <>
              <div className="hud-okc">X25519MLKEM768 · ML-DSA-65</div>
              <div className="hud-dim">lattice · module-lwe</div>
            </>
          ) : (
            <>
              <div className={s.vulnerable ? 'hud-white' : 'hud-ok'}>{d.kex} · {d.sig}</div>
              <div className="hud-dim">{s.vulnerable ? 'classical tls · fragile' : 'post-quantum'}</div>
            </>
          )}
        </At>
      )}

      {harvest && s.stage !== 2 && (
        <At k="vault" className="right-[64px] -top-[16px] text-right whitespace-nowrap">
          <div className="hud-k">adversary storage</div>
          {s.patched ? (
            <>
              <div className="hud-crit tracking-[0.1em]">WIRETAP DISSOLVED</div>
              <div className="hud-dim">new sessions unreadable · old captures still at risk</div>
            </>
          ) : (
            <>
              <div className="hud-crit hud-sharp tracking-[0.1em]">RECORDING HANDSHAKES</div>
              <div className="hud-dim">stored now · decrypted after q-day</div>
            </>
          )}
        </At>
      )}

      {harvest && s.stage === 2 && (
        <>
          <At k="vault" className="top-[84px] -translate-x-1/2 text-center whitespace-nowrap">
            <div className="hud-k">adversary storage</div>
            <div className="hud-crit">captured: {d.kex} · {d.sig}</div>
          </At>
          <At k="dialBottom" className="-translate-x-1/2 text-center">
            <Countdown year={d.qDayYear} />
          </At>
          {d.mosca && (
            <At k="dialTop" className="-translate-x-1/2 -translate-y-full">
              <Mosca m={d.mosca} />
            </At>
          )}
        </>
      )}
      {results && !s.vulnerable && s.stage === 2 && d.mosca && (
        <At k="mosca" className="-translate-x-1/2 -translate-y-full">
          <Mosca m={d.mosca} />
        </At>
      )}

      {results && s.stage === 4 && (
        <>
          <At k="block" className="-top-[62px] -translate-x-1/2 text-center whitespace-nowrap">
            {b ? (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.7, duration: 0.4 }}>
                <div className="hud-ok tracking-[0.12em]">BLOCK #{b.index} · LOCKED</div>
                <div className="hud-white">{short(b.hash, 16)}</div>
                <div className="hud-dim">root {short(b.root, 12)} · {b.timestamp.replace('T', ' ').slice(0, 19)}Z</div>
              </motion.div>
            ) : (
              <div className="hud-dim tracking-[0.12em]">AWAITING ANCHOR</div>
            )}
          </At>
          <At k="prev" className="top-[22px] -translate-x-1/2 text-center whitespace-nowrap">
            <div className="hud-k">{b && b.index > 0 ? `#${b.index - 1}` : 'genesis'}</div>
            <div className="hud-dim">{b ? short(b.prev, 8) : '—'}</div>
          </At>
          <At k="next" className="top-[22px] -translate-x-1/2 text-center whitespace-nowrap">
            <div className="hud-k">#{b ? b.index + 1 : '·'}</div>
            <div className="hud-dim">next</div>
          </At>
          {b &&
            b.leaves.slice(0, 3).map((l, i) => (
              <At key={l.label} k={`leaf${i}`} className="top-[12px] -translate-x-1/2 text-center whitespace-nowrap">
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 + i * 0.15, duration: 0.3 }}>
                  <div className="hud-okc text-[9px] tracking-[0.12em]">{l.label.toUpperCase()}</div>
                  <div className="hud-dim text-[9px]">{l.hash.slice(0, 8)}</div>
                </motion.div>
              </At>
            ))}
        </>
      )}

      {results && s.stage === 5 && s.rescan === 'running' && (
        <At k="top" className="-translate-x-1/2 -translate-y-full text-center whitespace-nowrap">
          <div className="hud-ice tracking-[0.14em]">RADAR SWEEP · CHECK {d.rescanStep}/3</div>
        </At>
      )}
      {done && (
        <At k="top" className="-translate-x-1/2 -translate-y-full">
          <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }} className="hud-panel ok px-4 py-2 text-center whitespace-nowrap">
            <div className="hud-ok hud-sharp text-[18px] leading-[24px] tracking-[0.16em]">100% PQC-READY</div>
            <div className="hud-dim">all nodes verified · fips 203 kex · fips 204 signature</div>
          </motion.div>
        </At>
      )}

      {/* plain-language narration for the non-specialist */}
      <div ref={(el) => { if (el) cols.current[1] = el }} className="absolute bottom-4 w-[min(520px,40vw)] -translate-x-1/2">
        <motion.div key={`${n.chip}|${n.title}`} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }} className="border-t border-[var(--line-2)] bg-[rgb(8_10_15/0.72)] px-3 pt-2 pb-2.5 text-center">
          <div className={`text-[10px] tracking-[0.2em] uppercase ${n.tone}`}>{n.chip}</div>
          <div className="hud-white mt-0.5 text-[14px] leading-[20px] tracking-[0.04em]">{n.title}</div>
          <p className="mt-1 text-[11px] leading-[16px] text-[#9aa7b4]">{n.text}</p>
        </motion.div>
      </div>
    </div>
  )
}
