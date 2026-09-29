import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'

// `vite --mode hud` / `vite build --mode hud` serve the QuantumLedger HUD variant; everything else the default UI.
const Root = import.meta.env.VITE_UI === 'hud' ? lazy(() => import('./hud/HudApp')) : lazy(() => import('./App'))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Suspense fallback={null}>
      <Root />
    </Suspense>
  </StrictMode>,
)
