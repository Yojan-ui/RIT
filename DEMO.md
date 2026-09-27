# Demo-day guide

A five-minute walkthrough for the judges, a fallback plan, and answers to the questions they are likely to ask. Everything here works **with no internet connection**.

---

## Before you leave (while online)

```bash
git pull
scripts/demo.sh check
```

The first run creates `.venv`, installs the Python and Node.js dependencies and builds the React web app (Node.js 20.19+ must be installed). It then scans every demo domain **with the network blocked** and prints:

```
ok  hardened.example         100/100  grade A  (Fully hardened)
ok  rollout.example           86/100  grade B  (Mid-rollout)
ok  monitor-only.example      70/100  grade C  (Monitor-only DMARC)
ok  no-dmarc.example          60/100  grade D  (No DMARC)
ok  unprotected.example        0/100  grade F  (Unprotected)
```

If you see five `ok` lines, the laptop is ready. After that nothing needs the internet.

Also before you leave:

- **Optional: Claude narratives.** `export ANTHROPIC_API_KEY=...` before starting. Without a key, or without internet, the built-in writer produces the narrative instead. Nothing breaks either way.
- **Bookmark these** (they scan on load):
  - http://127.0.0.1:8000/?domain=unprotected.example
  - http://127.0.0.1:8000/?domain=monitor-only.example
  - http://127.0.0.1:8000/?domain=hardened.example
  - http://127.0.0.1:8000/?domain=rollout.example

## At the venue

```bash
scripts/demo.sh
```

Open **http://127.0.0.1:8000**. The five demo domains are the **Demo targets** under the command line; the letter before each is its grade.

---

## The five-minute walkthrough

| Time | Show | Say |
|---|---|---|
| **0:00** | Terminal, empty | "Most phishing and invoice fraud works because a mail server accepts a message that *claims* to come from a trusted domain. The fixes exist (SPF, DKIM, DMARC, MTA-STS), but they fail silently, they're hard to read, and nobody knows which to fix first." |
| **0:30** | Demo target **unprotected.example** | "Grade F, zero out of 100. Six of seven attack paths open, red across the matrix and in the 3D view. **Priority fix**: one DNS record, written out, with a copy button." Point at the DKIM row: "DKIM says *N/A*, not *failing*. DKIM keys live at secret names we can't list, so we don't guess, and it's left out of the score. Honesty is a design rule here." |
| **1:30** | Demo target **monitor-only.example** | "Grade C, 70. Everything is configured except DMARC is set to `p=none`, which only *reports* spoofing and still delivers it. The one fix is worth **+30 points** and closes two attack paths. This is the most common real-world mistake." Scroll to **Briefing**: "A plain-English explanation of what an attacker would do, written only from the findings, by Claude when a key is set, and checked against the engine before it's shown." |
| **2:30** | Demo target **hardened.example** | "A perfectly configured domain scores 100 and we invent nothing to fix: *All seven attack paths are defended. Nothing to fix.* A checker that always finds something isn't trustworthy." |
| **3:00** | Demo target **rollout.example**, the **Attack matrix** | "The matrix is the heart of it. Rows are what an attacker can do; columns are the controls that stop it. Each dot shows how well that control defends *that particular* attack. This domain is partly open on four paths: rollout loose ends, not disasters." Click a row to show how the attack works. Then point at a vector in the 3D view: "Red vectors are open, and the packets are attack traffic reaching the core; amber packets die halfway because the control only partly holds." Pointing lights up the matching matrix row; clicking opens it. |
| **3:45** | **PDF** under the priority fix | "A formal audit report: executive summary, the priority fix, every finding with its RFC-based recommendation, and a methodology section. Demo reports are labelled as demonstrations." |
| **4:15** | Back to the terminal | "284 automated tests, all offline, including a contract test that keeps the web app's types identical to the backend's models." |

