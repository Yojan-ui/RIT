"""PROVE: tamper-evident log = hash chain + Merkle tree.

Every block stores
  payload_hash  SHA-256 of the canonical JSON payload (the Merkle leaf)
  prev_hash     block_hash of the previous block (the chain)
  merkle_root   root over all leaves 0..idx (RFC 6962 style, so any old leaf can be proven)
  block_hash    SHA-256 over (idx, ts, kind, payload_hash, prev_hash, merkle_root)

Editing any stored payload breaks its payload_hash, and with it the Merkle root
of that block and every later one. Rewriting the hashes too breaks prev_hash
linkage and every published signed tree head.
"""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone

from .db import Database, dumps

GENESIS = "0" * 64
LEAF_PREFIX = b"\x00"
NODE_PREFIX = b"\x01"


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def canonical(obj) -> bytes:
    return dumps(obj).encode()


class MerkleTree:
    """Binary Merkle tree over leaf data, with domain-separated leaf/node hashing (RFC 6962 §2.1)."""

    def __init__(self, leaves: list[bytes]):
        self.levels: list[list[bytes]] = [[self.hash_leaf(x) for x in leaves]]
        while len(self.levels[-1]) > 1:
            level = self.levels[-1]
            nxt = []
            for i in range(0, len(level), 2):
                if i + 1 < len(level):
                    nxt.append(self.hash_node(level[i], level[i + 1]))
                else:
                    nxt.append(level[i])  # odd node is promoted, not duplicated
            self.levels.append(nxt)

    @staticmethod
    def hash_leaf(data: bytes) -> bytes:
        return hashlib.sha256(LEAF_PREFIX + data).digest()

    @staticmethod
    def hash_node(left: bytes, right: bytes) -> bytes:
        return hashlib.sha256(NODE_PREFIX + left + right).digest()

    def root(self) -> str:
        if not self.levels[0]:
            return sha256_hex(b"")
        return self.levels[-1][0].hex()

    def proof(self, index: int) -> list[dict]:
        """Audit path for leaf `index`: sibling hashes from the leaf up to the root."""
        path = []
        for level in self.levels[:-1]:
            sibling = index ^ 1
            if sibling < len(level):
                path.append({"side": "left" if sibling < index else "right", "hash": level[sibling].hex()})
            index //= 2
        return path

    @staticmethod
    def verify_proof(leaf_data: bytes, proof: list[dict], root: str) -> bool:
        h = MerkleTree.hash_leaf(leaf_data)
        for step in proof:
            sib = bytes.fromhex(step["hash"])
            h = MerkleTree.hash_node(sib, h) if step["side"] == "left" else MerkleTree.hash_node(h, sib)
        return h.hex() == root


