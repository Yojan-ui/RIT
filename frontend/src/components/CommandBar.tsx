import { useState, type FormEvent } from 'react'
import type { DemoDomain, RecentScan, ScanRequest } from '@/api/types'
import { GRADE_TONE, TEXT } from '@/lib/tone'
import { cn } from '@/lib/cn'

type Props = { demos: DemoDomain[]; recent: RecentScan[]; busy: boolean; onScan: (r: ScanRequest) => void; initialDomain?: string }

export function CommandBar({ demos, recent, busy, onScan, initialDomain = '' }: Props) {
  const [domain, setDomain] = useState(initialDomain)
  const [selectors, setSelectors] = useState('')
  const [fresh, setFresh] = useState(false)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!domain.trim()) return
    onScan({ domain: domain.trim(), dkim_selectors: selectors.split(/[\s,]+/).filter(Boolean), force_refresh: fresh })
  }

  const run = (target: string) => {
    setDomain(target)
    onScan({ domain: target, dkim_selectors: [], force_refresh: false })
  }

  return (
    <div className="border-b border-line bg-panel">
      <form onSubmit={submit} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5">
        <label htmlFor="target" className="font-mono text-xs text-secure">
          scan&nbsp;&gt;
        </label>
        <input
          id="target"
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
          placeholder="domain.tld"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          autoFocus
          className="min-w-0 flex-1 basis-56 border-0 bg-transparent font-mono text-sm text-ink caret-secure outline-none placeholder:text-faint"
        />
        <input
          value={selectors}
          onChange={(e) => setSelectors(e.target.value)}
          placeholder="dkim selectors"
          aria-label="DKIM selectors (optional)"
          autoComplete="off"
          spellCheck={false}
          className="w-40 border border-line bg-obsidian px-2 py-1 font-mono text-xs text-ink outline-none placeholder:text-faint focus:border-line-strong"
        />
        <label className="flex items-center gap-1.5 font-mono text-2xs text-dim" title="Ignore the cached result and scan again">
          <input type="checkbox" checked={fresh} onChange={(e) => setFresh(e.target.checked)} className="size-3 accent-[#33ff88]" />
          --fresh
        </label>
        <button
          type="submit"
          disabled={busy || !domain.trim()}
          className="border border-secure px-3 py-1 font-mono text-xs font-semibold text-secure hover:bg-secure hover:text-obsidian disabled:cursor-not-allowed disabled:border-line disabled:text-faint disabled:hover:bg-transparent"
        >
          {busy ? 'SCANNING' : 'RUN ⏎'}
        </button>
      </form>
      {demos.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-1 gap-y-1 border-t border-line px-4 py-1.5">
          <span className="label mr-2">Demo targets</span>
          {demos.map((d) => (
            <button
              key={d.domain}
              type="button"
              onClick={() => run(d.domain)}
              disabled={busy}
              title={d.story}
              className="flex items-center gap-1.5 border border-transparent px-2 py-0.5 font-mono text-2xs text-dim hover:border-line hover:text-ink disabled:opacity-50"
            >
              <span className={cn('font-semibold', TEXT[GRADE_TONE[d.grade]])}>{d.grade}</span>
              {d.domain}
            </button>
          ))}
        </div>
      )}
      {recent.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-1 gap-y-1 border-t border-line px-4 py-1.5">
          <span className="label mr-2">Recent</span>
          {recent.map((r) => (
            <button
              key={r.domain}
              type="button"
              onClick={() => run(r.domain)}
              disabled={busy}
              title={`Scanned ${new Date(r.scanned_at).toISOString().slice(0, 16).replace('T', ' ')} UTC`}
              className="border border-transparent px-2 py-0.5 font-mono text-2xs text-dim hover:border-line hover:text-ink disabled:opacity-50"
            >
              {r.domain}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
