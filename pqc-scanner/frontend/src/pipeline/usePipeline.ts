// The five-stage pipeline (Detect, Score, Defend, Prove, Rescan) as one hook, so every UI
// variant (the default dashboard and the Stark HUD) runs exactly the same logic.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { scanDomain, type ScanResult } from '../api'
import type { CoreState } from '../scene/CryptoCore'
import type { Algo } from '../components/pipeline'
import { cryptoFromScan, mosca, MIGRATED, Z_YEARS } from '../lib/mosca'
import { anchor, verify, type LedgerBlock, type Verification } from '../lib/ledger'
import { actionPlan, diagnose } from '../lib/diagnosis'
import { exportPdfReport } from '../lib/report'
import { downloadCbom } from '../lib/cyclonedx'
import { cwmScore, type AssetType } from '../lib/cwm'
import { demoScan } from '../lib/demo'

export const SCAN_STEPS = ['Resolving and vetting the address', 'TLS handshake offering X25519MLKEM768', 'Reading the certificate chain', 'Building the CBOM']
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export function usePipeline() {
  const [query, setQuery] = useState(() => new URLSearchParams(location.search).get('domain') ?? '')
  const [result, setResult] = useState<ScanResult | null>(null)
  const [demo, setDemo] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [scanning, setScanning] = useState(false)
  const [scanStep, setScanStep] = useState(0)

  const [step, setStep] = useState(1)
  const [reached, setReached] = useState(1)
  const [assetType, setAssetType] = useState<AssetType>('web-server')
  const [y, setY] = useState(10)
  const [patching, setPatching] = useState(false)
  const [patched, setPatched] = useState(false)
  const [block, setBlock] = useState<LedgerBlock | null>(null)
  const [verification, setVerification] = useState<Verification | null>(null)
  const [anchoring, setAnchoring] = useState(false)
  const [typed, setTyped] = useState(false)
  const [tampered, setTampered] = useState(false)
  const [rescan, setRescan] = useState<'idle' | 'running' | 'done'>('idle')
  const [rescanStep, setRescanStep] = useState(0)
  const [shock, setShock] = useState(0)
  const abort = useRef<AbortController | null>(null)

  const before = useMemo(() => (result ? cryptoFromScan(result) : null), [result])
  // CWM: X_ML is predicted from the asset profile; a public domain is internet-facing.
  const cwmBefore = useMemo(
    () => (before && result ? cwmScore({ assetType, zone: 'internet', signature: before.leafKey, family: result.certificate.public_key.family, y, z: Z_YEARS }) : null),
    [before, result, assetType, y],
  )
  const cwmAfter = useMemo(() => (before ? cwmScore({ assetType, zone: 'internet', signature: 'ML-DSA-65', family: 'ML-DSA', y, z: Z_YEARS }) : null), [before, assetType, y])
  const m = useMemo(() => (before && cwmBefore ? mosca(cwmBefore.xml, y, before) : null), [before, cwmBefore, y])
  const diag = result && before ? diagnose(result, before, false) : null

  const resetPipeline = () => {
    setStep(1)
    setReached(1)
    setPatching(false)
    setPatched(false)
    setBlock(null)
    setVerification(null)
    setAnchoring(false)
    setTyped(false)
    setTampered(false)
    setRescan('idle')
    setRescanStep(0)
  }

  const scan = useCallback(async (raw: string) => {
    const domain = raw.trim()
    if (!domain) return
    abort.current?.abort()
    const ctrl = new AbortController()
    abort.current = ctrl
    resetPipeline()
    setResult(null)
    setError(null)
    setDemo(false)
    setScanning(true)
    setScanStep(0)
    const url = new URL(location.href)
    url.searchParams.set('domain', domain)
    history.replaceState(null, '', url)
    try {
      const [res] = await Promise.all([scanDomain(domain, ctrl.signal), sleep(1600)])
      if (ctrl.signal.aborted) return
      setResult(res)
    } catch (e) {
      if (ctrl.signal.aborted || (e as Error).name === 'AbortError') return
      const msg = (e as Error).message
      if (msg.startsWith('Scanner API unreachable')) {
        setResult(demoScan(domain)) // keep the demo alive without the backend
        setDemo(true)
      } else {
        setError(msg)
      }
    } finally {
      if (!ctrl.signal.aborted) setScanning(false)
    }
  }, [])

  useEffect(() => {
    if (!scanning) return
    const id = setInterval(() => setScanStep((s) => Math.min(SCAN_STEPS.length - 1, s + 1)), 380)
    return () => clearInterval(id)
  }, [scanning])

  const booted = useRef(false)
  useEffect(() => {
    if (booted.current) return
    booted.current = true
    if (query) scan(query)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const goto = (n: number) => {
    setReached((r) => Math.max(r, n))
    setStep(n)
  }

  const applyPatch = async () => {
    setPatching(true)
    await sleep(1800)
    setPatching(false)
    setPatched(true)
    setShock((s) => s + 1)
  }

  const anchorProof = async () => {
    if (!result || !before || !m) return
    setAnchoring(true)
    const b = await anchor(result.domain, [
      {
        label: 'Detect',
        data: {
          domain: result.domain,
          scanned_at: result.scanned_at,
          demo,
          tls: { version: result.tls.version, cipher: result.tls.cipher_suite, group: result.tls.key_exchange.group },
          certificate: { cn: result.certificate.subject_cn, public_key: result.certificate.public_key.name, signature: result.certificate.signature.name, not_after: result.certificate.not_after },
          cbom: result.cbom_summary.map((r) => ({ name: r.name, quantum_safe: r.quantum_safe })),
        },
      },
      {
        label: 'Score',
        data: {
          method: 'Context-Weighted Mosca: ((X_ML + Y) / Z) x Exp x Fragility x 100',
          asset_type: assetType,
          x_ml: cwmBefore?.xml, y: m.y, z: m.z, exposure: cwmBefore?.exposure, fragility: cwmBefore?.fragility,
          cwm_score: cwmBefore?.score, severity: cwmBefore?.severity, mosca_verdict: m.verdict,
        },
      },
      { label: 'Defend', data: { simulated: true, before, after: { ...MIGRATED, kex_standard: 'ML-KEM-768 (X25519MLKEM768)' } } },
    ])
    setBlock(b)
    setVerification(await verify(b))
    setAnchoring(false)
  }

  const runRescan = async () => {
    setRescan('running')
    for (let i = 1; i <= 3; i++) {
      await sleep(700)
      setRescanStep(i)
    }
    await sleep(400)
    setRescan('done')
    setShock((s) => s + 1)
  }

  const toggleTamper = async () => {
    if (!block) return
    if (tampered) {
      setVerification(await verify(block))
      setTampered(false)
      return
    }
    const forged: LedgerBlock = structuredClone(block)
    ;(forged.records[2].data as { after: { signature: string } }).after.signature = 'RSA-2048'
    setVerification(await verify(forged))
    setTampered(true)
  }

  const reset = () => {
    abort.current?.abort()
    resetPipeline()
    setResult(null)
    setScanning(false)
    setError(null)
    setQuery('')
    history.replaceState(null, '', location.pathname)
  }

  const exportPdf = () => result && before && exportPdfReport(result, { fixed: patched, plan: actionPlan(result, before), block, verification })
  const exportJson = () => result && downloadCbom({ result, patched, cwmBefore, cwmAfter, block, verification, demo })

  // Chips: detected vs patched
  const detected: Algo[] = before
    ? [
        { role: 'Signature', name: before.leafKey, safe: before.leafPq, note: before.leafPq ? 'Post-quantum signature' : 'Certificate key · signs every handshake' },
        { role: 'Key exchange', name: before.kex, safe: before.kexPq, note: before.kexPq ? 'Hybrid ML-KEM already negotiated' : 'Protects session keys' },
      ]
    : []
  const upgraded: Algo[] = [
    { role: 'Signature', name: 'ML-DSA-65', safe: true, note: 'FIPS 204 · NIST category 3' },
    { role: 'Key exchange', name: 'X25519MLKEM768', safe: true, note: 'FIPS 203 · ML-KEM-768 hybrid with X25519' },
  ]
  const vulnerable = detected.filter((a) => !a.safe).length
  const otherFailing = result ? result.cbom_summary.filter((a) => !a.quantum_safe && a.name !== before?.leafKey && a.name !== before?.kex) : []

  const core: CoreState = scanning || rescan === 'running'
    ? 'scanning'
    : !result
      ? 'idle'
      : patching
        ? 'upgrading'
        : patched
          ? 'secured'
          : step >= 2 && cwmBefore
            ? cwmBefore.severity === 'CRITICAL' ? 'critical' : cwmBefore.severity === 'Low' ? 'secured' : 'vulnerable'
            : diag?.tone === 'safe' ? 'secured' : diag?.tone === 'risk' ? 'critical' : 'vulnerable'

  const complete = rescan === 'done'

  return {
    query,
    setQuery,
    result,
    demo,
    error,
    scanning,
    scanStep,
    step,
    setStep,
    reached,
    assetType,
    setAssetType,
    y,
    setY,
    patching,
    patched,
    block,
    verification,
    anchoring,
    typed,
    setTyped,
    tampered,
    rescan,
    rescanStep,
    shock,
    before,
    cwmBefore,
    cwmAfter,
    m,
    diag,
    scan,
    goto,
    applyPatch,
    anchorProof,
    runRescan,
    toggleTamper,
    reset,
    exportPdf,
    exportJson,
    detected,
    upgraded,
    vulnerable,
    otherFailing,
    core,
    complete,
  }
}

export type Pipeline = ReturnType<typeof usePipeline>