def _block_hash(idx: int, ts: str, kind: str, payload_hash: str, prev_hash: str, merkle_root: str) -> str:
    return sha256_hex(
        canonical({"idx": idx, "ts": ts, "kind": kind, "payload_hash": payload_hash, "prev_hash": prev_hash, "merkle_root": merkle_root})
    )


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class Ledger:
    def __init__(self, db: Database):
        self.db = db

    def blocks(self) -> list[dict]:
        rows = self.db.query("SELECT * FROM ledger ORDER BY idx")
        for r in rows:
            r["payload"] = json.loads(r["payload"])
        return rows

    def append(self, kind: str, payload: dict) -> dict:
        """Anchor a payload as the next block (and mirror it to the replica)."""
        with self.db.tx() as c:
            rows = c.execute("SELECT idx, payload_hash, block_hash FROM ledger ORDER BY idx").fetchall()
            idx = len(rows)
            prev_hash = rows[-1]["block_hash"] if rows else GENESIS
            payload_json = dumps(payload)
            payload_hash = sha256_hex(payload_json.encode())
            leaves = [bytes.fromhex(r["payload_hash"]) for r in rows] + [bytes.fromhex(payload_hash)]
            merkle_root = MerkleTree(leaves).root()
            ts = now_iso()
            block_hash = _block_hash(idx, ts, kind, payload_hash, prev_hash, merkle_root)
            row = (idx, ts, kind, payload_json, payload_hash, prev_hash, merkle_root, block_hash)
            c.execute("INSERT INTO ledger VALUES (?,?,?,?,?,?,?,?)", row)
            c.execute("INSERT INTO ledger_replica VALUES (?,?,?,?,?,?,?,?)", row)
        return {
            "idx": idx, "ts": ts, "kind": kind, "payload_hash": payload_hash,
            "prev_hash": prev_hash, "merkle_root": merkle_root, "block_hash": block_hash,
        }

    def verify(self) -> dict:
        """Recompute everything from the stored payloads and compare with what was recorded."""
        rows = self.db.query("SELECT * FROM ledger ORDER BY idx")
        failures: list[dict] = []
        leaves: list[bytes] = []
        prev = GENESIS
        for r in rows:
            recomputed = sha256_hex(r["payload"].encode())
            if recomputed != r["payload_hash"]:
                failures.append({
                    "idx": r["idx"], "check": "payload_hash",
                    "reason": "Stored payload no longer matches its recorded SHA-256: the record was altered.",
                    "recorded": r["payload_hash"], "recomputed": recomputed,
                })
            if r["prev_hash"] != prev:
                failures.append({
                    "idx": r["idx"], "check": "prev_hash",
                    "reason": "Chain link broken: prev_hash does not match the previous block.",
                    "recorded": r["prev_hash"], "recomputed": prev,
                })
            leaves.append(bytes.fromhex(recomputed))
            root = MerkleTree(leaves).root()
            if root != r["merkle_root"]:
                failures.append({
                    "idx": r["idx"], "check": "merkle_root",
                    "reason": "Merkle root over the log up to this block does not match.",
                    "recorded": r["merkle_root"], "recomputed": root,
                })
            bh = _block_hash(r["idx"], r["ts"], r["kind"], r["payload_hash"], r["prev_hash"], r["merkle_root"])
            if bh != r["block_hash"]:
                failures.append({
                    "idx": r["idx"], "check": "block_hash",
                    "reason": "Block header hash does not match its fields.",
                    "recorded": r["block_hash"], "recomputed": bh,
                })
            prev = r["block_hash"]

        root_now = MerkleTree([bytes.fromhex(sha256_hex(r["payload"].encode())) for r in rows]).root() if rows else None
        attested = self.db.one("SELECT tree_size, root_hash FROM attestations ORDER BY id DESC LIMIT 1")
        attestation_ok = None
        if attested and attested["tree_size"] <= len(rows):
            prefix = [bytes.fromhex(sha256_hex(r["payload"].encode())) for r in rows[: attested["tree_size"]]]
            attestation_ok = MerkleTree(prefix).root() == attested["root_hash"]

        altered = sorted({f["idx"] for f in failures if f["check"] == "payload_hash"})
        return {
            "valid": not failures and attestation_ok is not False,
            "blocks_checked": len(rows),
            "first_invalid_block": min((f["idx"] for f in failures), default=None),
            "altered_blocks": altered,
            "roots_invalidated": len({f["idx"] for f in failures if f["check"] == "merkle_root"}),
            "merkle_root": root_now,
            "recorded_head": rows[-1]["merkle_root"] if rows else None,
            "latest_attestation_matches": attestation_ok,
            "failures": failures,
        }

    def proof(self, idx: int) -> dict:
        rows = self.db.query("SELECT payload_hash, merkle_root FROM ledger ORDER BY idx")
        if not 0 <= idx < len(rows):
            raise IndexError(idx)
        leaves = [bytes.fromhex(r["payload_hash"]) for r in rows]
        tree = MerkleTree(leaves)
        path = tree.proof(idx)
        return {
            "idx": idx,
            "leaf": rows[idx]["payload_hash"],
            "tree_size": len(rows),
            "root": tree.root(),
            "audit_path": path,
            "verified": MerkleTree.verify_proof(leaves[idx], path, tree.root()),
        }

    def tamper(self, idx: int | None = None) -> dict:
        """DEMO ONLY: silently rewrite a historical record, the way an insider with DB access would.

        By default it falsifies the earliest risk assessment: the forgeable
        RSA-2048 asset is relabelled as quantum-safe ML-DSA-65 so it would pass
        an audit. Falls back to the earliest scan block. Only the payload column
        changes; no hashes are touched.
        """
        rows = self.db.query("SELECT idx, kind, payload FROM ledger ORDER BY idx")
        if not rows:
            raise LookupError("Ledger is empty: run a scan first.")
        if idx is None:
            target = next((r for r in rows if r["kind"] == "assessment"), None) or next((r for r in rows if r["kind"] == "scan"), rows[0])
        else:
            target = next((r for r in rows if r["idx"] == idx), None)
            if target is None:
                raise IndexError(idx)
        payload = json.loads(target["payload"])
        assets = payload.get("assets", [])
        victim = next((a for a in assets if a.get("signature_alg") == "RSA-2048"), None) or next(
            (a for a in assets if str(a.get("signature_alg", "")).startswith(("RSA", "ECDSA"))), None
        )
        if victim:
            before = victim["signature_alg"] + (f" / {victim['status']}" if "status" in victim else "")
            victim["signature_alg"] = "ML-DSA-65"
            if "status" in victim:
                victim["status"] = "safe"
                victim["risk_score"] = 0.0
            after = "ML-DSA-65" + (" / safe" if "status" in victim else "")
            change = {"asset": victim.get("id"), "field": "signature_alg" + ("/status" if "status" in victim else ""), "before": before, "after": after}
        else:
            payload["_tampered"] = True
            change = {"asset": None, "field": "payload", "before": None, "after": "_tampered: true"}
        with self.db.tx() as c:
            c.execute("UPDATE ledger SET payload = ? WHERE idx = ?", (dumps(payload), target["idx"]))
        return {"idx": target["idx"], "kind": target["kind"], "change": change}

    def restore(self) -> dict:
        """Put back every block that differs from the append-only replica."""
        live = {r["idx"]: r for r in self.db.query("SELECT * FROM ledger")}
        replica = self.db.query("SELECT * FROM ledger_replica ORDER BY idx")
        repaired = []
        with self.db.tx() as c:
            for r in replica:
                if live.get(r["idx"]) != r:
                    c.execute("INSERT OR REPLACE INTO ledger VALUES (?,?,?,?,?,?,?,?)", tuple(r.values()))
                    repaired.append(r["idx"])
            extra = set(live) - {r["idx"] for r in replica}
            for idx in extra:
                c.execute("DELETE FROM ledger WHERE idx = ?", (idx,))
        return {"repaired_blocks": repaired, "removed_blocks": sorted(extra)}
