import { useEffect, useState } from 'react'
import type { ApiLink } from '@/hooks/useApiLink'
import { cn } from '@/lib/cn'

function useUtcClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])
  return now.toISOString().slice(11, 19)
}

export function TopBar({ link }: { link: ApiLink }) {
  const clock = useUtcClock()
  const tone = link.state === 'online' ? 'bg-secure' : link.state === 'offline' ? 'bg-vulnerable' : 'bg-faint'
  const status =
    link.state === 'online' ? `ONLINE ${link.latencyMs}ms` : link.state === 'offline' ? 'NO LINK' : 'CONNECTING'
  return (
    <header className="flex h-10 items-center justify-between gap-4 border-b border-line bg-obsidian px-4">
      <div className="flex items-center gap-3">
        <svg viewBox="0 0 24 24" className="size-4 text-secure" aria-hidden="true">
          <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M8 12h8" stroke="currentColor" strokeWidth="1.5" />
        </svg>
        <span className="font-mono text-xs font-semibold tracking-wider text-ink">SECUREMAILSCOPE</span>
        <span className="hidden font-mono text-2xs text-dim sm:inline">EMAIL POSTURE TERMINAL</span>
      </div>
      <div className="flex items-center gap-5 font-mono text-2xs">
        <span className="flex items-center gap-2" title={link.state === 'offline' ? link.error : undefined}>
          <span className={cn('size-1.5', tone)} aria-hidden="true" />
          <span className="text-dim">API</span>
          <span className={cn('tabular', link.state === 'offline' ? 'text-vulnerable' : 'text-ink')}>{status}</span>
          {link.state === 'online' && <span className="hidden text-dim md:inline">v{link.version}</span>}
        </span>
        <span className="tabular text-ink" aria-label="Coordinated universal time">
          {clock} <span className="text-dim">UTC</span>
        </span>
      </div>
    </header>
  )
}
