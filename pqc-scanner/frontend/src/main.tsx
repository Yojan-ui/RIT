import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'

// `vite --mode hud` / `vite build --mode hud` serve QuantumLedger (landing page gateway → 3D HUD); everything else the default UI.
const Root = import.meta.env.VITE_UI === 'hud' ? lazy(() => import('./hud/QuantumLedger')) : lazy(() => import('./App'))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Suspense fallback={null}>
      <Root />
    </Suspense>
  </StrictMode>,
)
