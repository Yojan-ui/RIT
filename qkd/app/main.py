"""FastAPI service exposing the Qiskit BB84 simulation to the React Three Fiber frontend.

Run:  uvicorn app.main:app --reload --port 8100
Docs: http://localhost:8100/docs
"""

from __future__ import annotations

import asyncio
import os
import secrets

import qiskit
import qiskit_aer
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from .bb84 import DEFAULT_QBER_THRESHOLD, MAX_QUBITS, BB84Config, run_bb84

app = FastAPI(
    title="BB84 QKD Simulator",
    version="1.0.0",
    description="BB84 quantum key distribution on Qiskit AerSimulator, with an intercept-resend eavesdropper.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get(
        "QKD_CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
    ).split(","),
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

# Simulations are CPU-bound; cap how many run at once in the thread pool.
_sim_slots = asyncio.Semaphore(int(os.environ.get("QKD_MAX_CONCURRENT", "4")))


class CleanRequest(BaseModel):
    n_qubits: int = Field(64, ge=4, le=MAX_QUBITS, description="Photons Alice sends")
    channel_noise: float = Field(0.0, ge=0.0, le=0.5, description="Depolarizing probability on the channel")
    sample_fraction: float = Field(0.5, gt=0.0, lt=1.0, description="Share of sifted bits revealed for QBER")
    qber_threshold: float = Field(DEFAULT_QBER_THRESHOLD, gt=0.0, lt=0.5)
    seed: int | None = Field(None, ge=0, description="Fix for reproducible demos")
    include_circuit: bool = Field(False, description="Add ASCII diagram + OpenQASM (n_qubits <= 16)")


class AttackRequest(CleanRequest):
    intercept_rate: float = Field(1.0, gt=0.0, le=1.0, description="Fraction of qubits Eve intercepts")


class CompareRequest(AttackRequest):
    pass


def _config(req: CleanRequest, intercept_rate: float = 0.0, seed: int | None = None) -> BB84Config:
    return BB84Config(
        n_qubits=req.n_qubits,
        intercept_rate=intercept_rate,
        channel_noise=req.channel_noise,
        sample_fraction=req.sample_fraction,
        qber_threshold=req.qber_threshold,
        seed=req.seed if seed is None else seed,
        include_circuit=req.include_circuit,
    )


async def _simulate(cfg: BB84Config) -> dict:
    async with _sim_slots:
        try:
            return await asyncio.to_thread(run_bb84, cfg)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.get("/api/health")
async def health() -> dict:
    return {
        "status": "ok",
        "qiskit": qiskit.__version__,
        "qiskit_aer": qiskit_aer.__version__,
        "simulator": "AerSimulator(method='stabilizer')",
        "max_qubits": MAX_QUBITS,
    }


@app.post("/api/simulate-clean")
async def simulate_clean(req: CleanRequest | None = None) -> dict:
    """Alice → Bob with no eavesdropper. QBER ≈ 0 (or ≈ 2/3 × channel_noise)."""
    return await _simulate(_config(req or CleanRequest()))


@app.post("/api/simulate-attack")
async def simulate_attack(req: AttackRequest | None = None) -> dict:
    """Eve intercepts and resends. QBER ≈ 25% × intercept_rate, so the key is aborted."""
    req = req or AttackRequest()
    return await _simulate(_config(req, intercept_rate=req.intercept_rate))


@app.post("/api/compare")
async def compare(req: CompareRequest | None = None) -> dict:
    """Same photons (same seed) sent twice: once clean, once through Eve."""
    req = req or CompareRequest()
    seed = req.seed if req.seed is not None else secrets.randbits(32)
    clean, attack = await asyncio.gather(
        _simulate(_config(req, seed=seed)),
        _simulate(_config(req, intercept_rate=req.intercept_rate, seed=seed)),
    )
    return {"seed": seed, "clean": clean, "attack": attack}


@app.get("/api/qber-sweep")
async def qber_sweep(n_qubits: int = 512, steps: int = 11, channel_noise: float = 0.0, seed: int | None = None) -> dict:
    """QBER vs. Eve's intercept rate, for a chart. Measured values sit on the 25% × rate line."""
    if not 2 <= steps <= 21:
        raise HTTPException(422, "steps must be between 2 and 21")
    if not 16 <= n_qubits <= MAX_QUBITS:
        raise HTTPException(422, f"n_qubits must be between 16 and {MAX_QUBITS}")
    if not 0.0 <= channel_noise <= 0.5:
        raise HTTPException(422, "channel_noise must be between 0 and 0.5")
    seed = seed if seed is not None else secrets.randbits(32)
    rates = [round(i / (steps - 1), 4) for i in range(steps)]
    runs = await asyncio.gather(*(
        _simulate(BB84Config(n_qubits=n_qubits, intercept_rate=r, channel_noise=channel_noise, seed=seed))
        for r in rates
    ))
    return {
        "seed": seed,
        "n_qubits": n_qubits,
        "threshold": DEFAULT_QBER_THRESHOLD,
        "points": [
            {
                "intercept_rate": r,
                "qber": run["metrics"]["true_qber"],
                "expected_qber": run["metrics"]["expected_qber"],
                "detected": run["metrics"]["eavesdropper_detected"],
            }
            for r, run in zip(rates, runs)
        ],
    }
