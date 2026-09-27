# How SecureMailScope scores a domain

The score comes from a fixed checklist, not a model. The same DNS answers always produce the same number, which makes it checkable, but the weights and deductions are the project's own judgement, not an industry standard.

The logic is in [`backend/app/analysis/checks.py`](backend/app/analysis/checks.py) (per-check rules) and [`backend/app/analysis/scoring.py`](backend/app/analysis/scoring.py) (overall score, grade, attack paths and The One Fix).

## 1. How a score is produced

### Step 1: each check has a weight, and the weights add up to 100

| SPF | DKIM | DMARC | MX | STARTTLS | MTA-STS | TLS-RPT |
|---|---|---|---|---|---|---|
| 15 | 15 | 25 | 10 | 15 | 12 | 8 |

Source: `WEIGHTS` in `checks.py`.

### Step 2: each check earns a fraction (0 to 1) of its weight

Every level is a hard-coded rule based on what DNS (or the port-25 probe) returned:

| Check | Rule → fraction earned |
|---|---|
| **SPF** | `-all` = 1.0 · `~all` = 0.8 · redirect only = 0.8 · `?all` or no `all` = 0.3 · `+all` or missing = 0 · more than 10 DNS lookups = 0.2 (permerror, RFC 7208) · two or more SPF records = 0 |
| **DKIM** | 2048-bit key = 1.0 · 1024-bit key = 0.7 · under 1024 bits = 0.3 · no key found = 0 |
| **DMARC** | `p=reject` = 1.0 · `p=quarantine` = 0.8 · `p=none` = 0.3 · then × (0.5 + 0.5 × pct/100) if `pct<100` · −0.15 for `sp=none` · −0.1 if there is no `rua=` · missing or invalid = 0 |
| **MX** | all hosts resolve = 1.0 · some don't resolve = 0.7 · none resolve = 0.3 · no MX = 0.2 |
| **STARTTLS** | valid certificate on TLS 1.2+ = 1.0 · bad certificate = 0.6 · TLS 1.0/1.1 = 0.4 · no STARTTLS = 0 |
| **MTA-STS** | `mode: enforce` covering every MX = 1.0 · `testing` = 0.5 · `none` = 0.2 · enforce but missing an MX host = 0.2 · policy file unavailable or malformed = 0.1 · missing = 0 |
| **TLS-RPT** | valid `rua=` = 1.0 · invalid = 0.2 · missing = 0 |

### Step 3: overall score

```
score = round(100 × points earned ÷ points possible)
```

Checks that don't apply or couldn't be measured are removed from **both** sides of the division. Examples:

- A domain with a null MX receives no mail, so STARTTLS, MTA-STS and TLS-RPT drop out.
- If the scanner's outbound port 25 is blocked, STARTTLS is excluded instead of counting as a fail.

Source: `overall_score` in `scoring.py`.

### Step 4: grade

| Score | Grade |
|---|---|
| ≥ 90 | A |
| ≥ 80 | B |
| ≥ 65 | C |
| ≥ 50 | D |
| below 50 | F |

## 2. Worked example: `legacy-corp.example` (demo) → 58, grade D

| Check | Finding | Points |
|---|---|---|
| SPF | 13 DNS lookups (limit is 10) | 0.2 × 15 = 3 |
| DKIM | 1024-bit key | 0.7 × 15 = 10.5 |
| DMARC | `p=reject`, but `pct=25` and `sp=none` | 0.47 × 25 = 11.75 |
| MX | 3 hosts, all resolve | 1.0 × 10 = 10 |
| STARTTLS | certificate hostname mismatch | 0.6 × 15 = 9 |
| MTA-STS | testing mode | 0.5 × 12 = 6 |
| TLS-RPT | valid | 1.0 × 8 = 8 |
| **Total** | | **58.25 / 100 → 58 (D)** |

The DMARC line: 1.0 × (0.5 + 0.5 × 0.25) = 0.625, then 0.625 − 0.15 for `sp=none` = 0.475, stored as 0.47.

## 3. How The One Fix projection is checked

The "58 → 72" projection is not an estimate. For each candidate record (DMARC, SPF, DKIM, MTA-STS, TLS-RPT), the backend:

1. applies the record to a copy of the scan data;
2. re-runs the whole analysis (checks, score, attack paths);
3. records which attack paths went from open to closed and what the new score is.

The fix that closes the most severity-weighted attack paths wins. Ties go to the bigger score gain, then to the least effort (paste one record < record + hosted file < needs mail provider).

Source: `_rank_fixes` in `scoring.py`. The dashboard's remediation panel reuses these exact records, so its "+N pts" always matches.

### The fix plan

The dashboard's **Fix plan** panel extends the same simulation into a sequence (`plan_fixes` in `scoring.py`): apply the best fix, re-run the analysis, pick the next best fix on top of it, and repeat. Later steps therefore see what earlier ones unlocked (SPF before DMARC enforcement, STARTTLS before MTA-STS). Unlike The One Fix, the plan may include the server-side STARTTLS change. Every "after" score and badge in the plan is a re-run of the scoring engine, not an estimate. Paths that no simulated fix can close (e.g. an SPF record over the 10-lookup limit, which needs manual trimming) are listed as remaining.

The hands-on time per step (about 5 min to paste a DNS record, 30 min for a record plus a hosted file, 20 min for a mail-provider key, 1 h for a mail-server change) is guidance, not measured. It lives in `EFFORT_INFO` in `frontend/src/lib/meta.ts`.

## 4. What is tested

The backend tests (119 passing) include these checks in `backend/tests/test_analysis.py`:

- the weights add up to 100;
- SPF over 10 lookups is a permerror, and multiple SPF records are invalid;
- DMARC `pct` and a missing `rua` lower the score;
- the fortress demo scores exactly 100, with no fix recommended;
- DMARC is never pushed to enforcement while SPF or DKIM is broken (it would reject the domain's own mail);
- the legacy-corp fix drops `pct` and `sp=none`;
- an unreachable port 25 is left out of the score rather than failed;
- the fix plan: empty for a perfect domain, each step builds on the previous score, the first DNS step matches The One Fix, prerequisites come first, and paths it can't close are reported.

Run them with:

```bash
cd backend && .venv/bin/python -m pytest -q
```

## 5. What is *not* validated

- **The weights are editorial.** DMARC being worth 25 and MX 10 is a judgement about impact. It isn't calibrated against breach data or matched to another scanner. The pass/fail rules follow the RFCs (7208 SPF, 6376 DKIM, 7489 DMARC, 8461 MTA-STS, 8460 TLS-RPT, 8996 legacy TLS), but how many points each rule is worth is our choice.
- **DKIM can be under-counted.** DNS can't list a domain's DKIM selectors, so the scanner tries common names. A domain signing with an unusual selector shows as "missing" unless you rescan with `?dkim_selectors=name`.
- **The STARTTLS result depends on where the scanner runs.** Many cloud and home networks block outbound port 25. When that happens the check is skipped, which also means the certificate and TLS version are never checked.
- **No comparison with other tools.** The scores haven't been checked against tools such as MXToolbox, Hardenize or internet.nl.

## 6. Suggested next step for credibility

Build a small test suite that scans 5 to 10 well-known real domains and, for each check, puts SecureMailScope's finding next to what MXToolbox or internet.nl reports. Record any differences and explain them. That turns "trust our rubric" into "here is where we agree with established tools, and why we differ where we do."
