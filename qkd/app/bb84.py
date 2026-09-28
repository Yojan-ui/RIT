"""BB84 quantum key distribution, executed as real Qiskit circuits on AerSimulator.

One protocol run builds one circuit with one qubit per transmitted photon:

    Alice          quantum channel           Eve (optional)            Bob
    X if bit=1  ─► id (depolarizing noise) ─► H? · measure · H?  ─►  H? · measure
    H if basis=X                              (intercept-resend)

Every gate is a Clifford (X, H, measure), so the circuit runs on Aer's exact
stabilizer method, which scales to thousands of qubits in milliseconds.

Eve's intercept-resend attack is done inside the circuit: she rotates into her
guessed basis, measures (which collapses the qubit), then rotates back. The qubit
Bob receives is therefore exactly the state Eve would re-prepare from her result.
When her basis was wrong, the original state is destroyed and Bob gets a random
bit 50% of the time, which is where the ~25% QBER comes from.
"""

from __future__ import annotations

import secrets
import time
from dataclasses import dataclass

import numpy as np
from qiskit import ClassicalRegister, QuantumCircuit, QuantumRegister, qasm2
from qiskit_aer import AerSimulator
from qiskit_aer.noise import NoiseModel, depolarizing_error

# Basis encoding. Z = rectilinear (+), X = diagonal (×).
Z, X = 0, 1
BASIS_SYMBOL = {Z: "+", X: "x"}
STATE_LABEL = {(0, Z): "|0>", (1, Z): "|1>", (0, X): "|+>", (1, X): "|->"}
# Bloch vectors (x, y, z) for the four BB84 states, for the 3D frontend.
BLOCH = {(0, Z): (0, 0, 1), (1, Z): (0, 0, -1), (0, X): (1, 0, 0), (1, X): (-1, 0, 0)}

# Above ~11% QBER no secret key can be distilled for BB84 (Shor–Preskill bound).
DEFAULT_QBER_THRESHOLD = 0.11
MAX_QUBITS = 2048
CIRCUIT_DRAW_LIMIT = 16

_simulator = AerSimulator(method="stabilizer")


@dataclass(frozen=True)
class BB84Config:
    n_qubits: int = 64
    intercept_rate: float = 0.0  # fraction of qubits Eve intercepts (0 = no Eve)
    channel_noise: float = 0.0  # depolarizing probability per qubit on the channel
    sample_fraction: float = 0.5  # share of the sifted key revealed to estimate QBER
    qber_threshold: float = DEFAULT_QBER_THRESHOLD
    seed: int | None = None
    include_circuit: bool = False


def build_circuit(
    alice_bits: np.ndarray,
    alice_bases: np.ndarray,
    bob_bases: np.ndarray,
    eve_mask: np.ndarray,
    eve_bases: np.ndarray,
    channel_noise: float,
) -> QuantumCircuit:
    n = len(alice_bits)
    q = QuantumRegister(n, "q")
    bob_c = ClassicalRegister(n, "bob")
    eve_c = ClassicalRegister(n, "eve") if eve_mask.any() else None
    qc = QuantumCircuit(q, *([eve_c] if eve_c is not None else []), bob_c, name="bb84")

    # Alice encodes: bit → X, basis → H.
    for i in range(n):
        if alice_bits[i]:
            qc.x(i)
        if alice_bases[i] == X:
            qc.h(i)
    qc.barrier(label="alice")

    # Quantum channel. The id gate is where the noise model attaches.
    if channel_noise > 0:
        for i in range(n):
            qc.id(i)
        qc.barrier(label="channel")

    # Eve: measure in her basis (collapse), then rotate back = resend what she saw.
    if eve_c is not None:
        for i in np.flatnonzero(eve_mask):
            i = int(i)
            if eve_bases[i] == X:
                qc.h(i)
            qc.measure(i, eve_c[i])
            if eve_bases[i] == X:
                qc.h(i)
        qc.barrier(label="eve")

    # Bob measures in his random basis.
    for i in range(n):
        if bob_bases[i] == X:
            qc.h(i)
        qc.measure(i, bob_c[i])
    return qc


