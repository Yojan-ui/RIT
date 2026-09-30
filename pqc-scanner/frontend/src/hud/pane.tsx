// Holographic pane: the one container every floating HUD module uses. A 1px glowing cyan edge, frosted
// glass, curved scanlines and a specular sheen. Hover response (tilt, scale, sheen position, edge glow)
// comes from the 3D raycast in spatial.tsx through the --hover / --gx / --gy custom properties.
import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'

export function Pane({ icon: Icon, title, right, tone, className = '', bodyClassName = '', children }: { icon: LucideIcon; title: ReactNode; right?: ReactNode; tone?: 'warn' | 'ok'; className?: string; bodyClassName?: string; children: ReactNode }) {
  return (
    <section className={`holo-pane ${tone ?? ''} ${className}`}>
      <header className="holo-head">
        <h2 className="holo-title">
          <Icon size={14} strokeWidth={1.75} aria-hidden />
          {title}
        </h2>
        {right}
      </header>
      <div className={`holo-body ${bodyClassName}`}>{children}</div>
    </section>
  )
}
