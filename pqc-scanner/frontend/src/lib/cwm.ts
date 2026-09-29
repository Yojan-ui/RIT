// Context-Weighted Mosca (CWM): the same model as QuantumLedger's backend (quantum-ledger-desktop/app/cwm.py).
//
//   Risk = ((X_ML + Y) / Z) × Exposure × Fragility × 100, capped at 100
//
// X_ML is designed to come from a regression model (XGBoost / scikit-learn) trained on
// network-topology data such as Rapid7 Sonar. predictMigrationTime is a deterministic
// stand-in with the same inputs and output.

export type Severity = 'Low' | 'High' | 'CRITICAL'

export const CWM_CONFIG = {
  exposure: { internet: 1.2, internal: 0.8 } as Record<string, number>,
  fragility: { 'RSA-2048': 1.0, 'ECDSA-P256': 1.0, 'ML-DSA-65': 0.1 } as Record<string, number>,
  defaultFragility: 1.0,
  thresholds: [40, 70] as const,
  max: 100,
}

export const ASSET_TYPES = [
  { id: 'web-server', label: 'Web server' },
  { id: 'payment-gateway', label: 'Payment gateway' },
  { id: 'identity-provider', label: 'Identity provider (SSO)' },
  { id: 'code-signing', label: 'Code signing' },
  { id: 'api-service', label: 'API service' },
  { id: 'bastion', label: 'Bastion host' },
] as const
export type AssetType = (typeof ASSET_TYPES)[number]['id']

const BASE_YEARS: Record<string, number> = {
  'payment-gateway': 4.5,
  'code-signing': 5.0,
  'identity-provider': 3.0,
  'api-service': 1.5,
  bastion: 0.4,
  'web-server': 2.5,
}
const ZONE_FACTOR: Record<string, number> = { internet: 1.0, internal: 1.25 }
export const MODEL_ID = 'cwm-migration-heuristic-v1 (stand-in for XGBoost trained on Rapid7 Sonar)'

export function predictMigrationTime(assetType: string, zone: string) {
  const base = BASE_YEARS[assetType] ?? 2.5
  const factor = ZONE_FACTOR[zone] ?? 1.0
  return { years: Math.round(base * factor * 100) / 100, base, factor, model: MODEL_ID }
}

/** Map certificate key names from the scan ("ECDSA P-256", "RSA-2048") to the fragility table's keys. */
export function fragilityKey(keyName: string): string {
  const k = keyName.replace(/\s+/g, '-').replace('ECDSA-P-', 'ECDSA-P')
  return k
}

export function fragilityFor(keyName: string, family?: string): number {
  const exact = CWM_CONFIG.fragility[fragilityKey(keyName)]
  if (exact !== undefined) return exact
  if (family === 'ML-DSA' || family === 'SLH-DSA' || keyName.startsWith('ML-DSA')) return 0.1
  return CWM_CONFIG.defaultFragility
}

export function severityFor(score: number): Severity {
  const [lo, hi] = CWM_CONFIG.thresholds
  return score < lo ? 'Low' : score < hi ? 'High' : 'CRITICAL'
}

export interface CwmScore {
  score: number
  raw: number
  capped: boolean
  severity: Severity
  xml: number
  y: number
  z: number
  exposure: number
  fragility: number
  ratio: number
  zone: string
  assetType: string
  signature: string
  prediction: ReturnType<typeof predictMigrationTime>
}

export function cwmScore(o: { assetType: string; zone: string; signature: string; family?: string; y: number; z: number }): CwmScore {
  const prediction = predictMigrationTime(o.assetType, o.zone)
  const exposure = CWM_CONFIG.exposure[o.zone] ?? 1.0
  const fragility = fragilityFor(o.signature, o.family)
  const ratio = (prediction.years + o.y) / o.z
  const raw = ratio * exposure * fragility * 100
  const score = Math.round(Math.min(CWM_CONFIG.max, raw) * 10) / 10
  return {
    score,
    raw: Math.round(raw * 10) / 10,
    capped: raw > CWM_CONFIG.max,
    severity: severityFor(score),
    xml: prediction.years,
    y: o.y,
    z: o.z,
    exposure,
    fragility,
    ratio: Math.round(ratio * 1000) / 1000,
    zone: o.zone,
    assetType: o.assetType,
    signature: o.signature,
    prediction,
  }
}

const f1 = (n: number) => (Number.isInteger(n) ? n.toFixed(1) : String(n))

export function formulaLine(s: CwmScore) {
  const tail = s.capped ? `${f1(s.raw)} → capped at ${f1(s.score)}` : f1(s.score)
  return `((X_ML [${f1(s.xml)}] + Y [${f1(s.y)}]) / Z [${f1(s.z)}]) × Exp [${f1(s.exposure)}] × Fragility [${f1(s.fragility)}] × 100 = ${tail}`
}
