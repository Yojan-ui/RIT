import type { Health, SimResponse } from '../api'

export function TopBar({ result, health, offline }: { result: SimResponse | null; health: Health | null; offline: boolean }) {
  const detected = result?.metrics.eavesdropper_detected
  return (
    <header className="pointer-events-none flex items-start justify-between gap-3">
      <div className="pointer-events-auto flex items-center gap-3">
        <svg viewBox="0 0 32 32" className="size-8" aria-hidden>
          <circle cx="16" cy="16" r="12.5" fill="none" stroke="rgb(255 255 255 / 0.18)" />
          <path d="M6 16h20" stroke="#5ee7f7" strokeWidth="1.5" strokeLinecap="round" />
          <path d="M16 6.5v19" stroke="#b39dff" strokeWidth="1.5" strokeLinecap="round" transform="rotate(45 16 16)" />
          <circle cx="16" cy="16" r="2.2" fill="#fafafa" />
        </svg>
        <div className="leading-tight">
          <div className="text-[15px] font-semibold tracking-tight text-zinc-50">BB84</div>
          <div className="text-[11px] text-zinc-500">Quantum key distribution</div>
        </div>
      </div>

      <div className="pointer-events-auto flex items-center gap-2">
        <span className="hidden text-[11px] text-zinc-500 md:inline">
          {offline ? 'backend offline' : health ? `Qiskit ${health.qiskit} · Aer ${health.qiskit_aer}` : 'connecting…'}
        </span>
        <span
          className={`hud flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium ${
            offline ? 'text-zinc-400' : !result ? 'text-zinc-400' : detected ? 'pulse-red text-q-red' : 'text-zinc-100'
          }`}
        >
          <span className="relative flex size-2">
            {result && !offline && (
              <span className={`absolute inline-flex size-full animate-ping rounded-full opacity-60 ${detected ? 'bg-q-red' : 'bg-q-green'}`} />
            )}
            <span className={`relative inline-flex size-2 rounded-full ${offline ? 'bg-zinc-600' : !result ? 'bg-zinc-500' : detected ? 'bg-q-red' : 'bg-q-green'}`} />
          </span>
          {offline ? 'Offline' : !result ? 'Idle' : detected ? 'Eavesdropper detected' : 'Channel secure'}
        </span>
      </div>
    </header>
  )
}
