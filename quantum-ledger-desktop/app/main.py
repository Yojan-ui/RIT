"""QuantumLedger local API + dashboard. Binds to 127.0.0.1 only; no outbound calls."""

from __future__ import annotations

import hashlib
import hmac
import json
import secrets
from pathlib import Path

from fastapi import Body, FastAPI, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import prober, scoring, shield
from .db import Database, dumps
from .ledger import Ledger, now_iso

STATIC = Path(__file__).resolve().parent / "static"


class AssessRequest(BaseModel):
    z_years: float = Field(scoring.DEFAULT_Z_YEARS, gt=0, le=50, description="Mosca Z: years until a CRQC")


class RemediateRequest(BaseModel):
    asset_id: str | None = Field(None, description="Defaults to the highest-risk forgeable RSA-2048 TLS asset")


class TamperRequest(BaseModel):
    idx: int | None = Field(None, ge=0, description="Block to alter (defaults to the earliest scan block)")


def create_app(db_path: str | Path | None = None) -> FastAPI:
    db = Database(db_path)
    ledger = Ledger(db)
    prober.seed_estate(db)
    attest_dir = db.path.parent / "attestations"

    app = FastAPI(
        title="QuantumLedger",
        version="0.1.0",
        description="Detect forgeable signatures, migrate to FIPS 204 ML-DSA / FIPS 203 ML-KEM, and prove it with a Merkle log.",
    )

    def device_key() -> bytes:
        """Local signing secret for the simulated ML-DSA-65 attestation signature."""
        path = db.path.parent / "device.key"
        if not path.exists():
            path.write_bytes(secrets.token_bytes(32))
            path.chmod(0o600)
        return path.read_bytes()

    def load_assets() -> list[dict]:
        rows = db.query("SELECT * FROM assets ORDER BY COALESCE(risk_score, -1) DESC, id")
        for r in rows:
            r["handshake"] = json.loads(r["handshake"])
            r["mosca"] = json.loads(r["mosca"]) if r["mosca"] else None
        return rows

    def last_z() -> float:
        for b in reversed(ledger.blocks()):
            if b["kind"] == "assessment":
                return float(b["payload"]["z_years"])
        return scoring.DEFAULT_Z_YEARS

    # ── Stage 1: DETECT ────────────────────────────────────────────────────────
    @app.post("/scan", tags=["1 · detect"])
    def scan():
        assets, cbom = prober.scan(db)
        cbom_json = dumps(cbom)
        cbom_sha = hashlib.sha256(cbom_json.encode()).hexdigest()
        with db.tx() as c:
            cur = c.execute("INSERT INTO scans (ts, cbom, cbom_sha256) VALUES (?,?,?)", (now_iso(), cbom_json, cbom_sha))
            scan_id = cur.lastrowid
            c.execute("DELETE FROM assets")
            for a in assets:
                c.execute(
                    "INSERT INTO assets (id,host,port,protocol,service,signature_alg,key_exchange,exposure,handshake,scanned_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
                    (a["id"], a["host"], a["port"], a["protocol"], a["service"], a["signature_alg"], a["key_exchange"], a["exposure"], dumps(a["handshake"]), a["scanned_at"]),
                )
        block = ledger.append("scan", {
            "scan_id": scan_id,
            "cbom_serial": cbom["serialNumber"],
            "cbom_sha256": cbom_sha,
            "assets": [{k: a[k] for k in ("id", "host", "port", "protocol", "signature_alg", "key_exchange")} for a in assets],
        })
        return {"scan_id": scan_id, "assets": assets, "cbom_sha256": cbom_sha, "components": len(cbom["components"]), "block": block}

    @app.get("/cbom", tags=["1 · detect"])
    def cbom():
        row = db.one("SELECT cbom FROM scans ORDER BY id DESC LIMIT 1")
        if not row:
            raise HTTPException(404, "No scan yet.")
        return JSONResponse(json.loads(row["cbom"]), headers={"Content-Disposition": 'inline; filename="cbom.cdx.json"'})

    # ── Stage 2: SCORE ─────────────────────────────────────────────────────────
    @app.post("/assess", tags=["2 · score"])
    def assess(req: AssessRequest | None = Body(None)):
        req = req or AssessRequest()
        assets = load_assets()
        if not assets:
            raise HTTPException(409, "Nothing to assess: run /scan first.")
        estate = {e["id"]: e for e in db.query("SELECT * FROM estate")}
        ranked = scoring.assess(assets, estate, req.z_years)
        with db.tx() as c:
            for r in ranked:
                c.execute("UPDATE assets SET status=?, risk_score=?, mosca=? WHERE id=?", (r["status"], r["risk_score"], dumps(r["mosca"]), r["id"]))
        block = ledger.append("assessment", {
            "z_years": req.z_years,
            "method": "Mosca: X + Y > Z",
            "assets": [{k: r[k] for k in ("id", "signature_alg", "status", "risk_score", "mosca")} for r in ranked],
        })
        counts = {s: sum(1 for r in ranked if r["status"] == s) for s in ("forgeable", "vulnerable", "safe")}
        return {"z_years": req.z_years, "summary": counts, "ranked": ranked, "block": block}

    # ── Stage 3: DEFEND ────────────────────────────────────────────────────────
    @app.post("/remediate/demo", tags=["3 · defend"])
    def remediate(req: RemediateRequest | None = Body(None)):
        req = req or RemediateRequest()
        assets = load_assets()
        if not assets or all(a["status"] is None for a in assets):
            raise HTTPException(409, "Score the estate first: run /scan then /assess.")
        if req.asset_id:
            target = next((a for a in assets if a["id"] == req.asset_id), None)
            if not target:
                raise HTTPException(404, f"Unknown asset {req.asset_id}.")
        else:
            candidates = [a for a in assets if a["status"] == "forgeable" and a["signature_alg"] == "RSA-2048" and a["protocol"].startswith("TLS")]
            if not candidates:
                raise HTTPException(409, "No forgeable RSA-2048 TLS asset left to migrate.")
            target = max(candidates, key=lambda a: a["risk_score"] or 0)
        try:
            record = shield.upgrade(target)
        except shield.RemediationError as e:
            raise HTTPException(422, str(e)) from e

        after = record["after"]
        estate_row = db.one("SELECT * FROM estate WHERE id=?", (target["id"],))
        with db.tx() as c:
            c.execute("UPDATE estate SET signature_alg=?, key_exchange=?, protocol=?, migration_years=0 WHERE id=?",
                      (after["signature_alg"], after["key_exchange"], after["protocol"], target["id"]))
        rescored = scoring.score_asset({**target, **after}, estate_row["shelf_life_years"], 0, last_z())
        with db.tx() as c:
            c.execute(
                "UPDATE assets SET signature_alg=?, key_exchange=?, protocol=?, handshake=?, status=?, risk_score=?, mosca=? WHERE id=?",
                (after["signature_alg"], after["key_exchange"], after["protocol"], dumps(record["post_handshake"]),
                 rescored["status"], rescored["risk_score"], dumps(rescored["mosca"]), target["id"]),
            )
        record["risk_before"] = target["risk_score"]
        record["risk_after"] = rescored["risk_score"]
        record["status_after"] = rescored["status"]
        block = ledger.append("remediation", record)
        return {**record, "block": block}

    # ── Stage 4: PROVE ─────────────────────────────────────────────────────────
    @app.post("/attest/publish", tags=["4 · prove"])
    def attest():
        check = ledger.verify()
        if not check["valid"]:
            raise HTTPException(409, f"Refusing to attest a ledger that fails verification (first bad block #{check['first_invalid_block']}).")
        if not check["blocks_checked"]:
            raise HTTPException(409, "Ledger is empty.")
        head = {
            "log_id": hashlib.sha256(b"QuantumLedger/" + device_key()[:8]).hexdigest()[:16],
            "tree_size": check["blocks_checked"],
            "root_hash": check["merkle_root"],
            "timestamp": now_iso(),
        }
        # SIMULATED: stands in for an ML-DSA-65 signature from OpenSSL 3.5 / an HSM.
        sig = hmac.new(device_key(), dumps(head).encode(), hashlib.sha3_512).hexdigest()
        sth = {**head, "signature_algorithm": "ML-DSA-65 (FIPS 204)", "signature": sig, "signature_simulated": True}
        attest_dir.mkdir(parents=True, exist_ok=True)
        path = attest_dir / f"sth-{head['tree_size']:05d}.json"
        path.write_text(json.dumps(sth, indent=2))
        with db.tx() as c:
            c.execute("INSERT INTO attestations (ts, tree_size, root_hash, sth) VALUES (?,?,?,?)", (head["timestamp"], head["tree_size"], head["root_hash"], dumps(sth)))
        block = ledger.append("attestation", {"sth": sth, "published_to": str(path.name)})
        return {"sth": sth, "file": str(path), "block": block}

    @app.get("/ledger", tags=["4 · prove"])
    def ledger_blocks():
        return {"blocks": ledger.blocks()}

    @app.get("/ledger/verify", tags=["4 · prove"])
    def ledger_verify():
        return ledger.verify()

    @app.get("/ledger/proof/{idx}", tags=["4 · prove"])
    def ledger_proof(idx: int):
        try:
            return ledger.proof(idx)
        except IndexError as e:
            raise HTTPException(404, f"No block #{idx}.") from e

    @app.post("/ledger/tamper", tags=["4 · prove"])
    def ledger_tamper(req: TamperRequest | None = Body(None)):
        """DEMO: an insider edits a historical record directly in SQLite."""
        req = req or TamperRequest()
        try:
            result = ledger.tamper(req.idx)
        except LookupError as e:
            raise HTTPException(409, str(e)) from e
        except IndexError as e:
            raise HTTPException(404, f"No block #{req.idx}.") from e
        return {"tampered": result, "note": "Only the stored payload was changed; now call /ledger/verify."}

    @app.post("/restore", tags=["4 · prove"])
    def restore():
        """Repair the live ledger from the append-only replica, then re-verify."""
        result = ledger.restore()
        return {**result, "verification": ledger.verify()}

    # ── Utilities ──────────────────────────────────────────────────────────────
    @app.get("/assets", tags=["state"])
    def assets():
        return {"assets": load_assets()}

    @app.get("/health", tags=["state"])
    def health():
        return {"status": "ok", "db": str(db.path), "blocks": len(ledger.blocks())}

    @app.post("/reset", tags=["state"])
    def reset():
        """Wipe estate, scans and ledger for a fresh demo."""
        db.reset()
        prober.seed_estate(db)
        return {"reset": True}

    app.mount("/static", StaticFiles(directory=STATIC), name="static")

    @app.get("/", include_in_schema=False)
    def index():
        return FileResponse(STATIC / "index.html")

    return app


app = create_app()
