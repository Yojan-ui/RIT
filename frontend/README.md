# SecureMailScope: React terminal

The SecureMailScope UI: React 19, Vite, TypeScript, Tailwind CSS 4 and React Three Fiber,
styled as a dark institutional terminal in the MochaTrade visual language. FastAPI serves the
built app (dist/) at /.

```bash
npm install
npm run dev        # http://localhost:5173, proxies /api to FastAPI on :8000
npm run build      # type-check + production build into dist/
npm run lint
npm run gen:api    # regenerate src/api/schema.d.ts from the backend's OpenAPI schema
```

Start the backend first (`uvicorn app.main:app --reload` from the repository root).
`?domain=example.com` scans on load.

## Layout

```
src/
  api/          client.ts (typed fetch client), types.ts, schema.d.ts + openapi.json (generated)
  hooks/        useApiLink (health + latency), useScan, useNarrative, useRecent, useDemoDomains
  components/   TopBar, CommandBar, Panel, Readout (metrics, attack matrix, controls, fix),
                NarrativePanel (briefing), CopyButton
    three/      PostureField (R3F, lazy-loaded) and its WebGL fallback
  lib/          tone.ts (status -> meaning -> colour), cn.ts
  index.css     theme tokens
```

## Conventions

- **Colour means something.** Components use `secure`, `partial`, `vulnerable` and `unknown`
  (see `lib/tone.ts`), never raw colours. The palette lives in `index.css`.
- **Numbers are monospaced** with tabular figures (`tabular` utility); labels use the `label`
  utility (small, uppercase, tracked).
- **Types come from the backend.** Don't hand-write API shapes; run `npm run gen:api` after
  changing a Pydantic model. A backend test fails if the generated files are stale.
- **three.js loads lazily** after first paint and the 3D view degrades to text without WebGL.
