// QuantumLedger Compliance Report: the auditable deliverable at the end of the pipeline.
// Final risk score, the full CWM arithmetic, Mosca's inequality, the crypto inventory,
// the measured performance impact of the patch, and the ledger proof (block + Merkle root).
import { jsPDF } from 'jspdf'
import type { ScanResult } from '../api'
import type { CwmScore } from './cwm'
import { formulaLine, MODEL_ID } from './cwm'
import type { LedgerBlock, Verification } from './ledger'
import type { MoscaResult } from './mosca'
import { BASE_YEAR } from './mosca'
import { fmtBytes, fmtUs, INITCWND_BYTES, type Perf } from './perf'

export interface ComplianceInput {
  r: ScanResult
  demo: boolean
  patched: boolean
  complete: boolean
  cwmBefore: CwmScore | null
  cwmAfter: CwmScore | null
  mosca: MoscaResult | null
  block: LedgerBlock | null
  verification: Verification | null
  perf: Perf | null
}

type RGB = [number, number, number]
const INK: RGB = [22, 26, 32]
const DIM: RGB = [110, 118, 128]
const CYAN: RGB = [6, 150, 180]
const CRIM: RGB = [210, 50, 50]
const OK: RGB = [12, 150, 110]
const AMB: RGB = [220, 110, 20]
// jsPDF's standard fonts are WinAnsi only: map the few symbols outside it
const ascii = (s: string) => s.replace(/→/g, '->').replace(/≤/g, '<=').replace(/≥/g, '>=').replace(/✓/g, 'OK').replace(/✗/g, 'FAIL').replace(/−/g, '-')
const sevColor = (s: string): RGB => (s === 'CRITICAL' ? CRIM : s === 'High' ? AMB : OK)

