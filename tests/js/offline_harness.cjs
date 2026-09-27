// Runs the engine embedded in offline_scanner.html under Node, fully offline.
// Usage: node offline_harness.cjs <path/to/offline_scanner.html>  (job JSON on stdin, results JSON on stdout)
// Job keys (all optional):
//   scenarios: {name: {domain, dkim_selectors, zone, http}}  -> scan results per scenario
//   domains:   [raw input, ...]                                -> normalizeDomain results or {error}
//   rdata:     [[type, data], ...]                             -> normalizeRdata results
//   rsa:       [base64 SPKI, ...]                              -> RSA modulus bits
//   demos:     [demo domain, ...]                              -> scans via the page's embedded demo zones
"use strict";
const fs = require("fs");
const vm = require("vm");

const html = fs.readFileSync(process.argv[2], "utf8");
const match = html.match(/<script id="engine">([\s\S]*?)<\/script>/);
if (!match) throw new Error("engine script not found");
const sandbox = { module: { exports: {} }, URL, atob, setTimeout, clearTimeout, AbortController, console };
vm.runInNewContext(match[1], sandbox, { filename: "offline_scanner.html#engine" });
const SMS = sandbox.module.exports;

function fakeResolver(zone) {
  return {
    async query(name, type) {
      const z = zone[name];
      if (!z) return { records: [], nxdomain: true };
      if (z.ERROR) return { records: [], error: z.ERROR };
      return { records: [...(z[type] || [])] };
    },
  };
}
function fakeHttp(routes) {
  return {
    async get(url) {
      if (!(url in routes)) throw new Error("no route (test)");  // a plain network failure, not a CORS block
      return { status: 200, redirected: false, text: routes[url], contentType: "text/plain" };
    },
  };
}

(async () => {
  const job = JSON.parse(fs.readFileSync(0, "utf8"));
  const out = {};
  if (job.scenarios) {
    out.scenarios = {};
    for (const [name, sc] of Object.entries(job.scenarios)) {
      out.scenarios[name] = await SMS.scanDomain(sc.domain, {
        resolver: fakeResolver(sc.zone), http: fakeHttp(sc.http || {}), dkimSelectors: sc.dkim_selectors || [],
      });
    }
  }
  if (job.demos) {
    // Scan through the page's own demo ports and embedded zones, exactly as the UI does.
    const embedded = JSON.parse(html.match(/<script id="demo-zones" type="application\/json">([\s\S]*?)<\/script>/)[1]);
    out.demos = {};
    for (const domain of job.demos) {
      out.demos[domain] = await SMS.scanDomain(domain, { ...SMS.createDemoPorts(embedded[domain]), dkimSelectors: [] });
    }
  }
  if (job.domains) out.domains = job.domains.map((d) => { try { return SMS.normalizeDomain(d); } catch (e) { return { error: e.message }; } });
  if (job.rdata) out.rdata = job.rdata.map(([type, data]) => SMS.normalizeRdata(type, data));
  if (job.rsa) out.rsa = job.rsa.map((b64) => SMS.rsaBits(SMS.b64decode(b64)).bits);
  process.stdout.write(JSON.stringify(out));
})().catch((e) => { console.error(e.stack || e); process.exit(1); });
