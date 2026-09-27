#!/usr/bin/env python3
"""Keep the browser edition's generated parts in sync. Run after editing either source:

  - app/demo/zones.json      -> embedded in offline_scanner.html (<script id="demo-zones">)
  - offline_scanner.html     -> docs/index.html (the copy GitHub Pages serves)

Usage: python scripts/sync_browser_edition.py
"""

from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HTML = ROOT / "offline_scanner.html"
PAGES = ROOT / "docs" / "index.html"
ZONES = ROOT / "app" / "demo" / "zones.json"
BLOCK = re.compile(r'(<script id="demo-zones" type="application/json">)(.*?)(</script>)', re.S)


def embedded_zones_json() -> str:
    data = json.loads(ZONES.read_text())
    # Compact, and "</" escaped so record text can never close the <script> element early.
    return json.dumps(data, separators=(",", ":")).replace("</", "<\\/")


def main() -> None:
    html = HTML.read_text()
    if not BLOCK.search(html):
        raise SystemExit('offline_scanner.html has no <script id="demo-zones" type="application/json"> block')
    html = BLOCK.sub(lambda m: m.group(1) + embedded_zones_json() + m.group(3), html, count=1)
    HTML.write_text(html)
    PAGES.parent.mkdir(exist_ok=True)
    PAGES.write_text(html)
    (PAGES.parent / ".nojekyll").touch()
    print(f"synced demo zones into {HTML.name} and copied it to {PAGES.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
