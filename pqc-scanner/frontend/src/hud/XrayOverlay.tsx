// DOM layers for the two inspection features, registered to 3D positions published by the scene.
//
//   HexTip        snaps onto the frozen packet under the cursor and scrolls a hex dump of the real bytes
//                 the probe exchanged with the target: the ClientHello it sent (client → server packets)
//                 or the server's reply (server → client). Record headers and key shares are highlighted.
//   XrayOverlay   the math inside an exploded view: ML-KEM-768 layers beside the lattice core, or every
//                 hash level of the Merkle block.
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ScanResult } from '../api'
import type { LedgerBlock } from '../lib/ledger'
import { hudAnchor } from './anchor'
import { useFrameLoop } from './overlays'
import { kemMath, merkleMath, useXray, xray, type KemMath, type MerkleMath } from './xray'

// ── TLS record parsing (just enough to find the key shares) ──────────────────

const GROUPS: Record<number, string> = { 0x11ec: 'X25519MLKEM768', 0x001d: 'x25519', 0x0017: 'secp256r1', 0x0018: 'secp384r1', 0x0019: 'secp521r1' }

interface Span {
  start: number
  end: number
  kind: 'hdr' | 'share'
  label: string
}

/** Byte spans worth highlighting in a ClientHello / ServerHello record: the record header and each key_share. */
function tlsSpans(b: Uint8Array, client: boolean): Span[] {
  const spans: Span[] = [{ start: 0, end: 5, kind: 'hdr', label: 'record header' }]
  try {
    let p = 5 + 4 + 2 + 32 // record header, handshake header, legacy_version, random
    p += 1 + b[p] // session id
    if (client) {
      p += 2 + ((b[p] << 8) | b[p + 1]) // cipher suites
      p += 1 + b[p] // compression methods
    } else p += 3 // cipher suite + compression
    const extEnd = p + 2 + ((b[p] << 8) | b[p + 1])
    p += 2
    while (p + 4 <= extEnd && p + 4 <= b.length) {
      const type = (b[p] << 8) | b[p + 1]
      const len = (b[p + 2] << 8) | b[p + 3]
      if (type === 0x0033) {
        let q = p + 4 + (client ? 2 : 0) // client: client_shares vector length
        const end = p + 4 + len
        while (q + 4 <= end) {
          const g = (b[q] << 8) | b[q + 1]
          const kl = (b[q + 2] << 8) | b[q + 3]
          spans.push({ start: q + 4, end: q + 4 + kl, kind: 'share', label: `${GROUPS[g] ?? `0x${g.toString(16)}`} key share · ${kl} B` })
          q += 4 + kl
          if (!client) break
        }
      }
      p += 4 + len
    }
  } catch {
    /* truncated capture: header highlight only */
  }
  return spans
}

const fromHex = (h: string) => Uint8Array.from(h.match(/../g) ?? [], (x) => parseInt(x, 16))
const ROWS = 9

