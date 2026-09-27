// Standalone page for the Spline scene, embedded by the dashboard as an iframe.
//
// The Spline runtime needs `eval` and fetches WebAssembly from unpkg.com. Running it in
// its own document lets the server give just this page a looser Content Security Policy,
// while the main dashboard (which renders attacker-controlled DNS data) keeps a strict one.
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { SplineScene } from '@/components/ui/spline-scene'
import './index.css'

const SCENE = 'https://prod.spline.design/kZDDjO5HuC9GJUM2/scene.splinecode'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <div className="h-dvh w-full">
      <SplineScene scene={SCENE} className="h-full w-full" />
    </div>
  </StrictMode>,
)
