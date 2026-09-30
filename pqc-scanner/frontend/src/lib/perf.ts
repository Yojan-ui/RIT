// Handshake cost of the legacy configuration vs the post-quantum patch, from the host
// benchmark (`/api/bench`, measured with OpenSSL) and the probe's own wire measurements.
import type { Bench, KexBench, ScanResult, SigBench } from '../api'

export interface PerfSide {
  label: string
  kex: string
  sig: string
  wireBytes: number // key shares + leaf public key + 2 signatures (certificate + CertificateVerify)
  serverUs: number // server CPU per handshake: key agreement + one signature
  clientUs: number // client CPU per handshake: key agreement + two verifications
  perCore: number // full handshakes per second per server core
}

export interface Perf {
  legacy: PerfSide
  pqc: PerfSide
  deltaBytes: number
  deltaMs: number // added CPU on the critical path (server + client)
  rttMs: number | null // measured ClientHello → ServerHello round trip
  clientHelloBytes: number | null
  pctOfRtt: number | null
  /** Estimated server flight (ServerHello … Finished); null without wire data. */
  serverFlight: { legacy: number; pqc: number } | null
  /** Whether the PQC server flight exceeds TCP's initial window (10 × 1460 B), which can cost one extra round trip. */
  extraRtt: boolean | null
  source: string
}

export const INITCWND_BYTES = 10 * 1460

export const LEGACY_SIGS = ['RSA-2048', 'RSA-3072', 'RSA-4096', 'ECDSA P-256', 'ECDSA P-384']

function side(label: string, kexName: string, kex: KexBench, sigName: string, sig: SigBench): PerfSide {
  const serverUs = kex.server_us + sig.sign_us
  return {
    label,
    kex: kexName,
    sig: sigName,
    wireBytes: kex.client_share_bytes + kex.server_share_bytes + sig.public_key_bytes + 2 * sig.signature_bytes,
    serverUs,
    clientUs: kex.client_us + 2 * sig.verify_us,
    perCore: Math.round(1e6 / serverUs),
  }
}

/** `legacySig` overrides the site's own certificate key (e.g. to compare against RSA-2048). */
export function computePerf(r: ScanResult, b: Bench, legacySig?: string): Perf {
  const group = r.tls.key_exchange.group ?? ''
  const kexName = group === 'secp256r1' ? 'secp256r1' : 'x25519' // hybrid sites still fall back to classical X25519 here
  const siteSig = r.certificate.public_key.name
  const sigName = legacySig ?? (LEGACY_SIGS.includes(siteSig) ? siteSig : 'RSA-2048')
  const legacy = side('legacy', kexName, b.kex[kexName], sigName, b.sig[sigName])
  const pqc = side('post-quantum', 'X25519MLKEM768', b.kex.X25519MLKEM768, 'ML-DSA-65', b.sig['ML-DSA-65'])
  const deltaMs = (pqc.serverUs + pqc.clientUs - legacy.serverUs - legacy.clientUs) / 1000
  const rtt = r.wire?.hello_rtt_ms ?? null
  // legacy flight ≈ measured certificate chain + server key share + CertificateVerify + ~250 B of framing,
  // EncryptedExtensions and Finished; the patch grows the share, the leaf key and both signatures
  const lk = b.kex[kexName]
  const ls = b.sig[sigName]
  const qk = b.kex.X25519MLKEM768
  const qs = b.sig['ML-DSA-65']
  const chain = r.wire?.cert_chain_bytes ?? null
  const flightLegacy = chain != null ? chain + lk.server_share_bytes + ls.signature_bytes + 250 : null
  const serverFlight =
    flightLegacy != null
      ? { legacy: flightLegacy, pqc: flightLegacy + (qk.server_share_bytes - lk.server_share_bytes) + (qs.public_key_bytes - ls.public_key_bytes) + 2 * (qs.signature_bytes - ls.signature_bytes) }
      : null
  return {
    legacy,
    pqc,
    deltaBytes: pqc.wireBytes - legacy.wireBytes,
    deltaMs,
    rttMs: rtt,
    clientHelloBytes: r.wire?.client_hello_bytes ?? null,
    pctOfRtt: rtt ? (deltaMs / rtt) * 100 : null,
    serverFlight,
    extraRtt: serverFlight ? serverFlight.pqc > INITCWND_BYTES : null,
    source: `${b.library} · ${b.host}`,
  }
}

export const fmtBytes = (n: number) => (n >= 1024 ? `${(n / 1024).toFixed(1)} KB` : `${Math.round(n)} B`)
export const fmtUs = (us: number) => (us >= 1000 ? `${(us / 1000).toFixed(2)} ms` : `${Math.round(us)} µs`)
