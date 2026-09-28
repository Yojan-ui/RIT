import { useState, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { ChevronDown } from 'lucide-react'

/** Collapsible frosted card. Collapsed, it shrinks to a pill showing `summary`. */
export function Card({ title, icon, summary, defaultOpen = true, danger, className = '', children }: {
  title: string
  icon: ReactNode
  summary?: ReactNode
  defaultOpen?: boolean
  danger?: boolean
  className?: string
  children: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <motion.section
      layout
      transition={{ type: 'spring', stiffness: 380, damping: 34 }}
      className={`hud pointer-events-auto overflow-hidden rounded-2xl transition-[box-shadow,border-color] duration-500 ${
        danger ? 'border-q-red/35! shadow-[0_0_40px_-12px_rgb(255_77_106/0.5)]!' : ''
      } ${className}`}
    >
      <motion.button
        layout="position"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 px-4 py-3 text-left"
      >
        <span className={danger ? 'text-q-red' : 'text-zinc-400'}>{icon}</span>
        <span className="text-[13px] font-medium tracking-tight text-zinc-100">{title}</span>
        <span className="ml-auto flex items-center gap-2 text-xs text-zinc-400">
          {!open && summary}
          <ChevronDown size={14} className={`transition-transform duration-300 ${open ? 'rotate-180' : ''}`} />
        </span>
      </motion.button>
      {open && (
        <motion.div
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
          className="border-t border-white/[0.06] px-4 pt-3 pb-4"
        >
          {children}
        </motion.div>
      )}
    </motion.section>
  )
}

export function Segmented<T extends string>({ value, options, onChange, id, disabled }: {
  value: T
  options: { value: T; label: ReactNode; tone?: 'danger' }[]
  onChange: (v: T) => void
  id: string
  disabled?: boolean
}) {
  return (
    <div className="relative flex rounded-full bg-white/[0.04] p-0.5" role="radiogroup">
      {options.map((o) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => onChange(o.value)}
            className={`relative z-10 flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors disabled:cursor-wait ${
              active ? (o.tone === 'danger' ? 'text-q-red' : 'text-zinc-50') : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            {active && (
              <motion.span
                layoutId={`seg-${id}`}
                className={`absolute inset-0 -z-10 rounded-full ${
                  o.tone === 'danger' ? 'bg-q-red/15 ring-1 ring-q-red/30' : 'bg-white/10 ring-1 ring-white/10'
                }`}
                transition={{ type: 'spring', stiffness: 500, damping: 38 }}
              />
            )}
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

export function IconButton({ label, onClick, children, active, disabled, className = '' }: {
  label: string
  onClick: () => void
  children: ReactNode
  active?: boolean
  disabled?: boolean
  className?: string
}) {
  return (
    <button
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={`grid size-8 shrink-0 place-items-center rounded-full transition-colors disabled:opacity-40 ${
        active ? 'bg-white/10 text-zinc-50' : 'text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-100'
      } ${className}`}
    >
      {children}
    </button>
  )
}

export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <dt className="text-xs text-zinc-400">{label}</dt>
      <dd className="text-right font-mono text-xs text-zinc-100 tabular-nums">{children}</dd>
    </div>
  )
}
