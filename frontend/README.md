# SecureMailScope frontend

React 19 + Vite + Tailwind CSS v4. Tailwind v4 is configured in CSS, not `tailwind.config.js`: all theme tokens live in the `@theme` block of `src/index.css`.

- **Surfaces:** `obsidian` #0B0F19 page, stepping up through `panel`, `raised`, `line`, `line-strong`. A faint 24px/120px grid overlay is drawn by `body::before`, fixed to the viewport.
- **Status:** `ok` #10B981 (Phosphor Green, secure), `warn` #F59E0B (Warning Amber), `crit` #EF4444 (Cadmium Red, vulnerable), `na` for unmeasured.
- **Type:** strictly monospaced. JetBrains Mono (Fira Code fallback) for all text; `font-sans` is aliased to the mono stack. Ligatures are off so DNS strings read literally, with slashed zeros and tabular digits.

```bash
npm install
npm run dev          # http://localhost:5173, proxies /api -> http://127.0.0.1:8000
API_TARGET=http://127.0.0.1:8765 npm run dev   # point the proxy elsewhere
npm run build        # typecheck + production build into ../backend/static/
```

URL parameters: `?demo=<scenario>` (fortress, startup, wide-open, legacy-corp, parked, firewalled), `?domain=<name>` for a live scan, and `?delay=1500` to slow demo responses while working on loading states.

In production the root `Dockerfile` builds this app and FastAPI serves `dist/` from the same origin, so API paths stay relative.

## Defense Lattice (3D)

`src/components/lattice/` renders the posture as a React Three Fiber scene: a lat/long wireframe sphere core for the target domain (tinted by overall score) with the 7 vectors as orbiting octahedron satellites, joined by razor-thin (1px) `LineSegments` rewritten every frame.

- **Pass:** solid green link with data packets flowing to the node. **Warn:** amber. **Unmeasured / N/A:** dim slate, no glow.
- **Fail:** the link snaps on an under-damped spring (whip, recoil, droop), turns red and sheds fragments that scatter, tumble and flicker around the break; the node glitches (position/scale jitter, hot red-white flashes). Reverting to pass reconnects the link.
- Glow comes from three.js `UnrealBloomPass` (`UnrealBloom.tsx`: `EffectComposer` → `RenderPass` → `UnrealBloomPass` → `OutputPass`, run at `useFrame` priority 1). The composer renders to a HalfFloat target, so only colours pushed over the 0.8 threshold (live links, packets, failing nodes) bloom. The canvas uses `flat` (no tone mapping) and stays transparent over the glass panel.
- `OrbitControls` with damping; wheel-zoom is off so the page still scrolls. Auto-rotate pauses while dragging.
- Lazy-loaded chunk; rendering pauses when scrolled off-screen; honours `prefers-reduced-motion`. Click a node (or its legend chip) to jump to that vector's card.

### DOM ↔ 3D wiring

Hovering (or keyboard-focusing) **The One Fix** card or an **attack path row** flies the camera to the relevant node: the fix's vector, or the path's most broken governing vector (primary vector on ties). The camera tracks the node as it orbits, the rest of the lattice dims below the bloom threshold, and a 180 ms grace period lets you slide between rows without the camera bouncing home. On `xl` screens the lattice is sticky beside the matrix so the fly-to stays in view.

Links carry simulated data streams: 10 packets per link with fading trails, requests outbound and responses (whiter) inbound. Warning links run slower and drop packets mid-link; failing links send packets into the break, where they die in sparks.

## Command deck layout

At `xl` the top of the page is a viewport-height, 3-column deck of frosted-glass panels (translucent slate, backdrop blur, hairline borders over faint ambient glows):

| Left: metrics | Center: 3D | Right: remediation & logs |
|---|---|---|
| **Security Posture** (0-100 score, grade, per-vector contribution) | **Defense Lattice** (transparent canvas; the camera re-fits to the column's aspect ratio) | **The One Fix** (the recommended record as a zone-file line in a dark code block; copy value or full line) |
| **Attack Path Matrix**: the 7 checks with pill status badges and the number of open attack paths each gates | | **Real-Time Telemetry**: terminal feed |

Below `xl` the column wrappers are `display: contents`, so panels stack in priority order: Posture, One Fix, 3D, Matrix, Telemetry. The full attack-path × vector table and the vector detail cards sit below the deck.

**Telemetry** first replays the scan's real observations as a probe transcript (DNS answers, SPF lookup walk, DKIM selectors, MTA-STS policy fetch, and the STARTTLS exchange reconstructed from the probe result). It then appends simulated monitoring lines built from the same hosts and records. The panel is labelled SIMULATED. It auto-follows the tail unless you scroll up, and it can be paused.

## Main dashboard (`SecureMailDashboard`)

`src/components/dashboard.tsx` is the page's primary view: a full-width 700px terminal card (`#050505`, 1px `white/10` borders, square corners, `font-mono`) with a pointer-tracking `Spotlight`.

- **Left, data:** status header, the Security Posture score, a dense Attack Path Matrix (SPF, DKIM, DMARC, MX, MTA-STS, TLS-RPT, STARTTLS; PASS emerald, WARN amber, FAIL red, N/A or N/M grey; click a row for its detail card), and The One Fix as a frosted sub-panel with the recommended record as a raw zone-file string. If STARTTLS is missing, a separate *server-side* line reads "Enforce STARTTLS in SMTP config", since that is not a DNS change.
- **Right, 3D + telemetry:** a toolbar toggles the viewport between the data-bound **Defense Lattice** (default) and the **Spline scene** (choice remembered per browser; with the lattice showing, hovering a matrix row flies its camera to that node). The **Real-Time Telemetry** terminal sits below the viewport. The Spline scene is (`https://prod.spline.design/kZDDjO5HuC9GJUM2/scene.splinecode`, fetched from Spline's CDN at runtime), shown behind a CRT vignette and HUD corners showing the target and open paths. It is lazy-loaded with a Suspense fallback and an error boundary, so a blocked CDN shows "3D scene unavailable" instead of breaking the page.

All values come from the API report (demo tabs or live scan). UI primitives follow shadcn conventions in `src/components/ui/` (`card`, `spotlight`, `spline-scene`), with `cn` in `src/lib/utils.ts`. Theme: all `rounded-*` radii are 0 via `@theme` (`rounded-full` is kept for status dots).

`CheckMatrix`, `ScorePanel` and `OneFixCard` (the earlier deck's versions of the left-column panels) are not rendered by the current `App` but remain in the tree.
