import { forwardRef } from 'react'
import { motion } from 'framer-motion'

export type Status = 'safe' | 'danger' | 'offline'

const COPY: Record<Status, { icon: string; title: string; tag: string; sub: string }> = {
  safe: {
    icon: '🔒',
    title: 'SECURE CONNECTION',
    tag: 'Key Generated Safely',
    sub: 'No intruder detected. Ready for encryption.',
  },
  danger: {
    icon: '🚨',
    title: 'INTRUDER DETECTED!',
    tag: 'Transmission Aborted',
    sub: 'Eavesdropper tried to read the photons. Quantum states collapsed!',
  },
  offline: {
    icon: '🔌',
    title: 'SIMULATOR OFFLINE',
    tag: 'Backend not reachable',
    sub: 'Start it with: cd qkd && .venv/bin/uvicorn app.main:app --port 8100',
  },
}

/** The one status everyone reads first. */
export const Banner = forwardRef<HTMLDivElement, { status: Status }>(function Banner({ status }, ref) {
  const c = COPY[status]
  const tone =
    status === 'safe'
      ? 'border-emerald-400/50 bg-emerald-500/[0.12] text-emerald-300 shadow-[0_0_60px_-10px_rgb(52_211_153/0.55)]'
      : status === 'danger'
        ? 'banner-alarm border-red-500/70 bg-red-600/20 text-red-300'
        : 'border-zinc-600/50 bg-zinc-800/40 text-zinc-300'
  return (
    <div ref={ref} className="pointer-events-auto mx-auto w-full max-w-[880px]">
      <motion.div
        key={status}
        initial={{ scale: 0.94, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 320, damping: 22 }}
        role="status"
        aria-live="assertive"
        className={`rounded-3xl border-2 px-5 py-3.5 text-center backdrop-blur-xl sm:px-8 sm:py-4 ${tone}`}
      >
        <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
          <span className="text-3xl sm:text-4xl" aria-hidden>
            {c.icon}
          </span>
          <h1 className="text-2xl font-black tracking-tight text-white sm:text-4xl">{c.title}</h1>
          <span className="hidden text-2xl font-light opacity-50 sm:inline sm:text-4xl">//</span>
          <span className="text-lg font-bold sm:text-3xl">{c.tag}</span>
        </div>
        <p className="mt-1.5 text-sm font-medium text-white/75 sm:text-lg">{c.sub}</p>
      </motion.div>
    </div>
  )
})
