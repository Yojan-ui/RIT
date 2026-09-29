// DOM captions registered to the 3D story anchors, plus the plain-language narration bar.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { hudAnchor, type Story } from './anchor'

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

const CRIM = 'hud-crit'

// ── Q-Day countdown dial over the vault ──────────────────────────────────────

function QDayClock({ year }: { year: number }) {
  const target = Date.UTC(year, 0, 1)
  const span = target - Date.UTC(year - 7, 0, 1)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  const left = Math.max(0, target - now)
  const d = new Date(now)
  const yrs = Math.floor(left / (365.25 * 864e5))
  const days = Math.floor((left - yrs * 365.25 * 864e5) / 864e5)
  const rest = left % 864e5
  const hh = String(Math.floor(rest / 36e5)).padStart(2, '0')
  const mm = String(Math.floor((rest % 36e5) / 6e4)).padStart(2, '0')
  const ss = String(Math.floor((rest % 6e4) / 1e3)).padStart(2, '0')
  const frac = Math.min(1, left / span)
  const sec = d.getUTCSeconds()
  const arc = (f: number, r: number) => {
    const a = f * Math.PI * 2 - Math.PI / 2
    return `M 0 ${-r} A ${r} ${r} 0 ${f > 0.5 ? 1 : 0} 1 ${Math.cos(a) * r} ${Math.sin(a) * r}`
  }
  return (
    <>
      <svg viewBox="-80 -80 160 160" className="absolute -left-[80px] -top-[80px] h-[160px] w-[160px] overflow-visible">
        {Array.from({ length: 60 }, (_, i) => {
          const a = (i / 60) * Math.PI * 2
          const r0 = i % 5 === 0 ? 70 : 73
          return <line key={i} x1={Math.sin(a) * r0} y1={-Math.cos(a) * r0} x2={Math.sin(a) * 76} y2={-Math.cos(a) * 76} stroke={i <= sec ? '#ef4444' : '#4b5563'} strokeWidth={i % 5 === 0 ? 1 : 0.6} opacity={i <= sec ? 0.9 : 0.6} />
        })}
        <circle r="66" fill="none" stroke="#ef4444" strokeWidth="0.5" opacity="0.25" />
        <path d={arc(frac, 66)} fill="none" stroke="#ef4444" strokeWidth="1.5" />
        <line x1="0" y1="0" x2={Math.sin((sec / 60) * Math.PI * 2) * 62} y2={-Math.cos((sec / 60) * Math.PI * 2) * 62} stroke="#ffffff" strokeWidth="0.6" opacity="0.7" />
        <text x="0" y="-84" textAnchor="middle" fontSize="7" letterSpacing="1.4" fill="#ef4444" fontFamily="JetBrains Mono Variable, monospace">
          Q-DAY
        </text>
      </svg>
      <div className="absolute left-[92px] -top-[26px] whitespace-nowrap">
        <div className="hud-k">q-day · shor breaks rsa / ecc</div>
        <div className="hud-crit text-[16px] leading-[22px] tracking-[0.04em]">
          T− {yrs}y {String(days).padStart(3, '0')}d {hh}:{mm}:{ss}
        </div>
        <div className="hud-dim text-[10px]">est. {year}-01-01 · mosca z = 7 yr · {(frac * 100).toFixed(1)}% of window left</div>
      </div>
    </>
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
  const col = shown ? (bad ? '#ef4444' : '#10b981') : '#ffffff'
  const fmt = (n: number) => String(Number(n.toFixed(1)))
  return (
    <div className="text-center whitespace-nowrap">
      <div className="hud-k">mosca’s theorem</div>
      <motion.div className="mt-1 text-[26px] leading-[30px] tracking-[0.08em]" animate={{ color: col, textShadow: shown ? `0 0 3px ${col}` : '0 0 0px #fff' }} transition={{ duration: 0.6 }}>
        X + Y {shown ? (bad ? '>' : '≤') : '?'} Z
      </motion.div>
      <motion.div className="text-[12px] tracking-[0.06em]" animate={{ color: shown ? col : '#c9d4de' }} transition={{ duration: 0.6 }}>
        {fmt(m.x)} + {fmt(m.y)} = {fmt(m.sum)} yr {shown ? (bad ? '>' : '≤') : '?'} {m.z} yr
      </motion.div>
      <div className="hud-dim mt-1 text-[10px]">x migrate · y keep secret · z until q-day</div>
      <motion.div className={`mt-1 text-[10px] tracking-[0.14em] ${bad ? CRIM : 'hud-ok'}`} initial={{ opacity: 0 }} animate={{ opacity: shown ? 1 : 0 }} transition={{ duration: 0.4, delay: 0.3 }}>
        {bad ? `DATA OUTLIVES ITS ENCRYPTION · ${fmt(m.exposed)} YR EXPOSED` : 'MIGRATION FINISHES BEFORE Q-DAY'}
      </motion.div>
    </div>
  )
}

// ── narration ────────────────────────────────────────────────────────────────

function narrate(s: Story, d: StoryData): { chip: string; title: string; text: string; tone: string } {
  if (!s.active) return { chip: 'ready', title: 'Enter a website to begin', text: 'We inspect the digital lock that protects its traffic and show what a future quantum computer could do to it.', tone: 'hud-ice' }
  if (s.scanning) return { chip: '00 · connecting', title: `Reading how ${d.domain} locks its traffic`, text: 'A real TLS handshake: we record the lock used to agree session keys and the lock that proves the server’s identity.', tone: 'hud-ice' }
  const lock = `${d.kex ?? '?'} / ${d.sig ?? '?'}`
  switch (s.stage) {
    case 1:
      return s.vulnerable
        ? {
            chip: '01 · the attack',
            title: 'Harvest now, decrypt later',
            text: d.kexPq
              ? `Traffic can be copied and stored today. Its session keys are already post-quantum, but the ${d.sig} identity lock is not: a quantum computer could forge it and impersonate the site.`
              : `An adversary can copy this site’s encrypted traffic today and store it. The ${lock} lock holds against today’s computers, but a quantum computer will be able to open it.`,
            tone: CRIM,
          }
        : { chip: '01 · the attack', title: 'Nothing worth harvesting', text: 'This site already uses post-quantum locks; recorded traffic stays sealed.', tone: 'hud-ok' }
    case 2:
      return {
        chip: '02 · the deadline',
        title: d.mosca?.holds ? 'The data outlives its lock' : 'Migration beats the deadline',
        text: 'Q-Day is when a quantum computer can run Shor’s algorithm. If the years to migrate (X) plus the years data must stay secret (Y) exceed the years left (Z), what is stolen today is still valuable when it is unlocked.',
        tone: d.mosca?.holds ? CRIM : 'hud-ok',
      }
    case 3:
      if (s.patched)
        return { chip: '03 · the fix', title: 'The wiretap now captures noise', text: 'New sessions are sealed with ML-KEM and signed with ML-DSA. The attacker’s siphon shatters on the lattice. (Simulated patch: the live server is unchanged.)', tone: 'hud-ok' }
      if (s.patching) return { chip: '03 · the fix', title: 'Deploying lattice cryptography…', text: 'Replacing the breakable lock with NIST post-quantum standards FIPS 203 and FIPS 204.', tone: 'hud-ice' }
      return { chip: '03 · the fix', title: 'Swap the lock for a lattice', text: 'ML-KEM and ML-DSA are built on lattice problems that have no known quantum shortcut, unlike RSA and elliptic curves.', tone: 'hud-ice' }
    case 4:
      return s.anchored
        ? { chip: '04 · the proof', title: 'Quantum readiness, sealed in the chain', text: 'Each stage was hashed into a Merkle tree; its root is locked in a block linked to the one before. Changing any record later breaks the chain.', tone: 'hud-ok' }
        : { chip: '04 · the proof', title: 'Seal the evidence', text: 'Hash every stage record and lock the result into a tamper-evident chain, time-stamping the moment this system became quantum-ready.', tone: 'hud-ice' }
    default:
      if (s.rescan === 'done') return { chip: '05 · the verdict', title: '100% PQC-ready', text: 'Every link now uses post-quantum cryptography. Verified against the simulated patched configuration.', tone: 'hud-ok' }
      if (s.rescan === 'running') return { chip: '05 · the verdict', title: 'Sweeping every link…', text: 'Re-checking key exchange, certificate and the full crypto inventory.', tone: 'hud-ice' }
      return { chip: '05 · the verdict', title: 'Verify every link', text: 'A 360° sweep re-checks key exchange, certificate and the full crypto inventory.', tone: 'hud-ice' }
  }
}

// ── overlay ──────────────────────────────────────────────────────────────────

export function StoryOverlay({ story: s, data: d }: { story: Story; data: StoryData }) {
  const box = useRef<HTMLDivElement>(null)
  const cap = useRef<HTMLDivElement>(null)
  useFrameLoop(() => {
    box.current?.querySelectorAll<HTMLElement>('[data-at]').forEach((el) => {
      const p = hudAnchor.points[el.dataset.at!]
      if (!p) return
      el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px)`
      el.style.opacity = '1'
    })
    if (cap.current && hudAnchor.ready) cap.current.style.left = `${hudAnchor.x}px`
  })
  const results = s.active && !s.scanning
  const harvest = results && s.vulnerable && s.stage <= 3
  const done = results && s.stage === 5 && s.rescan === 'done'
  const n = narrate(s, d)
  const b = d.block
  const short = (h: string, k = 8) => `${h.slice(0, k)}…`

  return (
    <div ref={box} className="pointer-events-none fixed inset-0 z-[7] hidden text-[10px] leading-[13px] lg:block" aria-hidden>
      {s.active && (
        <>
          <At k="client" className="top-[24px] right-[-8px] text-right whitespace-nowrap">
            <div className="hud-k">client</div>
            <div className={done ? 'hud-ok' : 'hud-white'}>browser session</div>
          </At>
          <At k="server" className="top-[34px] left-[-8px] whitespace-nowrap">
            <div className="hud-k">server</div>
            <div className={done ? 'hud-ok' : s.patched ? 'hud-okc' : 'hud-white'}>{d.domain}</div>
          </At>
        </>
      )}

      {results && s.stage <= 3 && d.kex && (
        <At k="tap" className="left-[54px] top-[14px] whitespace-nowrap">
          <div className="hud-k">handshake</div>
          {s.patched ? (
            <>
              <div className="hud-ok">X25519MLKEM768 · ML-DSA-65</div>
              <div className="hud-okc">lattice · module-lwe</div>
            </>
          ) : (
            <>
              <div className={s.vulnerable ? CRIM : 'hud-ok'}>{d.kex} · {d.sig}</div>
              <div className="hud-dim">{s.vulnerable ? 'classical · recorded in transit' : 'post-quantum'}</div>
            </>
          )}
        </At>
      )}

      {harvest && (
        <At k="vault" className="right-[64px] -top-[20px] text-right whitespace-nowrap">
          <div className="hud-k">adversary vault</div>
          {s.patched ? (
            <>
              <div className={`${CRIM} tracking-[0.1em]`}>STATUS: SIPHON FAILED</div>
              <div className="hud-dim">new sessions unreadable · old captures still at risk</div>
            </>
          ) : (
            <>
              <div className={`${CRIM} hud-sharp flex items-center justify-end gap-1.5 tracking-[0.1em]`}>
                <span className="inline-block h-[5px] w-[5px] bg-[#ef4444]" style={{ animation: 'hud-live 1.6s ease-in-out infinite' }} />
                STATUS: HARVESTING ENCRYPTED DATA
              </div>
              <div className="hud-dim">stored now · decrypted after q-day</div>
            </>
          )}
        </At>
      )}

      {harvest && s.stage === 2 && (
        <At k="vault" className="">
          <QDayClock year={d.qDayYear} />
        </At>
      )}

      {results && s.stage === 2 && d.mosca && (
        <At k="mosca" className="-translate-x-1/2 -translate-y-full">
          <Mosca key={`${s.stage}`} m={d.mosca} />
        </At>
      )}

      {results && s.stage === 3 && s.patched && s.vulnerable && (
        <At k="tap" className="right-[54px] top-[14px] text-right whitespace-nowrap">
          <div className="hud-ok tracking-[0.1em]">LATTICE SHIELD</div>
          <div className="hud-dim">ml-kem-768 · fips 203</div>
        </At>
      )}

      {results && s.stage === 4 && (
        <>
          <At k="block" className="-top-[62px] -translate-x-1/2 text-center whitespace-nowrap">
            {b ? (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 2.0, duration: 0.4 }}>
                <div className="hud-ok tracking-[0.12em]">BLOCK #{b.index} · LOCKED</div>
                <div className="hud-white">{short(b.hash, 16)}</div>
                <div className="hud-dim">root {short(b.root, 12)} · {b.timestamp.replace('T', ' ').slice(0, 19)}Z</div>
              </motion.div>
            ) : (
              <div className="hud-dim tracking-[0.12em]">AWAITING ANCHOR</div>
            )}
          </At>
          <At k="prev" className="top-[26px] -translate-x-1/2 text-center whitespace-nowrap">
            <div className="hud-k">{b && b.index > 0 ? `#${b.index - 1}` : 'genesis'}</div>
            <div className="hud-dim">{b ? short(b.prev, 8) : '—'}</div>
          </At>
          <At k="next" className="top-[26px] -translate-x-1/2 text-center whitespace-nowrap">
            <div className="hud-k">#{b ? b.index + 1 : '·'}</div>
            <div className="hud-dim">next</div>
          </At>
          {b &&
            b.leaves.slice(0, 3).map((l, i) => (
              <At key={l.label} k={`leaf${i}`} className="top-[14px] -translate-x-1/2 text-center whitespace-nowrap">
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.0 + i * 0.1, duration: 0.3 }}>
                  <div className="hud-okc text-[9px] tracking-[0.12em]">{l.label.toUpperCase()}</div>
                  <div className="hud-dim text-[9px]">{l.hash.slice(0, 8)}</div>
                </motion.div>
              </At>
            ))}
        </>
      )}

      {results && s.stage === 5 && s.rescan === 'running' && (
        <At k="top" className="-translate-x-1/2 -translate-y-full text-center whitespace-nowrap">
          <div className="hud-ice tracking-[0.14em]">360° SWEEP · {d.rescanStep}/3</div>
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
      <div ref={cap} className="absolute bottom-4 w-[min(520px,40vw)] -translate-x-1/2">
        <motion.div key={`${n.chip}|${n.title}`} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }} className="border-t border-[var(--line-2)] bg-[rgb(8_10_15/0.72)] px-3 pt-2 pb-2.5 text-center">
          <div className={`text-[10px] tracking-[0.2em] uppercase ${n.tone}`}>{n.chip}</div>
          <div className="hud-white mt-0.5 text-[14px] leading-[20px] tracking-[0.04em]">{n.title}</div>
          <p className="mt-1 text-[11px] leading-[16px] text-[#9aa7b4]">{n.text}</p>
        </motion.div>
      </div>
    </div>
  )
}
