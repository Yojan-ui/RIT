import { Moon, Search, Sun } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import type { Source } from '@/hooks/useReport'
import type { Theme } from '@/hooks/useTheme'
import { cn } from '@/lib/utils'
import type { DemoScenario, RecentScan } from '@/lib/types'

function Chip({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean
  onClick: () => void
  title?: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={title}
      className={cn(
        'inline-flex h-7 shrink-0 items-center gap-2 border px-2.5 text-[11.5px]',
        active ? 'border-ink bg-ink text-page' : 'border-line text-ink-2 hover:border-ink hover:text-ink',
      )}
    >
      {children}
    </button>
  )
}

export function TopBar({
  initialDomain = '',
  scenarios,
  recent = [],
  source,
  loading,
  apiUp,
  theme,
  onTheme,
  onSelect,
}: {
  initialDomain?: string
  scenarios: DemoScenario[]
  recent?: RecentScan[]
  source?: Source
  loading: boolean
  apiUp: boolean | null
  theme: Theme
  onTheme: (next: Theme) => void
  onSelect: (source: Source) => void
}) {
  const [domain, setDomain] = useState(initialDomain)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const value = domain.trim()
    if (value) onSelect({ kind: 'live', domain: value })
  }

  return (
    <header className="sticky top-0 z-20 border-b border-line bg-page">
      <div className="mx-auto flex max-w-[1240px] flex-wrap items-center gap-x-8 gap-y-3 px-4 py-2.5 md:px-6">
        <a href="/" className="text-[14px] font-bold tracking-[0.14em] text-ink" aria-label="SecureMailScope home">
          SECUREMAIL<span className="text-ok">//</span>SCOPE
        </a>

        <form onSubmit={submit} className="order-last flex w-full gap-2 md:order-none md:ml-auto md:w-auto">
          <label htmlFor="domain" className="sr-only">
            Domain to check
          </label>
          <div className="relative min-w-0 flex-1 md:w-80 md:flex-none">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
            <input
              id="domain"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              placeholder="yourcompany.com"
              autoComplete="off"
              spellCheck={false}
              className="h-9 w-full border border-line bg-surface pr-3 pl-9 text-[12.5px] text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none"
            />
          </div>
          <button
            type="submit"
            disabled={!domain.trim() || loading}
            className="h-9 shrink-0 border border-accent bg-accent px-4 text-[12px] font-bold tracking-[0.1em] text-accent-ink active:translate-y-px disabled:cursor-not-allowed disabled:border-line disabled:bg-transparent disabled:text-ink-3"
          >
            SCAN
          </button>
        </form>

        <div className="flex items-center gap-3">
          <span
            className="flex items-center gap-1.5 text-[11.5px] text-ink-3"
            title={apiUp === false ? 'Scanner is unreachable' : 'Scanner is online'}
          >
            <span
              className={cn('size-2', apiUp === null ? 'bg-na' : apiUp ? 'bg-ok' : 'bg-crit')}
              aria-hidden
            />
            API {apiUp === false ? 'OFFLINE' : 'ONLINE'}
          </span>
          <button
            type="button"
            onClick={() => onTheme(theme === 'dark' ? 'light' : 'dark')}
            aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            className="grid size-9 place-items-center border border-line text-ink-2 hover:border-line-strong hover:text-ink"
          >
            {theme === 'dark' ? <Sun className="size-4" aria-hidden /> : <Moon className="size-4" aria-hidden />}
          </button>
        </div>
      </div>

      {(scenarios.length > 0 || recent.length > 0) && (
        <nav aria-label="Examples and recent checks" className="border-t border-line">
          <div className="mx-auto flex max-w-[1240px] items-center gap-2 overflow-x-auto px-4 py-2 md:px-6">
            {scenarios.length > 0 && <span className="mr-1 shrink-0 text-[10.5px] font-bold tracking-[0.12em] text-ink-3">DEMO</span>}
            {scenarios.map((s) => (
              <Chip
                key={s.id}
                active={source?.kind === 'demo' && source.id === s.id}
                onClick={() => onSelect({ kind: 'demo', id: s.id })}
                title={s.description}
              >
                {s.title}
              </Chip>
            ))}
            {recent.length > 0 && (
              <span className="mr-1 ml-4 shrink-0 text-[10.5px] font-bold tracking-[0.12em] text-ink-3">RECENT</span>
            )}
            {recent.map((r) => {
              const active = source?.kind === 'live' && source.domain === r.domain
              const tone = r.score >= 80 ? 'text-ok' : r.score >= 50 ? 'text-warn' : 'text-crit'
              return (
                <Chip
                  key={r.domain}
                  active={active}
                  onClick={() => onSelect({ kind: 'live', domain: r.domain, cached: true })}
                  title={`Checked ${new Date(r.scanned_at).toLocaleString()}, score ${r.score} of 100`}
                >
                  {r.domain}
                  <span className={cn('font-bold', !active && tone)}>{r.grade}</span>
                </Chip>
              )
            })}
          </div>
        </nav>
      )}

      <div className="relative h-px overflow-hidden" aria-hidden>
        {loading && <div className="scanline absolute inset-y-0 w-1/4 bg-ok" />}
      </div>
    </header>
  )
}