export function exportComplianceReport(c: ComplianceInput) {
  const { r } = c
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const W = doc.internal.pageSize.getWidth()
  const H = doc.internal.pageSize.getHeight()
  const M = 48
  let y = 0

  const ensure = (h: number) => {
    if (y + h > H - 56) {
      doc.addPage()
      y = M
    }
  }
  const text = (raw: string, size = 9.5, o: { bold?: boolean; mono?: boolean; color?: RGB; x?: number; width?: number } = {}) => {
    const t = ascii(raw)
    doc.setFont(o.mono ? 'courier' : 'helvetica', o.bold ? 'bold' : 'normal')
    doc.setFontSize(size)
    doc.setTextColor(...(o.color ?? INK))
    const lines = doc.splitTextToSize(t, o.width ?? W - M - (o.x ?? M)) as string[]
    const lh = size * 1.35
    ensure(lines.length * lh)
    doc.text(lines, o.x ?? M, y + size)
    y += lines.length * lh
  }
  const gap = (h = 8) => {
    y += h
  }
  const section = (n: number, title: string) => {
    gap(16)
    ensure(28)
    doc.setFillColor(...CYAN)
    doc.rect(M, y + 2, 3, 11, 'F')
    text(`${String(n).padStart(2, '0')}  ${title.toUpperCase()}`, 9, { bold: true, color: INK, x: M + 10 })
    doc.setDrawColor(215, 220, 226)
    doc.line(M, y + 3, W - M, y + 3)
    y += 10
  }
  const kv = (label: string, value: string, o: { mono?: boolean; color?: RGB } = {}) => {
    const y0 = y
    text(label, 8.5, { color: DIM })
    const y1 = y
    y = y0
    text(value, o.mono ? 8.5 : 9, { mono: o.mono, color: o.color, x: M + 150 })
    y = Math.max(y, y1) + 2
  }
  const table = (cols: number[], head: string[], rows: { cells: string[]; colors?: (RGB | undefined)[] }[]) => {
    ensure(16)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.setTextColor(...DIM)
    head.forEach((h, i) => doc.text(h, M + cols[i], y + 9))
    y += 15
    for (const row of rows) {
      ensure(14)
      row.cells.forEach((cell, i) => {
        doc.setFont(i === 0 ? 'helvetica' : 'courier', i === 0 ? 'normal' : 'normal')
        doc.setFontSize(8.5)
        doc.setTextColor(...(row.colors?.[i] ?? INK))
        doc.text(ascii(cell), M + cols[i], y + 9)
      })
      y += 14
    }
  }

  // ── cover band ──
  doc.setFillColor(8, 10, 15)
  doc.rect(0, 0, W, 108, 'F')
  doc.setFillColor(103, 232, 249)
  doc.rect(M, 34, 6, 6, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.setTextColor(103, 232, 249)
  doc.text('QUANTUMLEDGER', M + 14, 40, { charSpace: 2 })
  doc.setFontSize(20)
  doc.setTextColor(255, 255, 255)
  doc.text('QuantumLedger Compliance Report', M, 70)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(150, 165, 180)
  const reportId = c.block ? c.block.block_hash.slice(0, 16) : 'unanchored'
  doc.text(`${r.domain}:443  ·  generated ${new Date().toISOString().replace('T', ' ').slice(0, 19)} UTC  ·  report ${reportId}`, M, 90)
  y = 128

  // ── 1 verdict ──
  const after = c.patched ? c.cwmAfter : c.cwmBefore
  section(1, 'Verdict')
  if (after) {
    const y0 = y
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(34)
    doc.setTextColor(...sevColor(after.severity))
    doc.text(after.score.toFixed(1), M, y + 32)
    doc.setFontSize(9)
    doc.text(`/ 100  ${after.severity.toUpperCase()}`, M + 84, y + 32)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(...DIM)
    doc.text('FINAL CWM RISK SCORE', M, y + 46)
    y = y0
    const x = M + 200
    text(c.complete ? '100% PQC-READY' : c.patched ? 'Patched, not yet re-verified' : 'Not remediated', 12, { bold: true, color: c.complete ? OK : c.patched ? AMB : CRIM, x })
    if (c.cwmBefore) text(`Risk ${c.cwmBefore.score.toFixed(1)} (${c.cwmBefore.severity}) → ${after.score.toFixed(1)} (${after.severity}) after ML-DSA-65 + X25519MLKEM768`, 9, { x, color: INK })
    text(`Ledger: ${c.block ? `block #${c.block.index}, ${c.verification?.valid ? 'verified' : 'unverified'}` : 'not anchored'}  ·  scan ${r.scanned_at}${c.demo ? '  ·  DEMO DATASET' : ''}`, 8.5, { x, color: DIM })
    y = Math.max(y, y0 + 52)
  }

  // ── 2 CWM breakdown ──
  section(2, 'Risk model: Context-Weighted Mosca (CWM)')
  text('Risk = ((X_ML + Y) / Z) × Exposure × Fragility × 100, capped at 100.', 9, { mono: true })
  gap(4)
  const cw = [0, 150, 300]
  const both = [c.cwmBefore, c.cwmAfter]
  const row = (label: string, f: (s: CwmScore) => string) => ({ cells: [label, ...both.map((s) => (s ? f(s) : '—'))] })
  table(cw, ['Term', 'Before (detected)', 'After (patched)'], [
    row('Signature', (s) => s.signature),
    row('X_ML migration (yrs)', (s) => `${s.xml}  (${s.assetType}: ${s.prediction.base} × ${s.prediction.factor})`),
    row('Y shelf life (yrs)', (s) => String(s.y)),
    row('Z years to CRQC', (s) => String(s.z)),
    row('(X_ML + Y) / Z', (s) => String(s.ratio)),
    row('Exposure', (s) => `${s.exposure}  (${s.zone})`),
    row('Fragility', (s) => String(s.fragility)),
    row('Raw', (s) => `${s.raw}${s.capped ? '  (capped)' : ''}`),
    { cells: ['Score', ...both.map((s) => (s ? `${s.score.toFixed(1)} ${s.severity}` : '—'))], colors: [undefined, ...both.map((s) => (s ? sevColor(s.severity) : undefined))] },
  ])
  gap(4)
  if (c.cwmBefore) text(`Before: ${formulaLine(c.cwmBefore)}`, 8, { mono: true, color: DIM })
  if (c.cwmAfter) text(`After:  ${formulaLine(c.cwmAfter)}`, 8, { mono: true, color: DIM })
  text(`X_ML model: ${MODEL_ID}`, 8, { color: DIM })
  if (c.mosca) {
    gap(4)
    const m = c.mosca
    text(
      `Mosca: X + Y ${m.holds ? '>' : '≤'} Z  →  ${m.x} + ${m.y} = ${m.sum} yr ${m.holds ? '>' : '≤'} ${m.z} yr. ${m.holds ? `Data protected today must stay secret until ${Math.ceil(BASE_YEAR + m.sum)}, ${m.exposedYears.toFixed(1)} yr past the estimated Q-Day (${BASE_YEAR + m.z}).` : 'Migration completes before the estimated Q-Day.'}`,
      9,
      { color: m.holds ? AMB : OK },
    )
  }

  // ── 3 inventory ──
  section(3, 'Cryptographic inventory (CycloneDX 1.6 CBOM)')
  kv('Endpoint', `${r.domain}:443 · ${r.resolved_ip} · ${r.tls.version} · ${r.tls.cipher_suite}`, { mono: true })
  kv('Key exchange', `${r.tls.key_exchange.group ?? 'unknown'} (${r.tls.key_exchange.pq_hybrid ? 'post-quantum hybrid' : 'classical'})`, { mono: true })
  kv('Certificate', `${r.certificate.subject_cn} · ${r.certificate.public_key.name} · ${r.certificate.signature.name} · expires ${r.certificate.not_after.slice(0, 10)}`, { mono: true })
  gap(4)
  table(
    [0, 170, 250, 400],
    ['Algorithm', 'Primitive', 'OID', 'Quantum-safe'],
    r.cbom_summary.map((a) => ({ cells: [a.name, a.primitive, a.oid ?? '—', a.quantum_safe ? 'yes' : 'no (Shor)'], colors: [undefined, undefined, undefined, a.quantum_safe ? OK : CRIM] })),
  )
  if (c.patched) {
    gap(2)
    text('Remediation: key exchange → X25519MLKEM768 (NIST FIPS 203); certificate key and signature → ML-DSA-65 (NIST FIPS 204).', 9, { color: OK })
  }

  // ── 4 performance ──
  if (c.perf) {
    const p = c.perf
    section(4, 'Performance impact of the patch')
    table(
      [0, 190, 340],
      ['Per TLS handshake', `Legacy (${p.legacy.kex} + ${p.legacy.sig})`, `PQC (${p.pqc.kex} + ${p.pqc.sig})`],
      [
        { cells: ['Crypto bytes on the wire', fmtBytes(p.legacy.wireBytes), fmtBytes(p.pqc.wireBytes)] },
        { cells: ['Server CPU', fmtUs(p.legacy.serverUs), fmtUs(p.pqc.serverUs)] },
        { cells: ['Client CPU', fmtUs(p.legacy.clientUs), fmtUs(p.pqc.clientUs)] },
        { cells: ['Handshakes / s / core', p.legacy.perCore.toLocaleString(), p.pqc.perCore.toLocaleString()] },
      ],
    )
    gap(2)
    text(
      `Added: ${fmtBytes(p.deltaBytes)} and ${p.deltaMs.toFixed(2)} ms CPU per handshake${p.rttMs ? `, ${p.pctOfRtt!.toFixed(1)}% of the ${p.rttMs.toFixed(0)} ms network round trip measured by the live probe` : ''}. Client side: the probe's own ${p.clientHelloBytes ?? '~1,500'}-byte ClientHello already carried the ML-KEM-768 key share in one packet. ${
        p.serverFlight
          ? `Server side: estimated flight ${fmtBytes(p.serverFlight.legacy)} -> ${fmtBytes(p.serverFlight.pqc)}, ${p.extraRtt ? `above TCP's ${fmtBytes(INITCWND_BYTES)} initial window, so one extra round trip is possible (mitigate with a raised initcwnd or certificate compression).` : `within TCP's ${fmtBytes(INITCWND_BYTES)} initial window: no extra round trip.`}`
          : ''
      }`,
      9,
    )
    text(`Measured on the QuantumLedger host: ${p.source}. Wire bytes = key shares + leaf public key + certificate and CertificateVerify signatures.`, 8, { color: DIM })
  }

  // ── 5 ledger ──
  section(c.perf ? 5 : 4, 'Ledger proof (SHA-256 Merkle chain)')
  if (c.block) {
    const b = c.block
    kv('Block', `#${b.index} · ${b.timestamp}`, { mono: true })
    b.leaves.forEach((l, i) => kv(`Leaf ${i} · ${l.label}`, l.hash, { mono: true }))
    kv('Merkle root', b.merkle_root, { mono: true })
    kv('Previous block hash', b.prev_hash, { mono: true })
    kv('Block hash', b.block_hash, { mono: true, color: CYAN })
    if (c.verification) {
      gap(2)
      c.verification.checks.forEach((ch) => text(`[${ch.ok ? 'OK' : 'FAIL'}] ${ch.name}: ${ch.detail}`, 8.5, { mono: true, color: ch.ok ? OK : CRIM, x: M + 150 }))
    }
  } else text('Not anchored. Run stage 04 (Prove) to seal this assessment into the ledger.', 9, { color: AMB })

  gap(18)
  text(
    'Detection is a live TLS 1.3 handshake from the QuantumLedger host. The remediation and the re-verification are simulated against the patched configuration; no change was made to the live server. Ledger hashes are real SHA-256 over canonical JSON of each stage record; recompute them to verify this report.',
    7.5,
    { color: DIM },
  )

  const pages = doc.getNumberOfPages()
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.setTextColor(150, 158, 168)
    doc.text(`QuantumLedger Compliance Report · ${r.domain} · ${reportId}`, M, H - 26)
    doc.text(`page ${i} / ${pages}`, W - M, H - 26, { align: 'right' })
  }
  const blob = doc.output('blob')
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `QuantumLedger-Compliance-${r.domain}.pdf`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
