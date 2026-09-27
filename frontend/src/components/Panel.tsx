import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

export function Panel({ title, right, className, children }: { title: string; right?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <section className={cn('flex min-w-0 flex-col border border-line bg-panel', className)}>
      <header className="flex h-8 shrink-0 items-center justify-between gap-3 border-b border-line px-3">
        <h2 className="label">{title}</h2>
        {right}
      </header>
      <div className="min-h-0 flex-1">{children}</div>
    </section>
  )
}
