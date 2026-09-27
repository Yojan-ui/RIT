import { useState } from 'react'
import { cn } from '@/lib/cn'

export function CopyButton({ text, className }: { text: string; className?: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setState('copied')
    } catch {
      setState('failed')
    }
    setTimeout(() => setState('idle'), 1600)
  }
  return (
    <button
      type="button"
      onClick={copy}
      className={cn('font-mono text-2xs hover:text-ink', state === 'copied' ? 'text-secure' : 'text-dim', className)}
      aria-live="polite"
    >
      {state === 'copied' ? 'COPIED' : state === 'failed' ? 'SELECT + COPY' : 'COPY'}
    </button>
  )
}