If the Wi-Fi works and you have time, scan a real domain the judges suggest. Real results change as domains change their DNS, so don't promise a grade in advance.

---

## If something goes wrong

| Problem | What to do |
|---|---|
| No Wi-Fi | Nothing to do. Demo domains, the web app and the PDF all work offline. Real domains need DNS, so they won't scan. |
| Venue Wi-Fi blocks outbound port 25 | Real scans report STARTTLS as *not assessed* and leave it out of the score. This is intended behaviour and a good talking point. |
| The web app won't start | Run `scripts/demo.sh check` to see which step fails, then show the screenshot pack in `docs/screenshots/`. |
| The Claude narrative doesn't appear | It falls back to the built-in writer automatically (the footer says which writer was used). |
| A grade looks different from this guide | Run `scripts/demo.sh check`. It verifies all five demo grades with the network blocked. |

---

## Questions judges are likely to ask

**What happens with a perfectly configured domain?**
It scores 100 and gets "nothing to fix". Show *Fully hardened*. This is covered by an automated test.

**What if the scanner's network blocks port 25, as most cloud hosts do?**
The scanner first checks whether it can reach a known-good mail server. If it can't, the problem is on our side, so STARTTLS is marked *not assessed* and removed from the score's denominator. It is never counted as the domain's failure. Also covered by a test.

**What stops the AI from making things up?**
The model only receives the engine's findings. Its output is checked before it is shown: it's rejected if it states a different score or grade, cites a finding that doesn't exist, or proposes fixes when nothing is wrong. Rejected output is replaced by the built-in writer, never shown with a caveat.

**Why is DMARC worth 30 points?**
It's the only control that tells receiving servers to *reject* forged mail. SPF and DKIM produce a verdict; DMARC acts on it. A domain with perfect SPF and DKIM and no DMARC can still be spoofed.

**Are the demo domains fake?**
Their DNS records are fixed, so the demo is repeatable, but the real checkers, scoring, attack paths and fix logic run on them. They use `.example`, a name reserved by RFC 2606 that can never be a real domain, and they are labelled as demos on screen and in the PDF.

**Can it check DKIM properly?**
DKIM keys are published at "selectors" that can't be listed through DNS. We probe 16 common ones, and if you give us your selector we assess the key exactly: size, algorithm, testing mode.

**How do you know it's correct?**
284 tests, all running without internet: every rule of every attack path, complete scenario domains, the PDF, the AI validator, and the frontend's API contract. Each check cites its RFC.

---

## Reference numbers

| Demo domain | Chip | Grade | Fix this first |
|---|---|---|---|
| `hardened.example` | Fully hardened | **A** 100 | Nothing to fix |
| `rollout.example` | Mid-rollout | **B** 86 | Strengthen DKIM |
| `monitor-only.example` | Monitor-only DMARC | **C** 70 | Enforce your DMARC policy (+30) |
| `no-dmarc.example` | No DMARC | **D** 60 | Publish a DMARC policy |
| `unprotected.example` | Unprotected | **F** 0 | Publish a DMARC policy |

## Screenshots for slides

`docs/screenshots/` holds high-resolution captures of the terminal, all taken with the internet blocked:

| File | Use it for |
|---|---|
| `01-terminal-overview.png` | The overview slide: 3D posture, score, attack matrix and fix together |
| `02-priority-fix-grade-f.png` | The problem and its one fix: an unprotected domain |
| `03-clean-domain-grade-a.png` | "A clean domain scores 100, with nothing invented" |
| `04-attack-matrix.png` | How findings become attack paths |
| `05-briefing.png` | The plain-English / AI explanation |
| `06-posture-3d.png` | The 3D posture view on its own |
| `07-mobile.png` | Responsive design |
| `08-pdf-report.png` | The audit report |

To regenerate them after a UI change: start `scripts/demo.sh`, then run `node scripts/screenshots.mjs` (Node 22+ and Google Chrome).
