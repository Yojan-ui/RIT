#!/usr/bin/env node
// Regenerates the slide screenshot pack in docs/screenshots/ (light theme, 2x, internet blocked).
//
//   scripts/demo.sh &                  # dashboard on http://127.0.0.1:8000
//   node scripts/screenshots.mjs       # BASE_URL=... and CHROME=/path/to/chrome to override
//
// Drives Chrome over the DevTools protocol with Node's built-in WebSocket (Node 22+), so it needs
// no npm packages. Every host except 127.0.0.1 is unresolvable while shooting, which doubles as
// proof that the demo domains need no internet connection.
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "docs", "screenshots");
const BASE = (process.env.BASE_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9333;
const OFFLINE_SCANNER = pathToFileURL(join(ROOT, "offline_scanner.html")).href;

const SHOTS = [
  { file: "01-dashboard-grade-c.png", url: `${BASE}/?domain=monitor-only.example`, width: 1440, clip: { top: 0, height: 1180 }, wait: "narrative" },
  { file: "02-score-and-fix-grade-f.png", url: `${BASE}/?domain=unprotected.example`, width: 1440, selector: "#result > div.grid" },
  { file: "03-clean-domain-grade-a.png", url: `${BASE}/?domain=hardened.example`, width: 1440, selector: "#result > div.grid" },
  { file: "04-attack-path-matrix.png", url: `${BASE}/?domain=rollout.example#attack-matrix`, width: 1440, selector: "#attack-matrix", checkScroll: true },
  { file: "05-narrative.png", url: `${BASE}/?domain=unprotected.example`, width: 1440, selector: 'section[aria-labelledby="narrative-heading"]', wait: "narrative" },
  { file: "06-browser-edition.png", url: `${OFFLINE_SCANNER}?domain=no-dmarc.example`, width: 1440, clip: { top: 0, height: 1250 }, wait: "browser" },
  { file: "07-mobile.png", url: `${BASE}/?domain=monitor-only.example`, width: 390, height: 844, mobile: true, clip: { top: 0, height: 1800 } },
];

const READY = {
  scan: "!!document.querySelector('#attack-matrix')",
  narrative: "!!document.querySelector('#narrative > div, #narrative > p.mt-5')",
  browser: "!!document.querySelector('.mrow')",
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((ok, fail) => { ws.onopen = ok; ws.onerror = fail; });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) {
      const { ok, fail } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? fail(new Error(`${msg.error.message}`)) : ok(msg.result);
    }
  };
  const send = (method, params = {}) => new Promise((ok, fail) => {
    pending.set(++id, { ok, fail });
    ws.send(JSON.stringify({ id, method, params }));
  });
  return { send, close: () => ws.close() };
}

async function evaluate(page, expression) {
  const { result } = await page.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  return result.value;
}

async function waitFor(page, expression, what, timeoutMs = 20000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await evaluate(page, expression)) return;
    await sleep(150);
  }
  throw new Error(`timed out waiting for ${what}`);
}

async function shoot(page, shot) {
  const height = shot.height || 1000;
  await page.send("Emulation.setDeviceMetricsOverride", {
    width: shot.width, height, deviceScaleFactor: shot.mobile ? 3 : 2, mobile: !!shot.mobile,
  });
  await page.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });
  await page.send("Page.navigate", { url: shot.url });
  await waitFor(page, shot.wait === "browser" ? READY.browser : READY.scan, "the scan result");
  if (shot.wait === "narrative") await waitFor(page, READY.narrative, "the narrative");
  await evaluate(page, "document.fonts.ready.then(() => true)");
  await sleep(700); // let the postmark animation finish

  if (shot.checkScroll) {
    const y = await evaluate(page, "window.scrollY");
    if (!(y > 0)) throw new Error(`expected the #attack-matrix deep link to scroll the page, scrollY=${y}`);
    console.log(`    deep link scrolled to y=${Math.round(y)}`);
  }

  let clip;
  if (shot.selector) {
    const r = await evaluate(page, `(() => { const el = document.querySelector(${JSON.stringify(shot.selector)});
      if (!el) return null; const b = el.getBoundingClientRect();
      return { x: b.left + scrollX - 16, y: b.top + scrollY - 16, width: b.width + 32, height: b.height + 32 }; })()`);
    if (!r) throw new Error(`selector not found: ${shot.selector}`);
    clip = { ...r, scale: 1 };
  } else {
    clip = { x: 0, y: shot.clip.top, width: shot.width, height: shot.clip.height, scale: 1 };
  }
  const { data } = await page.send("Page.captureScreenshot", { format: "png", clip, captureBeyondViewport: true });
  writeFileSync(join(OUT, shot.file), Buffer.from(data, "base64"));
  console.log(`  ${shot.file}`);
}

async function pdfPage() {
  // Page 1 of the PDF audit report, rasterised with macOS PDFKit when available.
  if (process.platform !== "darwin" || spawnSync("which", ["swift"]).status !== 0) {
    console.log("  (skipped 08-pdf-report.png: needs macOS with swift)");
    return;
  }
  const res = await fetch(`${BASE}/api/v1/scan/monitor-only.example/pdf`);
  const dir = mkdtempSync(join(tmpdir(), "sms-pdf-"));
  const pdf = join(dir, "report.pdf");
  writeFileSync(pdf, Buffer.from(await res.arrayBuffer()));
  const swift = join(dir, "raster.swift");
  writeFileSync(swift, `import PDFKit\nimport AppKit
let doc = PDFDocument(url: URL(fileURLWithPath: CommandLine.arguments[1]))!
let img = doc.page(at: 0)!.thumbnail(of: NSSize(width: 1654, height: 2339), for: .mediaBox)
let rep = NSBitmapImageRep(data: img.tiffRepresentation!)!
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: CommandLine.arguments[2]))\n`);
  const run = spawnSync("swift", [swift, pdf, join(OUT, "08-pdf-report.png")], { stdio: "inherit" });
  rmSync(dir, { recursive: true, force: true });
  if (run.status !== 0) throw new Error("PDF rasterisation failed");
  console.log("  08-pdf-report.png");
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const profile = mkdtempSync(join(tmpdir(), "sms-chrome-"));
  const chrome = spawn(CHROME, [
    "--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run", "--allow-file-access-from-files",
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost",
    "about:blank",
  ], { stdio: "ignore" });
  try {
    let target;
    for (let i = 0; i < 50 && !target; i++) {
      try { target = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: "PUT" })).json(); }
      catch { await sleep(200); }
    }
    if (!target) throw new Error(`Chrome did not start (CHROME=${CHROME})`);
    const page = await cdp(target.webSocketDebuggerUrl);
    await page.send("Page.enable");
    await page.send("Runtime.enable");
    console.log(`Writing screenshots to ${OUT}`);
    for (const shot of SHOTS) await shoot(page, shot);
    page.close();
    await pdfPage();
  } finally {
    chrome.kill();
    rmSync(profile, { recursive: true, force: true });
  }
}

main().catch((e) => { console.error(`error: ${e.message}`); process.exit(1); });
