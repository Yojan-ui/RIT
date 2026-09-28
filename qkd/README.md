# BB84 QKD backend

FastAPI + Qiskit AerSimulator implementation of BB84 with an intercept-resend eavesdropper.

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
.venv/bin/uvicorn app.main:app --reload --port 8100   # docs at http://localhost:8100/docs
.venv/bin/python -m pytest -q
```

| Endpoint | Purpose |
|---|---|
| `GET  /api/health` | Qiskit/Aer versions |
| `POST /api/simulate-clean` | Alice → Bob, no Eve (QBER ≈ 0) |
| `POST /api/simulate-attack` | Eve intercepts `intercept_rate` of qubits (QBER ≈ 25% × rate → abort) |
| `POST /api/compare` | Same photons (same seed) clean vs. attacked |
| `GET  /api/qber-sweep` | QBER vs. intercept rate, for a chart |

Body fields (all optional): `n_qubits` (4–2048), `channel_noise`, `sample_fraction`, `qber_threshold`,
`seed`, `include_circuit` (ASCII diagram + OpenQASM, ≤16 qubits), and `intercept_rate` for attacks.

Each response has `qubits[]`, one row per photon with Alice/Eve/Bob basis, bit, state label and Bloch
vector (`alice_bloch`, `eve_bloch`), plus `role` (`key` / `sample` / `discarded`), `state_disturbed`
and `error`. That is what the 3D scene animates. CORS allows the Vite dev server (`QKD_CORS_ORIGINS` to change).

## Frontend (`frontend/`)

Vite + React 19 + TypeScript, React Three Fiber / drei / postprocessing, Tailwind v4, Framer Motion, lucide-react.

```bash
cd frontend && npm install
npm run dev        # http://localhost:5173 (strict port); /api is proxied to :8100
```

Start the backend first. Set `VITE_API_URL` to call a backend somewhere other than the proxy.

The page reads left to right like a storybook:

- **Top banner**: the one status to read: green "SECURE CONNECTION" or pulsing red "INTRUDER DETECTED!".
- **Step 1, Alice**: "SEND SECURE KEY" fires a wave of photon spheres down the fibre (a clean BB84 run).
- **Step 2, the channel**: a data progress bar, a security-risk gauge (share of photons the spy disturbed,
  ~50% under intercept-resend), and "SIMULATE EVE (THE SPY)", which re-sends the same photons through an
  attack. Eve's drone-eye drops over the cable and her hazard lines turn the spheres red and broken.
- **Step 3, Bob**: the bottom-line result once the photons arrive.

The 3D stage lives in `src/scene/QuantumScene.tsx`; the page overlay is in `src/hud/`.

URL options: `?attack` opens straight into the spy scenario · `?lite` turns off bloom and floor
reflections for weak GPUs.
