import { Component, Suspense, lazy, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

// The Spline runtime is large; load it only when a scene is rendered.
const Spline = lazy(() => import('@splinetool/react-spline'))

interface SplineSceneProps {
  /** Public .splinecode URL (fetched from Spline's CDN at runtime). */
  scene: string
  className?: string
}

function Status({ children, tone = 'text-neutral-500' }: { children: ReactNode; tone?: string }) {
  return (
    <div className="flex h-full w-full items-center justify-center">
      <span className={cn('font-mono text-[10px] tracking-[0.2em] uppercase', tone)}>{children}</span>
    </div>
  )
}

/** A network failure or WebGL error must not take the dashboard down with it. */
class SceneBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    return this.state.failed ? <Status tone="text-red-500/80">3D scene unavailable</Status> : this.props.children
  }
}

export function SplineScene({ scene, className }: SplineSceneProps) {
  return (
    <SceneBoundary>
      <Suspense
        fallback={
          <Status>
            <span className="animate-pulse">Loading 3D scene…</span>
          </Status>
        }
      >
        <Spline scene={scene} className={className} />
      </Suspense>
    </SceneBoundary>
  )
}
