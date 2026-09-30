// "Project to AR": on an AR-capable phone the button starts an immersive-ar session directly; on a
// desktop it shows a QR code of the demo's LAN HTTPS address (WebXR needs a secure context), so a
// judge can scan it and place the hologram on the table. The in-session overlay is the DOM Overlay root.
import { useEffect, useMemo, useRef, useState } from 'react'
import qrcode from 'qrcode-generator'
import { fetchXrHandoff } from '../api'
import { arSupported, endAR, startAR, useXR } from './xr'

const isLocal = (h: string) => h === 'localhost' || h === '127.0.0.1' || h === '[::1]'

/** QR code as crisp SVG modules (no innerHTML). */
function Qr({ text }: { text: string }) {
  const { n, d } = useMemo(() => {
    const q = qrcode(0, 'M')
    q.addData(text)
    q.make()
    const n = q.getModuleCount()
    let d = ''
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`
    return { n, d }
  }, [text])
  return (
    <svg viewBox={`-2 -2 ${n + 4} ${n + 4}`} className="ar-qr" role="img" aria-label={`QR code for ${text}`}>
      <rect x={-2} y={-2} width={n + 4} height={n + 4} fill="#fff" />
      <path d={d} fill="#080a0f" shapeRendering="crispEdges" />
    </svg>
  )
}

export function ArHandoff({ domain }: { domain: string }) {
  const xr = useXR()
  const [supported, setSupported] = useState(false)
  const [open, setOpen] = useState(false)
  const [lan, setLan] = useState<string | null | undefined>(undefined)
  const [err, setErr] = useState<string | null>(null)
  const overlay = useRef<HTMLDivElement>(null)
  const wantsAr = useMemo(() => new URLSearchParams(location.search).get('ar') === '1', [])

  useEffect(() => {
    arSupported().then(setSupported)
    // a tap on an overlay button must not also count as "place the hologram here"
    const el = overlay.current
    const guard = (e: Event) => {
      if ((e.target as Element | null)?.closest?.('button')) e.preventDefault()
    }
    el?.addEventListener('beforexrselect', guard)
    return () => el?.removeEventListener('beforexrselect', guard)
  }, [])
  useEffect(() => {
    if (!open || lan !== undefined) return
    // a page already opened over LAN HTTPS is its own handoff address
    if (location.protocol === 'https:' && !isLocal(location.hostname)) setLan(location.origin)
    else fetchXrHandoff().then(setLan, () => setLan(null))
  }, [open, lan])

  const enter = async () => {
    setErr(null)
    try {
      await startAR(overlay.current!)
      setOpen(false)
    } catch (e) {
      setErr((e as Error).message || 'AR session refused')
    }
  }

  const url = lan ? `${lan.replace(/\/$/, '')}/?${new URLSearchParams({ ...(domain ? { domain } : {}), ar: '1' })}` : null

  return (
    <>
      <button className="hud-btn quiet" onClick={() => (supported ? enter() : setOpen((o) => !o))} aria-expanded={supported ? undefined : open} title="Place the hologram on a real table (WebXR)">
        ◈<span className="hidden sm:inline"> project to</span> ar
      </button>

      {/* phone opened from the QR code: one large tap target (entering AR needs a user gesture) */}
      {wantsAr && supported && !xr.presenting && (
        <button className="ar-cta" onClick={enter}>
          <span className="hud-k">webxr · immersive-ar</span>
          <span className="hud-h">tap to project the hologram onto your table</span>
        </button>
      )}

      {open && !supported && (
        <div className="ar-pop" role="dialog" aria-label="Project to AR">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="hud-k">tabletop hologram · webxr</div>
              <div className="hud-h mt-0.5">scan with an android phone</div>
            </div>
            <button className="hud-btn quiet" onClick={() => setOpen(false)} aria-label="Close">✕</button>
          </div>
          {lan === undefined && <p className="hud-dim mt-3 text-[11px]">resolving lan address…</p>}
          {url && (
            <>
              <Qr text={url} />
              <p className="hud-ice mt-2 break-all text-[10.5px]">{url}</p>
              <ol className="mt-2 space-y-1 text-[10.5px] leading-[15px] text-[#9aa7b4]">
                <li>1 · same Wi-Fi as this laptop; Chrome on Android with ARCore</li>
                <li>2 · accept the self-signed certificate warning (advanced → proceed)</li>
                <li>3 · tap “project”, sweep the table, tap to place the globe, lattice shield and merkle ledger</li>
              </ol>
              <p className="hud-dim mt-2 text-[10px]">iOS Safari has no WebXR AR; use an Android device.</p>
            </>
          )}
          {lan === null && (
            <p className="mt-3 text-[11px] leading-[16px] text-[#9aa7b4]">
              LAN handoff is off, so this demo is only on localhost. Restart it with <span className="hud-ice">AR=1 ./run_cyber_demo.sh</span> to also serve it over HTTPS on your Wi-Fi, then scan the code shown here.
            </p>
          )}
        </div>
      )}
      {err && !xr.presenting && <p className="ar-err" role="alert" onClick={() => setErr(null)}>AR: {err}</p>}

      {/* DOM Overlay root: the only HTML shown over the camera feed during the session */}
      <div ref={overlay} className="ar-overlay" hidden={!xr.presenting}>
        <div className="ar-overlay-bar">
          <span className="hud-live" />
          <span className="hud-h text-[11px] tracking-[0.2em]">QUANTUMLEDGER · AR</span>
          <button className="hud-btn quiet ml-auto" onClick={endAR}>exit ar</button>
        </div>
        <p className="ar-overlay-hint">
          {!xr.placed ? (xr.hasHit ? 'surface found · tap to place the hologram' : 'move your phone slowly across the table…') : 'walk around it · tap another spot to move it'}
        </p>
      </div>
    </>
  )
}
