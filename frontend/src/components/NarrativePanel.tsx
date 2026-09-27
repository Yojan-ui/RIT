import type { ScanResult } from '@/api/types'
import { Panel } from '@/components/Panel'
import { useNarrative } from '@/hooks/useNarrative'
import { cn } from '@/lib/cn'
import { SEVERITY_TONE, TEXT } from '@/lib/tone'

const QUIET_REASONS = new Set(['No Claude API key configured', 'LLM disabled'])

/** "What this means": the engine's findings in plain English, written by Claude or the rule-based writer. */
export function NarrativePanel({ result }: { result: ScanResult }) {
  const state = useNarrative(result)

  if (state.status === 'loading') {
    return (
      <Panel title="Briefing">
        <p className="p-3 font-mono text-xs text-dim" role="status">
          Writing the briefing<span className="caret text-secure">_</span>
        </p>
      </Panel>
    )
  }
  if (state.status === 'error') {
    return (
      <Panel title="Briefing">
        <p className="p-3 text-xs text-vulnerable" role="alert">The briefing couldn't be loaded: {state.message}</p>
      </Panel>
    )
  }

  const n = state.narrative
  const byClaude = n.source.startsWith('llm:')
  return (
    <Panel
      title="Briefing"
      right={<span className={cn('font-mono text-2xs', byClaude ? 'text-signal' : 'text-dim')}>{byClaude ? `CLAUDE ${n.model}` : 'RULE-BASED'}</span>}
    >
      <div className="grid gap-4 p-3 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="min-w-0 space-y-3">
          <div className="max-w-[72ch] space-y-2 text-sm leading-relaxed text-ink">
            {n.summary
              .split('\n\n')
              .filter((p) => p.trim())
              .map((p, i) => (
                <p key={i}>{p}</p>
              ))}
          </div>
          {n.attack_scenarios.length > 0 && (
            <div>
              <h3 className="label mb-1.5">Attacker playbook</h3>
              <ul className="space-y-1.5">
                {n.attack_scenarios.map((s, i) => (
                  <li key={i} className="border-l border-vulnerable pl-3 text-xs text-dim">
                    {s}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        {n.remediation_steps.length > 0 && (
          <div className="min-w-0">
            <h3 className="label mb-1.5">Remediation queue</h3>
            <ol className="space-y-2">
              {n.remediation_steps.map((step) => (
                <li key={step.priority} className="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-x-2 text-xs">
                  <span className="tabular text-dim">{String(step.priority).padStart(2, '0')}</span>
                  <span className="min-w-0">
                    {step.title && <span className="text-ink">{step.title} </span>}
                    {step.severity && <span className={cn('font-mono text-2xs uppercase', TEXT[SEVERITY_TONE[step.severity]])}>{step.severity}</span>}
                    <span className="block text-dim [overflow-wrap:anywhere]">{step.action}</span>
                    {step.rationale && <span className="block text-2xs text-dim">{step.rationale}</span>}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
      <p className="border-t border-line px-3 py-1.5 text-2xs text-dim">
        {byClaude
          ? "Written by Claude from the scan's findings only, and checked against the engine's score, grade and findings before display."
          : "Written from the scan's findings by SecureMailScope's rule-based writer."}
        {n.fallback_reason && !QUIET_REASONS.has(n.fallback_reason) && ` Claude's version wasn't used: ${n.fallback_reason}.`}
      </p>
    </Panel>
  )
}
