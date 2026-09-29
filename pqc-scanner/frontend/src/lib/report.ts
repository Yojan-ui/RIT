// Enterprise exports: a CycloneDX 1.6 JSON file and a PDF report for compliance teams.
import { jsPDF } from 'jspdf'
import type { ScanResult } from '../api'
import type { LedgerBlock, Verification } from './ledger'
import type { PlanItem } from './diagnosis'

function saveBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function exportCbomJson(r: ScanResult) {
  saveBlob(`${r.domain}.cbom.cdx.json`, new Blob([JSON.stringify(r.cbom, null, 2)], { type: 'application/vnd.cyclonedx+json' }))
}

interface ReportState {
  fixed: boolean
  plan: PlanItem[]
  block: LedgerBlock | null
  verification: Verification | null
}

export function exportPdfReport(r: ScanResult, s: ReportState) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const W = doc.internal.pageSize.getWidth()
  const H = doc.internal.pageSize.getHeight()
  const M = 48
  let y = M

  const ensure = (h: number) => {
    if (y + h > H - M) {
      doc.addPage()
      y = M
    }
  }
  const text = (t: string, size = 10, opts: { bold?: boolean; mono?: boolean; color?: [number, number, number]; x?: number; width?: number } = {}) => {
    doc.setFont(opts.mono ? 'courier' : 'helvetica', opts.bold ? 'bold' : 'normal')
    doc.setFontSize(size)
    doc.setTextColor(...(opts.color ?? [20, 20, 24]))
    const lines = doc.splitTextToSize(t, opts.width ?? W - M * 2 - ((opts.x ?? M) - M)) as string[]
    const lh = size * 1.35
    ensure(lines.length * lh)
    doc.text(lines, opts.x ?? M, y + size)
    y += lines.length * lh
  }
  const gap = (h = 10) => {
    y += h
  }
  const rule = () => {
    ensure(12)
    doc.setDrawColor(220, 220, 225)
    doc.line(M, y + 4, W - M, y + 4)
    y += 12
  }
  const section = (title: string) => {
    gap(14)
    text(title.toUpperCase(), 8.5, { bold: true, color: [110, 110, 120] })
    rule()
  }
  const kv = (label: string, value: string, mono = false) => {
    const startY = y
    text(label, 9.5, { color: [110, 110, 120] })
    const afterLabel = y
    y = startY
    text(value, mono ? 9 : 9.5, { mono, x: M + 150, width: W - M * 2 - 150 })
    y = Math.max(y, afterLabel) + 3
  }

  const cert = r.certificate
  const kx = r.tls.key_exchange

  // Title
  text('Cryptographic Bill of Materials Report', 18, { bold: true })
  gap(2)
  text(`${r.domain}:443  ·  generated ${new Date().toISOString().replace('T', ' ').slice(0, 19)} UTC  ·  PQC Scanner`, 9.5, { color: [110, 110, 120] })

  section('Summary')
  const status = s.fixed ? 'Remediated (simulated): ML-DSA-65 + X25519MLKEM768' : r.assessment.headline
  kv('Status', status)
  kv('Urgency', `${r.assessment.urgency.level}: ${r.assessment.urgency.deadline}`)
  kv('Scanned', `${r.scanned_at} (live TLS handshake, ${r.duration_ms} ms)`)

  section('Endpoint')
  kv('Asset', `${r.domain}:443`, true)
  kv('Resolved IP', r.resolved_ip, true)
  kv('Protocol', `${r.tls.version} · ${r.tls.cipher_suite}`, true)
  kv('Key exchange', `${kx.group ?? 'unknown'}${kx.pq_hybrid ? ' (post-quantum hybrid)' : ' (classical)'}`, true)

  section('Certificate')
  kv('Subject', cert.subject_cn ?? '—', true)
  kv('Issuer', `${cert.issuer_cn ?? ''}${cert.issuer_org ? ` · ${cert.issuer_org}` : ''}`)
  kv('Validity', `${cert.not_before.slice(0, 10)} to ${cert.not_after.slice(0, 10)} (${cert.days_remaining} days left)`)
  kv('Public key', cert.public_key.name, true)
  kv('Signature', cert.signature.name, true)

  section('Cryptographic assets (CycloneDX 1.6)')
  const cols = [M, M + 150, M + 225, M + 400, M + 455]
  const header = ['Algorithm', 'Primitive', 'OID', 'Level', 'Quantum-safe']
  ensure(16)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8.5)
  doc.setTextColor(110, 110, 120)
  header.forEach((h, i) => doc.text(h, cols[i], y + 9))
  y += 16
  for (const a of r.cbom_summary) {
    ensure(15)
    doc.setFont('courier', 'normal')
    doc.setFontSize(8.5)
    doc.setTextColor(20, 20, 24)
    doc.text(a.name, cols[0], y + 9)
    doc.setFont('helvetica', 'normal')
    doc.text(a.primitive, cols[1], y + 9)
    doc.setFont('courier', 'normal')
    doc.text(a.oid ?? '—', cols[2], y + 9)
    doc.text(String(a.nist_level || '—'), cols[3], y + 9)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(...((a.quantum_safe ? [16, 150, 105] : [200, 40, 40]) as [number, number, number]))
    doc.text(a.quantum_safe ? 'Yes' : 'No (Shor)', cols[4], y + 9)
    y += 15
  }
  gap(4)
  text(`CBOM serial: ${String(r.cbom.serialNumber ?? '')}`, 8.5, { mono: true, color: [110, 110, 120] })

  section('Action plan')
  s.plan.forEach((p, i) => {
    const done = p.preexisting || s.fixed
    const state = p.preexisting ? 'Already compliant' : s.fixed ? 'Done (simulated)' : 'Open'
    text(`${i + 1}. ${p.title}`, 10, { bold: true })
    text(`${p.detail}  [${p.standard}]  —  ${state}`, 9, { color: done ? [16, 150, 105] : [110, 110, 120], x: M + 14, width: W - M * 2 - 14 })
    gap(4)
  })

  if (s.block) {
    section('Ledger proof')
    kv('Block', `#${s.block.index} · ${s.block.timestamp}`, true)
    kv('Previous hash', s.block.prev_hash, true)
    kv('Merkle root', s.block.merkle_root, true)
    kv('Block hash', s.block.block_hash, true)
    kv('Verified', s.verification ? (s.verification.valid ? 'Yes: all leaves, root, block hash and chain link match' : 'NO: record altered') : 'not checked')
  }

  gap(18)
  text('Detection is a live TLS handshake. The remediation shown is a simulation; no changes were made to the server. Ledger hashes are real SHA-256 and stored in the issuing browser.', 8, { color: [140, 140, 150] })

  const pages = doc.getNumberOfPages()
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(150, 150, 160)
    doc.text(`${r.domain} · CBOM report · page ${i} of ${pages}`, M, H - 24)
  }
  saveBlob(`${r.domain}.cbom-report.pdf`, doc.output('blob'))
}