export function HexTip({ r }: { r: ScanResult | null }) {
  const box = useRef<HTMLDivElement>(null)
  const [pkt, setPkt] = useState<{ i: number; dir: 'out' | 'in' } | null>(null)
  const [row, setRow] = useState(0)
  useFrameLoop(() => {
    const p = hudAnchor.packet
    if ((p?.i ?? -1) !== (pkt?.i ?? -1)) {
      setPkt(p ? { i: p.i, dir: p.dir } : null)
      setRow(0)
    }
    if (p && box.current) box.current.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px)`
  })
  const client = pkt?.dir === 'out'
  const hex = client ? r?.wire?.client_hello_hex : r?.wire?.server_flight_hex
  const bytes = useMemo(() => (hex ? fromHex(hex) : null), [hex])
  const spans = useMemo(() => (bytes ? tlsSpans(bytes, client) : []), [bytes, client])
  const total = bytes ? Math.ceil(bytes.length / 16) : 0
  // the dump scrolls while the packet is held; it opens on the first key share so the attack surface shows first
  const firstShare = spans.find((s) => s.kind === 'share')
  const base = firstShare ? Math.max(0, Math.floor(firstShare.start / 16) - 2) : 0
  useEffect(() => {
    if (!pkt || !total) return
    const id = setInterval(() => setRow((x) => x + 1), 140)
    return () => clearInterval(id)
  }, [pkt, total])
  if (!pkt || !r) return null

  const kex = r.tls.key_exchange
  const first = total ? (base + row) % Math.max(1, total - ROWS + 1) : 0
  const cls = (i: number) => {
    const s = spans.find((x) => i >= x.start && i < x.end)
    return s ? (s.kind === 'hdr' ? 'xr-hdr' : kex.pq_hybrid && s.label.startsWith('X25519MLKEM768') ? 'xr-pq' : 'xr-share') : ''
  }
  return (
    <div ref={box} className="pointer-events-none fixed top-0 left-0">
      <div className="xr-tip">
        <div className="xr-tip-head">
          <span>▮ FROZEN · PKT {String(pkt.i).padStart(2, '0')} · {client ? 'CLIENT → SERVER' : 'SERVER → CLIENT'}</span>
          <span>{client ? 'ClientHello' : `${r.tls.version} ServerHello`}</span>
        </div>
        <div className="xr-tip-sub">
          {client
            ? `${r.wire?.client_hello_bytes ?? '—'} B · offers X25519MLKEM768, x25519, P-256/384/521`
            : `${r.wire?.server_flight_bytes ?? '—'} B flight · ${kex.group ?? '?'} ${kex.pq_hybrid ? '· hybrid PQ' : '· classical · Shor-breakable, recordable now'}`}
        </div>
        {bytes ? (
          <pre className="xr-dump">
            {Array.from({ length: Math.min(ROWS, total) }, (_, k) => {
              const rr = first + k
              const o = rr * 16
              const slice = Array.from(bytes.slice(o, o + 16))
              return (
                <div key={rr}>
                  <span className="xr-off">{o.toString(16).padStart(4, '0')}</span>
                  {'  '}
                  {slice.map((v, j) => (
                    <span key={j} className={cls(o + j)}>
                      {v.toString(16).padStart(2, '0')}
                      {j === 7 ? '  ' : ' '}
                    </span>
                  ))}
                  {'  '.repeat(16 - slice.length)}
                  <span className="xr-asc">{slice.map((v) => (v >= 32 && v < 127 ? String.fromCharCode(v) : '·')).join('')}</span>
                </div>
              )
            })}
          </pre>
        ) : (
          <p className="xr-none">Raw bytes weren't captured for this result (demo dataset or an older backend).</p>
        )}
        <div className="xr-tip-foot">
          {spans
            .filter((s) => s.kind === 'share')
            .map((s) => (
              <span key={s.start} className={s.label.startsWith('X25519MLKEM768') ? 'hud-okc' : 'hud-crit'}>
                {s.label} @0x{s.start.toString(16)}
              </span>
            ))}
          {r.certificate.spki_hex && (
            <span className="hud-dim">
              leaf key {r.certificate.public_key.name} · SPKI {r.certificate.spki_hex.slice(0, 24)}…
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

// ── X-ray labels ─────────────────────────────────────────────────────────────

const poly = (c: number[]) => `[${c.map((x) => String(x).padStart(4, ' ')).join(' ')} …]`
const split = (h: string) => `${h.slice(0, 32)}\n${h.slice(32)}`

export function XrayOverlay({ block }: { block: LedgerBlock | null }) {
  const open = useXray()
  const box = useRef<HTMLDivElement>(null)
  const [kem, setKem] = useState<KemMath | null>(null)
  const [mk, setMk] = useState<MerkleMath | null>(null)
  useEffect(() => {
    if (open === 'kem' && !kem) setKem(kemMath())
    if (open === 'merkle' && block) merkleMath(block).then(setMk)
  }, [open, block, kem])
  useFrameLoop(() => {
    const el = box.current
    if (!el) return
    el.style.opacity = String(Math.min(1, xray.amt * 1.4))
    el.querySelectorAll<HTMLElement>('[data-at]').forEach((n) => {
      const p = hudAnchor.points[n.dataset.at!]
      if (!p) return
      // kem labels alternate sides of the stack, clear of the lattice's widest layer
      const dx = n.dataset.at!.startsWith('kem') ? (n.dataset.side === 'l' ? -1 : 1) * Math.max(120, hudAnchor.r * 1.1) : 0
      n.style.transform = `translate(${(p.x + dx).toFixed(1)}px, ${p.y.toFixed(1)}px)`
      n.style.visibility = p.on ? 'visible' : 'hidden'
    })
  })
  if (!open) return null

  const L = ({ at, className = '', children }: { at: string; className?: string; children: React.ReactNode }) => (
    <div data-at={at} data-side={className === 'side-l' ? 'l' : 'r'} className="absolute top-0 left-0">
      <div className={`xr-label ${className}`}>{children}</div>
    </div>
  )

  return (
    <div ref={box} className="pointer-events-none fixed inset-0" style={{ opacity: 0 }}>
      {open === 'kem' && kem && (
        <>
          {/* top layer first: seed, the public matrix, the public vector, the keys, one encapsulation */}
          <L at="kem6" className="side">
            <b>ρ</b> public seed · 32 B<code>{kem.rho}</code>
          </L>
          {kem.A.map((row, i) => (
            <L key={i} at={`kem${5 - i}`} className={i === 1 ? 'side' : 'side-l'}>
              <b>Â[{i}]</b> = SampleNTT(SHAKE128(ρ‖j‖{i})), j = 0..2
              <code>{row.map(poly).join('\n')}</code>
            </L>
          ))}
          <L at="kem2" className="side">
            <b>t̂</b> = Â·ŝ + ê  (NTT domain, mod q = 3329)
            <code>{kem.t.map(poly).join('\n')}</code>
          </L>
          <L at="kem1" className="side-l">
            <b>ek</b> = ByteEncode₁₂(t̂) ‖ ρ · {kem.ekBytes} B   <b>dk</b> {kem.dkBytes} B
          </L>
          <L at="kem0" className="side">
            <b>Encaps(ek)</b> → c {kem.ctBytes} B <code>{kem.ct}…</code>
            K = <code>{kem.ss.slice(0, 32)}…</code> {kem.match ? <span className="hud-ok">Decaps(dk, c) = K ✓</span> : <span className="hud-crit">mismatch</span>}
          </L>
        </>
      )}
      {open === 'merkle' && mk && block && (
        <>
          {mk.leaves.map((l, i) => (
            <L key={l.label} at={`mk_leaf${i}`} className={['left', 'below', 'right'][i]}>
              <b>leaf[{i}] {l.label}</b>
              <code>{`SHA-256(record)\n${l.hash.slice(0, 16)}…${l.hash.slice(-8)}\nH(0x00‖leaf)\n${l.node.slice(0, 16)}…${l.node.slice(-8)}`}</code>
            </L>
          ))}
          {mk.inner.map((h, i) => (
            <L key={i} at={`mk_inner${i}`} className={i ? 'right' : 'left'}>
              <b>{i === 0 ? 'H(0x01‖n₀‖n₁)' : 'n₂ promoted (odd)'}</b>
              <code>{`${h.slice(0, 16)}…${h.slice(-8)}`}</code>
            </L>
          ))}
          <L at="mk_block" className="right">
            <b>block #{mk.index}</b> = SHA-256(canonical{'{'}index, timestamp, domain, prev_hash, merkle_root{'}'})
            <code>{split(mk.block)}</code>
            <b>merkle_root</b> = H(0x01‖{mk.inner.length > 1 ? 'n₀₁‖n₂' : 'n'}) {mk.root === block.merkle_root ? <span className="hud-ok">✓ matches</span> : <span className="hud-crit">✗</span>}
            <code>{split(mk.root)}</code>
          </L>
          <L at="mk_prev" className="left">
            <b>prev_hash</b> {mk.index === 0 ? '(genesis)' : `block #${mk.index - 1}`}
            <code>{split(mk.prev)}</code>
          </L>
        </>
      )}
      <div className="xr-banner">
        <span className="hud-crit">▮</span> X-RAY · {open === 'kem' ? 'ML-KEM-768 (FIPS 203) · real keypair generated in this browser' : `Merkle block #${block?.index ?? '?'} · SHA-256 chain recomputed from the leaves`}
        <span className="hud-dim"> · click again or Esc to reassemble</span>
      </div>
    </div>
  )
}
