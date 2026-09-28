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

What's on screen:

- **Optical bench** (`src/scene/QuantumScene.tsx`): Alice's laser source and polariser, Bob's waveplate,
  polarising beam splitter and two SPAD detectors (D0/D1 flash with the outcome). Photons are light
  packets whose bar shows their real polarisation (H/V/D/A). In attack mode Eve's beam-splitter tap
  lowers into the beam and sprays red decoherence when it collapses a photon.
- **Playback** (`src/playback.ts`, `src/hud/PlaybackBar.tsx`): play/pause (space), step one photon (→),
  timeline scrubbing, speed, and a photon trace table. Each detection is described in the readout chip.
- **Bloch sphere drawer** (`src/hud/BlochDrawer.tsx`): click any photon in the beam, trace table or
  readout. Shows Alice's, Eve's and Bob's states and Bob's measurement probabilities. `[` / `]` step photons.
- **One-time pad test** (`src/hud/OtpCard.tsx`): XORs a message with the sifted key; Bob decrypts with his
  copy. Clean mode decrypts perfectly; with Eve the key is discarded and Bob's output is corrupted.

URL options: `?attack` opens in Eve mode · `?photon=N` jumps to photon N (add `&inspect` to open its
Bloch sphere) · `?lite` turns off bloom and floor reflections for weak GPUs.