def _noise_model(p: float) -> NoiseModel | None:
    if p <= 0:
        return None
    model = NoiseModel(basis_gates=["id", "x", "h"])
    model.add_all_qubit_quantum_error(depolarizing_error(p, 1), ["id"])
    return model


def execute(qc: QuantumCircuit, channel_noise: float, seed: int) -> dict[str, np.ndarray]:
    """Run the circuit once (shots=1: each qubit is one photon) and return bits per register."""
    job = _simulator.run(
        qc, shots=1, memory=True, seed_simulator=seed, noise_model=_noise_model(channel_noise)
    )
    memory = job.result().get_memory(qc)[0]
    # Qiskit prints registers last-added first, space separated, each with bit 0 rightmost.
    chunks = memory.split(" ")
    out: dict[str, np.ndarray] = {}
    for creg, bits in zip(reversed(qc.cregs), chunks):
        out[creg.name] = np.array([int(b) for b in reversed(bits)], dtype=np.int8)
    return out


def _bits_to_str(bits) -> str:
    return "".join(str(int(b)) for b in bits)


def _bits_to_hex(bits) -> str:
    if len(bits) == 0:
        return ""
    return f"{int(_bits_to_str(bits), 2):0{(len(bits) + 3) // 4}x}"


def run_bb84(cfg: BB84Config) -> dict:
    if not 1 <= cfg.n_qubits <= MAX_QUBITS:
        raise ValueError(f"n_qubits must be between 1 and {MAX_QUBITS}")

    started = time.perf_counter()
    seed = cfg.seed if cfg.seed is not None else secrets.randbits(32)
    rng = np.random.default_rng(seed)
    n = cfg.n_qubits

    # Draw order matters: Alice/Bob choices come first, so the same seed gives the
    # same transmission with or without Eve (lets the frontend compare side by side).
    alice_bits = rng.integers(0, 2, n, dtype=np.int8)
    alice_bases = rng.integers(0, 2, n, dtype=np.int8)
    bob_bases = rng.integers(0, 2, n, dtype=np.int8)
    eve_draw = rng.random(n)
    eve_bases = rng.integers(0, 2, n, dtype=np.int8)
    eve_mask = eve_draw < cfg.intercept_rate if cfg.intercept_rate > 0 else np.zeros(n, bool)

    qc = build_circuit(alice_bits, alice_bases, bob_bases, eve_mask, eve_bases, cfg.channel_noise)
    measured = execute(qc, cfg.channel_noise, seed)
    bob_bits = measured["bob"]
    eve_bits = measured.get("eve")

    # Sifting: publicly compare bases, keep positions where they agree.
    match = alice_bases == bob_bases
    sifted_idx = np.flatnonzero(match)

    # Parameter estimation: reveal a random sample of the sifted bits.
    n_sample = int(round(len(sifted_idx) * cfg.sample_fraction))
    if len(sifted_idx) >= 2:
        n_sample = min(max(n_sample, 1), len(sifted_idx) - 1)
    else:
        n_sample = 0
    sample_idx = np.sort(rng.choice(sifted_idx, n_sample, replace=False)) if n_sample else np.array([], int)
    key_idx = np.setdiff1d(sifted_idx, sample_idx)

    sample_errors = int(np.sum(alice_bits[sample_idx] != bob_bits[sample_idx]))
    qber = sample_errors / n_sample if n_sample else 0.0
    sifted_errors = int(np.sum(alice_bits[sifted_idx] != bob_bits[sifted_idx]))
    true_qber = sifted_errors / len(sifted_idx) if len(sifted_idx) else 0.0

    alice_key = alice_bits[key_idx]
    bob_key = bob_bits[key_idx]
    aborted = qber > cfg.qber_threshold

    # What Eve learned about the final key: bits she measured in Alice's basis.
    if eve_bits is not None:
        eve_knows = eve_mask[key_idx] & (eve_bases[key_idx] == alice_bases[key_idx])
        eve_known_bits = int(eve_knows.sum())
    else:
        eve_known_bits = 0

    sample_set, key_set = set(sample_idx.tolist()), set(key_idx.tolist())
    qubits = []
    for i in range(n):
        a = (int(alice_bits[i]), int(alice_bases[i]))
        row = {
            "index": i,
            "alice_bit": a[0],
            "alice_basis": BASIS_SYMBOL[a[1]],
            "alice_state": STATE_LABEL[a],
            "alice_bloch": BLOCH[a],
            "intercepted": bool(eve_mask[i]),
            "eve_basis": None,
            "eve_bit": None,
            "eve_resent_state": None,
            "eve_bloch": None,
            "state_disturbed": False,
            "bob_basis": BASIS_SYMBOL[int(bob_bases[i])],
            "bob_bit": int(bob_bits[i]),
            "bases_match": bool(match[i]),
            "role": "sample" if i in sample_set else "key" if i in key_set else "discarded",
            "error": bool(match[i] and alice_bits[i] != bob_bits[i]),
        }
        if eve_mask[i]:
            e = (int(eve_bits[i]), int(eve_bases[i]))
            row.update(
                eve_basis=BASIS_SYMBOL[e[1]],
                eve_bit=e[0],
                eve_resent_state=STATE_LABEL[e],
                eve_bloch=BLOCH[e],
                # Wrong basis = the measurement collapsed Alice's state into a different one.
                state_disturbed=bool(eve_bases[i] != alice_bases[i]),
            )
        qubits.append(row)

    ops = {k: int(v) for k, v in qc.count_ops().items()}
    circuit = {
        "num_qubits": qc.num_qubits,
        "num_clbits": qc.num_clbits,
        "depth": qc.depth(),
        "gate_counts": ops,
        "simulator": "AerSimulator(method='stabilizer')",
        "diagram": None,
        "qasm": None,
    }
    if cfg.include_circuit and n <= CIRCUIT_DRAW_LIMIT:
        circuit["diagram"] = str(qc.draw(output="text", fold=-1))
        circuit["qasm"] = qasm2.dumps(qc)

    expected_qber = cfg.intercept_rate * 0.25 + cfg.channel_noise * 2 / 3

    return {
        "scenario": "attack" if cfg.intercept_rate > 0 else "clean",
        "seed": seed,
        "params": {
            "n_qubits": n,
            "intercept_rate": cfg.intercept_rate,
            "channel_noise": cfg.channel_noise,
            "sample_fraction": cfg.sample_fraction,
            "qber_threshold": cfg.qber_threshold,
        },
        "alice": {
            "bits": _bits_to_str(alice_bits),
            "bases": "".join(BASIS_SYMBOL[int(b)] for b in alice_bases),
        },
        "bob": {
            "bases": "".join(BASIS_SYMBOL[int(b)] for b in bob_bases),
            "bits": _bits_to_str(bob_bits),
        },
        "eve": {
            "active": eve_bits is not None,
            "intercepted_count": int(eve_mask.sum()),
            "wrong_basis_count": int(np.sum(eve_mask & (eve_bases != alice_bases))),
            "known_final_key_bits": eve_known_bits,
        },
        "sifting": {
            "matching_bases": int(match.sum()),
            "sifted_length": int(len(sifted_idx)),
            "sifted_indices": sifted_idx.tolist(),
            "sample_indices": sample_idx.tolist(),
            "key_indices": key_idx.tolist(),
        },
        "metrics": {
            "qber": round(qber, 4),
            "qber_percent": round(qber * 100, 2),
            "sample_errors": sample_errors,
            "sample_size": n_sample,
            "true_qber": round(true_qber, 4),
            "expected_qber": round(expected_qber, 4),
            "threshold": cfg.qber_threshold,
            "eavesdropper_detected": aborted,
        },
        "key": {
            "status": "aborted" if aborted else "established",
            "length": int(len(key_idx)),
            "alice_key": _bits_to_str(alice_key),
            "bob_key": _bits_to_str(bob_key),
            "alice_key_hex": _bits_to_hex(alice_key),
            "bob_key_hex": _bits_to_hex(bob_key),
            "keys_match": bool(np.array_equal(alice_key, bob_key)),
            "mismatched_bits": int(np.sum(alice_key != bob_key)),
            # Only hand out a usable key when the check passed.
            "final_key": None if aborted else _bits_to_str(alice_key),
        },
        "qubits": qubits,
        "circuit": circuit,
        "elapsed_ms": round((time.perf_counter() - started) * 1000, 2),
    }
