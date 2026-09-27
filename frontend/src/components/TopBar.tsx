import { Radar } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import type { Source } from '@/hooks/useReport'
import { cn } from '@/lib/utils'
import type { DemoScenario } from '@/lib/types'
import { Lamp } from './primitives'

export function TopBar({
  initialDomain = '',
  scenarios,
  source,
  loading,
  apiUp,
  onSelect,
}: {
  initialDomain?: string
  scenarios: DemoScenario[]
  source?: Source
  loading: boolean
  apiUp: boolean | null
  onSelect: (source: Source) => void
}) {
  const [domain, setDomain] = useState(initialDomain)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const value = domain.trim()
    if (value) onSelect({ kind: 'live', domain: value })
  }

  return (
    <header className="sticky top-0 z-10 border-b border-line bg-obsidian/95 backdrop-blur">
      <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3">
        <div className="flex items-center gap-2.5">
          <Radar className="size-4 text-ok" aria-hidden />
          <span className="font-mono text-[13px] font-bold tracking-[0.18em] text-slate-100">
            SECUREMAIL<span className="text-ok">//</span>SCOPE
          </span>
          <span
            className="ml-1 inline-flex items-center gap-1.5 font-mono text-[10px] tracking-wider text-slate-500"
            title={apiUp === false ? 'Backend unreachable' : 'Backend reachable'}
          >
            <Lamp className={apiUp === null ? 'bg-na' : apiUp ? 'bg-ok' : 'bg-crit'} />
            API
          </span>
        </div>

        <form onSubmit={submit} className="order-last flex w-full gap-2 md:order-none md:ml-auto md:w-auto">
          <label htmlFor="domain" className="sr-only">
            Domain to scan
          </label>
          <input
            id="domain"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            placeholder="scan a live domain…"
            autoComplete="off"
            spellCheck={false}
            className="h-8 min-w-0 flex-1 rounded-sm border border-line-strong bg-panel px-2.5 font-mono text-[12px] text-slate-100 placeholder:text-slate-600 focus:border-ok/60 focus:outline-none md:w-64"
          />
          <button
            type="submit"
            disabled={!domain.trim() || loading}
            className="h-8 rounded-sm bg-ok px-3 font-mono text-[11px] font-bold tracking-wider text-obsidian transition-colors duration-75 hover:bg-emerald-400 active:translate-y-px disabled:cursor-not-allowed disabled:bg-line-strong disabled:text-slate-500"
          >
            SCAN
          </button>
        </form>
      </div>

      {scenarios.length > 0 && (
        <nav aria-label="Demo scenarios" className="border-t border-line">
          <div className="mx-auto flex max-w-[1400px] items-center gap-1 overflow-x-auto px-4 py-1.5">
            <span className="eyebrow mr-2 shrink-0">Demo</span>
            {scenarios.map((s) => {
              const active = source?.kind === 'demo' && source.id === s.id
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => onSelect({ kind: 'demo', id: s.id })}
                  aria-pressed={active}
                  title={s.description}
                  className={cn(
                    'h-7 shrink-0 rounded-sm px-2.5 font-mono text-[11px] transition-colors duration-75',
                    active ? 'bg-slate-100 text-obsidian' : 'text-slate-400 hover:bg-raised hover:text-slate-200',
                  )}
                >
                  {s.title}
                </button>
              )
            })}
          </div>
        </nav>
      )}

      {/* Scan line under the bar while a request is in flight */}
      <div className="relative h-px overflow-hidden" aria-hidden>
        {loading && <div className="scanline absolute inset-y-0 w-1/4 bg-ok" />}
      </div>
    </header>
  )
}
