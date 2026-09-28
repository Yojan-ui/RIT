import { useEffect, useState } from 'react'
import { VECTOR_ORDER } from '@/lib/meta'
import type { ScanReport, VectorId } from '@/lib/types'
import { SectionHeader } from './primitives'
import { VectorCard } from './VectorCard'

export function VectorGrid({
  report,
  focus,
  onAim,
}: {
  report: ScanReport
  focus?: { id: VectorId; n: number }
  /** Point the 3D camera at a protection while it is hovered (null to release). */
  onAim?: (id: VectorId | null) => void
}) {
  const checks = [...report.checks].sort((a, b) => VECTOR_ORDER.indexOf(a.id) - VECTOR_ORDER.indexOf(b.id))
  // Everything starts collapsed: the first read is a plain-English verdict per
  // protocol, and the technical detail is opt-in.
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const allOpen = expanded.size === checks.length
  const holding = checks.filter((c) => c.status === 'pass').length

  // Clicking a node in the 3D view expands and scrolls to its row.
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
      <SectionHeader
        id="vectors-heading"
        title="Your seven protections"
        lede={`${holding} of ${checks.length} pass. Open any row for the technical detail.`}
      >
        <button
          type="button"
          onClick={() => setExpanded(allOpen ? new Set() : new Set(checks.map((c) => c.id)))}
          className="text-[12.5px] font-medium text-accent hover:underline"
        >
          {allOpen ? 'Collapse all' : 'Expand all'}
        </button>
      </SectionHeader>
      <ul className="card divide-y divide-line overflow-hidden">
        {checks.map((c) => (
          <VectorCard
            key={c.id}
            check={c}
            expanded={expanded.has(c.id)}
            onToggle={() => toggle(c.id)}
            onAim={onAim ? (on) => onAim(on ? c.id : null) : undefined}
          />
        ))}
      </ul>
    </section>
  )
}
