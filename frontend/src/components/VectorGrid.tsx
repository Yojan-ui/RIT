import { useEffect, useState } from 'react'
import { VECTOR_ORDER } from '@/lib/meta'
import type { ScanReport, VectorId } from '@/lib/types'
import { VectorCard } from './VectorCard'

export function VectorGrid({ report, focus }: { report: ScanReport; focus?: { id: VectorId; n: number } }) {
  const checks = [...report.checks].sort((a, b) => VECTOR_ORDER.indexOf(a.id) - VECTOR_ORDER.indexOf(b.id))
  // Failures start expanded so the raw evidence is one glance away.
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(checks.filter((c) => c.status === 'fail').map((c) => c.id)),
  )
  const allOpen = expanded.size === checks.length

  // Clicking a node in the Defense Lattice expands and scrolls to its card.
  useEffect(() => {
    if (!focus) return
    setExpanded((prev) => new Set(prev).add(focus.id))
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    requestAnimationFrame(() =>
      document.getElementById(`vector-${focus.id}`)?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' }),
    )
  }, [focus])

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <section aria-labelledby="vectors-heading">
      <div className="mb-2 flex items-center justify-between">
        <h2 id="vectors-heading" className="eyebrow">
          Vectors · {checks.length}
        </h2>
        <button
          type="button"
          onClick={() => setExpanded(allOpen ? new Set() : new Set(checks.map((c) => c.id)))}
          className="font-mono text-[10px] tracking-wider text-slate-500 hover:text-slate-200"
        >
          {allOpen ? 'COLLAPSE ALL' : 'EXPAND ALL'}
        </button>
      </div>
      <div className="grid items-start gap-3 lg:grid-cols-2">
        {checks.map((c) => (
          <VectorCard key={c.id} check={c} expanded={expanded.has(c.id)} onToggle={() => toggle(c.id)} />
        ))}
      </div>
    </section>
  )
}
