import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import type { Qubit } from '../api'
import { BlochSphere } from '../scene/BlochSphere'
import {
  AMBER,
  BASIS_COLOR,
  RED,
  VERDICT_COLOR,
  VERDICT_TEXT,
  basisGlyph,
  blochOf,
  incoming,
  stateLabel,
  verdict,
} from '../lib/quantum'
import { Row, Segmented } from './ui'

type Stage = 'alice' | 'eve' | 'bob'

export function BlochDrawer({ qubit, total, onClose, onNavigate }: {
  qubit: Qubit
  total: number
  onClose: () => void
  onNavigate: (i: number) => void
}) {
  const [stage, setStage] = useState<Stage>('alice')
  const hasEve = qubit.intercepted && qubit.eve_basis !== null && qubit.eve_bit !== null
  const active: Stage = stage === 'eve' && !hasEve ? 'alice' : stage

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === '[' && qubit.index > 0) onNavigate(qubit.index - 1)
      if (e.key === ']' && qubit.index < total - 1) onNavigate(qubit.index + 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, onNavigate, qubit.index, total])

  const states = {
    alice: { bit: qubit.alice_bit, basis: qubit.alice_basis },
    eve: hasEve ? { bit: qubit.eve_bit!, basis: qubit.eve_basis! } : null,
    bob: { bit: qubit.bob_bit, basis: qubit.bob_basis },
  }
  const shown = states[active] ?? states.alice
  const color = active === 'eve' ? (qubit.state_disturbed ? RED : AMBER) : BASIS_COLOR[shown.basis]
  const inc = incoming(qubit)
  const sameBasis = inc.basis === qubit.bob_basis
  const p0 = sameBasis ? (inc.bit === 0 ? 1 : 0) : 0.5
  const v = verdict(qubit)

  const caption: Record<Stage, string> = {
    alice: `Alice prepares ${stateLabel(qubit.alice_bit, qubit.alice_basis)}: bit ${qubit.alice_bit} encoded in the ${qubit.alice_basis === '+' ? 'rectilinear (+)' : 'diagonal (×)'} basis.`,
    eve: hasEve
      ? qubit.state_disturbed
        ? `Eve measured in the wrong basis. The state collapsed to ${stateLabel(qubit.eve_bit!, qubit.eve_basis!)} and that is what she re-sent. Alice's state is gone.`
        : `Eve measured in the right basis and re-sent an identical ${stateLabel(qubit.eve_bit!, qubit.eve_basis!)}. This photon carries no trace of her.`
      : 'Not intercepted.',
    bob: sameBasis
      ? `Bob measured in the same basis as the incoming state, so the outcome was certain: bit ${qubit.bob_bit}.`
      : `Bob measured in a different basis from the incoming state, so the outcome was a coin flip. He got bit ${qubit.bob_bit}.`,
  }

  return (
    <motion.aside
      initial={{ x: 40, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 360, damping: 34 }}
      className="hud pointer-events-auto fixed inset-x-3 bottom-3 z-50 flex max-h-[82vh] flex-col overflow-hidden rounded-3xl sm:inset-x-auto sm:top-20 sm:right-4 sm:bottom-auto sm:w-[360px]"
      role="dialog"
      aria-label={`Bloch sphere for photon ${qubit.index}`}
    >
      <header className="flex items-center gap-2 border-b border-white/[0.06] px-4 py-3">
        <div>
          <div className="eyebrow">Bloch sphere</div>
          <div className="text-sm font-medium text-zinc-50">Photon #{qubit.index}</div>
        </div>
        <div className="ml-auto flex items-center gap-0.5">
          <button
            aria-label="Previous photon"
            disabled={qubit.index === 0}
            onClick={() => onNavigate(qubit.index - 1)}
            className="grid size-8 place-items-center rounded-full text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-100 disabled:opacity-30"
          >
            <ChevronLeft size={16} />
          </button>
          <button
            aria-label="Next photon"
            disabled={qubit.index >= total - 1}
            onClick={() => onNavigate(qubit.index + 1)}
            className="grid size-8 place-items-center rounded-full text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-100 disabled:opacity-30"
          >
            <ChevronRight size={16} />
          </button>
          <button aria-label="Close" onClick={onClose} className="grid size-8 place-items-center rounded-full text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-100">
            <X size={16} />
          </button>
        </div>
      </header>

      <div className="overflow-y-auto">
        <div className="relative h-60 sm:h-64">
          <BlochSphere vector={blochOf(shown.bit, shown.basis)} color={color} />
          <div className="pointer-events-none absolute top-3 left-4 font-mono text-2xl" style={{ color }}>
            {stateLabel(shown.bit, shown.basis)}
          </div>
        </div>

        <div className="px-4">
          <Segmented<Stage>
            id="stage"
            value={active}
            onChange={setStage}
            options={[
              { value: 'alice', label: 'Alice sent' },
              ...(hasEve ? [{ value: 'eve' as Stage, label: 'Eve re-sent', tone: 'danger' as const }] : []),
              { value: 'bob', label: 'Bob measured' },
            ]}
          />
          <p className="mt-3 text-xs leading-relaxed text-zinc-400">{caption[active]}</p>

          <div className="mt-4">
            <div className="eyebrow">
              Bob's measurement · {basisGlyph(qubit.bob_basis)} basis
            </div>
            {[0, 1].map((bit) => {
              const p = bit === 0 ? p0 : 1 - p0
              return (
                <div key={bit} className="mt-2 flex items-center gap-3 text-xs">
                  <span className="w-8 font-mono text-zinc-400">{stateLabel(bit, qubit.bob_basis)}</span>
                  <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/10">
                    <motion.div
                      className="h-full rounded-full"
                      style={{ background: BASIS_COLOR[qubit.bob_basis] }}
                      initial={{ width: 0 }}
                      animate={{ width: `${p * 100}%` }}
                      transition={{ type: 'spring', stiffness: 200, damping: 26 }}
                    />
                  </div>
                  <span className="w-10 text-right font-mono text-zinc-300 tabular-nums">{Math.round(p * 100)}%</span>
                  <span className={`w-3 text-center ${qubit.bob_bit === bit ? 'text-zinc-50' : 'text-transparent'}`}>●</span>
                </div>
              )
            })}
          </div>

          <dl className="mt-4 divide-y divide-white/[0.06]">
            <Row label="Alice">
              <span style={{ color: BASIS_COLOR[qubit.alice_basis] }}>{basisGlyph(qubit.alice_basis)}</span> · bit {qubit.alice_bit}
            </Row>
            <Row label="Eve">
              {hasEve ? (
                <span style={{ color: qubit.state_disturbed ? RED : AMBER }}>
                  {basisGlyph(qubit.eve_basis)} · bit {qubit.eve_bit} · {qubit.state_disturbed ? 'collapsed' : 'copied'}
                </span>
              ) : (
                <span className="text-zinc-500">not intercepted</span>
              )}
            </Row>
            <Row label="Bob">
              <span style={{ color: BASIS_COLOR[qubit.bob_basis] }}>{basisGlyph(qubit.bob_basis)}</span> · bit {qubit.bob_bit}
            </Row>
          </dl>
          <div
            className="mt-3 mb-4 flex items-center gap-2 rounded-xl px-3 py-2 text-xs"
            style={{ background: `${VERDICT_COLOR[v]}1a`, color: VERDICT_COLOR[v] }}
          >
            <span className="size-1.5 rounded-full" style={{ background: VERDICT_COLOR[v] }} />
            {VERDICT_TEXT[v]}
          </div>
        </div>
      </div>
    </motion.aside>
  )
}
