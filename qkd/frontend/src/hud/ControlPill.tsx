import { useState } from 'react'
import { motion } from 'framer-motion'
import { Eye, Loader2, RotateCcw, Send, ShieldCheck, SlidersHorizontal } from 'lucide-react'
import { IconButton, Segmented } from './ui'

export type Mode = 'clean' | 'attack'

export interface Controls {
  nQubits: number
  interceptRate: number
  noise: number
}

export function ControlPill({ mode, onMode, controls, setControls, loading, onTransmit, onReseed }: {
  mode: Mode
  onMode: (m: Mode) => void
  controls: Controls
  setControls: (c: Controls) => void
  loading: boolean
  onTransmit: () => void
  onReseed: () => void
}) {
  const [open, setOpen] = useState(false)
  const slider = (label: string, key: keyof Controls, min: number, max: number, step: number, fmt: (v: number) => string) => (
    <label className="block">
      <div className="flex items-baseline justify-between text-xs">
        <span className="text-zinc-400">{label}</span>
        <span className="font-mono text-zinc-100 tabular-nums">{fmt(controls[key])}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={controls[key]}
        onChange={(e) => setControls({ ...controls, [key]: Number(e.target.value) })}
      />
    </label>
  )

  return (
    <div className="pointer-events-auto flex flex-col items-center gap-2">
      <div className="hud flex items-center gap-1 rounded-full p-1">
        <Segmented<Mode>
          id="mode"
          value={mode}
          onChange={onMode}
          disabled={loading}
          options={[
            { value: 'clean', label: <><ShieldCheck size={13} /> Clean channel</> },
            { value: 'attack', label: <><Eye size={13} /> Eve intercept</>, tone: 'danger' },
          ]}
        />
        <span className="mx-1 h-5 w-px bg-white/10" />
        <IconButton label="New photons" onClick={onReseed} disabled={loading}>
          {loading ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
        </IconButton>
        <IconButton label="Channel settings" onClick={() => setOpen(!open)} active={open}>
          <SlidersHorizontal size={14} />
        </IconButton>
      </div>

      {open && (
        <motion.div
          initial={{ opacity: 0, y: -8, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ type: 'spring', stiffness: 420, damping: 32 }}
          className="hud w-72 space-y-3 rounded-2xl p-4"
        >
          {slider('Photons', 'nQubits', 64, 2048, 64, (v) => `${v}`)}
          {slider('Eve intercept rate', 'interceptRate', 0.05, 1, 0.05, (v) => `${Math.round(v * 100)}%`)}
          {slider('Channel noise', 'noise', 0, 0.1, 0.005, (v) => `${(v * 100).toFixed(1)}%`)}
          <button
            onClick={() => {
              onTransmit()
              setOpen(false)
            }}
            disabled={loading}
            className="flex w-full items-center justify-center gap-2 rounded-full bg-zinc-100 py-2 text-xs font-medium text-zinc-900 transition hover:bg-white disabled:opacity-50"
          >
            <Send size={13} /> Transmit
          </button>
        </motion.div>
      )}
    </div>
  )
}
