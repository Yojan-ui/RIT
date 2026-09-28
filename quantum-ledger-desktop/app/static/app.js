// QuantumLedger dashboard. Plain JS, talks only to the local FastAPI server.
'use strict';

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const short = (h, n = 12) => (h ? `${h.slice(0, n)}…${h.slice(-6)}` : '—');

const state = { verify: null, selected: null, migrated: new Set() };

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || `${res.status} ${res.statusText}`);
  return data;
}

// ── UI helpers ───────────────────────────────────────────────────────────────
let toastTimer;
function toast(msg, bad = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = `toast${bad ? ' bad' : ''}`;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 4200);
}

function log(msg, tone = '') {
  const li = document.createElement('li');
  li.innerHTML = `<time>${new Date().toLocaleTimeString([], { hour12: false })}</time><span class="${tone}">${msg}</span>`;
  $('#tab-log').prepend(li);
}

function stageResult(stage, html, tone = '') {
  const el = $(`#res-${stage}`);
  el.innerHTML = html;
  el.className = `stage-result ${tone}`;
  const card = document.querySelector(`.stage[data-stage="${stage}"]`);
  card.classList.toggle('done', tone !== 'bad');
  card.classList.toggle('alert', tone === 'bad');
}

function showTab(name) {
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll('.tab-panel').forEach((p) => (p.hidden = p.id !== `tab-${name}`));
}

const STANDARD = {
  'ML-DSA-65': 'FIPS 204 · Cat 3',
  'ML-DSA-87': 'FIPS 204 · Cat 5',
  X25519MLKEM768: 'FIPS 203 ML-KEM-768 + X25519',
  'mlkem768x25519-sha256': 'FIPS 203 ML-KEM-768 + X25519',
  'RSA-2048': 'Shor-breakable',
  'RSA-3072': 'Shor-breakable',
  'ECDSA-P256': 'Shor-breakable',
  'ECDSA-P384': 'Shor-breakable',
  X25519: 'Shor-breakable (HNDL)',
  'ECDHE-P256': 'Shor-breakable (HNDL)',
  'curve25519-sha256': 'Shor-breakable (HNDL)',
};

function riskColor(v) {
  if (v >= 70) return 'var(--bad)';
  if (v >= 35) return 'var(--warn)';
  return 'var(--ok)';
}

// Mosca only condemns Shor-breakable algorithms; for ML-DSA it's shown for reference.
function mosca(a) {
  const m = a.mosca;
  if (!m) return '—';
  const cmp = m.holds ? '&gt;' : '≤';
  if (a.status === 'safe') return `<span class="muted">${m.x}+${m.y} ${cmp} ${m.z}</span><div class="std">n/a · PQC</div>`;
  return `${m.x}+${m.y} <b style="color:${m.holds ? 'var(--bad)' : 'var(--ok)'}">${cmp}</b> ${m.z}`;
}

// ── Renderers ────────────────────────────────────────────────────────────────
function renderAssets(assets) {
  const body = $('#assets-body');
  if (!assets.length) {
    body.innerHTML = '<tr><td colspan="7" class="empty">Run <b>Scan Estate</b> to discover cryptographic assets.</td></tr>';
    return;
  }
  body.innerHTML = assets
    .map((a, i) => {
      const m = a.mosca;
      const scored = a.status != null;
      const risk = a.risk_score ?? 0;
      return `<tr class="${state.migrated.has(a.id) ? 'migrated' : ''}">
        <td class="mono muted">${scored ? i + 1 : '—'}</td>
        <td><div class="host">${esc(a.host)}:${a.port}</div><div class="svc">${esc(a.protocol)} · ${esc(a.service)} · ${esc(a.exposure)}</div></td>
        <td><div class="alg">${esc(a.signature_alg)}</div><div class="std">${esc(STANDARD[a.signature_alg] || '')}</div></td>
        <td><div class="alg">${esc(a.key_exchange)}</div><div class="std">${esc(STANDARD[a.key_exchange] || '')}</div></td>
        <td class="mosca">${mosca(a)}</td>
        <td>${scored ? `<div class="risk"><div class="risk-bar"><span style="width:${risk}%;background:${riskColor(risk)}"></span></div><span class="risk-num">${risk}</span></div>` : '<span class="muted">—</span>'}</td>
        <td>${scored ? `<span class="badge badge-${esc(a.status)}">${esc(a.status)}</span>` : '<span class="badge badge-none">unscored</span>'}</td>
      </tr>`;
    })
    .join('');
}

function renderLedger(blocks, verify) {
  $('#block-count').textContent = `${blocks.length} block${blocks.length === 1 ? '' : 's'}`;
  $('#merkle-root').textContent = verify?.recorded_head || '—';
  const altered = new Set(verify?.altered_blocks || []);
  const stale = new Set((verify?.failures || []).filter((f) => f.check === 'merkle_root').map((f) => f.idx));
  $('#blocks').innerHTML = blocks
    .slice()
    .reverse()
    .map((b) => {
      const cls = altered.has(b.idx) ? 'broken' : stale.has(b.idx) ? 'stale' : '';
      return `<li class="block ${cls} ${state.selected === b.idx ? 'selected' : ''}" data-idx="${b.idx}" title="Click for payload and Merkle inclusion proof">
        <span class="block-idx">#${b.idx}</span>
        <span class="block-kind">${esc(b.kind)}${altered.has(b.idx) ? ' · altered' : ''}</span>
        <span class="block-time">${esc(b.ts.replace('T', ' ').replace('+00:00', 'Z'))}</span>
        <span class="block-hash">${short(b.block_hash, 20)}</span>
      </li>`;
    })
    .join('');

  const banner = $('#verify-banner');
  const chip = $('#integrity');
  if (!verify || verify.blocks_checked === 0) {
    banner.className = 'banner banner-idle';
    banner.textContent = 'Not verified yet.';
    chip.className = 'chip';
    chip.textContent = 'Ledger not verified';
  } else if (verify.valid) {
    banner.className = 'banner banner-ok';
    banner.innerHTML = `✓ Hash chain and Merkle roots verified<small>${verify.blocks_checked} blocks · every payload re-hashed${verify.latest_attestation_matches ? ' · matches the signed tree head' : ''}</small>`;
    chip.className = 'chip ok';
    chip.textContent = '✓ Ledger verified';
  } else {
    const first = verify.failures.find((f) => f.idx === verify.first_invalid_block);
    banner.className = 'banner banner-bad';
    banner.innerHTML = `✗ Tampering detected at block #${verify.first_invalid_block}<small>${esc(first?.reason || '')} ${verify.roots_invalidated} Merkle root(s) invalidated${verify.latest_attestation_matches === false ? '; signed tree head no longer matches' : ''}.</small>`;
    chip.className = 'chip bad';
    chip.textContent = '✗ Tamper detected';
  }
}

async function showBlock(idx) {
  state.selected = idx;
  const [{ blocks }, proof] = await Promise.all([api('GET', '/ledger'), api('GET', `/ledger/proof/${idx}`)]);
  const b = blocks.find((x) => x.idx === idx);
  $('#tab-detail').textContent = JSON.stringify({ block: b, inclusion_proof: proof }, null, 2);
  showTab('detail');
  renderLedger(blocks, state.verify);
}

async function refresh({ verify = false } = {}) {
  const [{ assets }, { blocks }] = await Promise.all([api('GET', '/assets'), api('GET', '/ledger')]);
  if (verify) state.verify = await api('GET', '/ledger/verify');
  renderAssets(assets);
  renderLedger(blocks, state.verify);
  return { assets, blocks };
}

async function loadCbom() {
  try {
    const cbom = await api('GET', '/cbom');
    $('#tab-cbom').textContent = JSON.stringify(cbom, null, 2);
  } catch {
    /* no scan yet */
  }
}

// ── Actions ──────────────────────────────────────────────────────────────────
const actions = {
  async scan() {
    const r = await api('POST', '/scan');
    state.migrated.clear();
    await loadCbom();
    stageResult('detect', `${r.assets.length} endpoints · ${r.components} CBOM components · block #${r.block.idx}`, 'ok');
    log(`Scanned ${r.assets.length} endpoints; CBOM sha256 <span class="mono">${short(r.cbom_sha256)}</span> anchored as block #${r.block.idx}.`);
    showTab('cbom');
  },
  async assess() {
    const z = Number($('#z-years').value) || 7;
    const r = await api('POST', '/assess', { z_years: z });
    const s = r.summary;
    stageResult('score', `<b style="color:var(--bad)">${s.forgeable} forgeable</b> · ${s.vulnerable} vulnerable · ${s.safe} safe (Z = ${z})`, s.forgeable ? 'bad' : 'ok');
    const top = r.ranked[0];
    log(`Mosca assessment (Z = ${z}): ${s.forgeable} forgeable. Highest risk: ${esc(top.host)} (${esc(top.signature_alg)}, ${top.risk_score}). Block #${r.block.idx}.`, s.forgeable ? 'bad' : 'ok');
  },
  async remediate() {
    const r = await api('POST', '/remediate/demo');
    state.migrated.add(r.asset);
    stageResult('defend', `${esc(r.host)}: ${esc(r.before.signature_alg)} → <b>${esc(r.after.signature_alg)}</b> · risk ${r.risk_before} → ${r.risk_after}`, 'ok');
    $('#tab-evidence').textContent = JSON.stringify(r, null, 2);
    showTab('evidence');
    log(`Migrated ${esc(r.host)} to ${esc(r.after.signature_alg)} + ${esc(r.after.key_exchange)} (simulated OpenSSL 3.5). Evidence anchored as block #${r.block.idx}.`, 'ok');
  },
  async verify() {
    await refresh({ verify: true });
    const v = state.verify;
    if (v.valid) {
      stageResult('prove', `Verified ${v.blocks_checked} blocks · root ${short(v.merkle_root, 10)}`, 'ok');
      log(`Ledger verified: ${v.blocks_checked} blocks, root <span class="mono">${short(v.merkle_root)}</span>.`, 'ok');
    } else {
      stageResult('prove', `Tampering detected at block #${v.first_invalid_block}`, 'bad');
      log(`Verification FAILED: block #${v.first_invalid_block} altered; ${v.roots_invalidated} Merkle root(s) invalid.`, 'bad');
      toast(`Tampering detected at block #${v.first_invalid_block}`, true);
    }
    return true;
  },
  async attest() {
    const r = await api('POST', '/attest/publish');
    stageResult('prove', `Signed tree head: ${r.sth.tree_size} blocks · ${esc(r.sth.signature_algorithm)} (simulated)`, 'ok');
    log(`Published signed tree head (size ${r.sth.tree_size}, root <span class="mono">${short(r.sth.root_hash)}</span>) to ${esc(r.file.split('/').pop())}.`, 'ok');
  },
  async tamper() {
    if (!confirm('Demo: silently rewrite a historical ledger record in SQLite?')) return false;
    const r = await api('POST', '/ledger/tamper');
    const c = r.tampered.change;
    log(`Insider edit: block #${r.tampered.idx} (${esc(r.tampered.kind)}) ${esc(c.asset || '')} changed from "${esc(c.before)}" to "${esc(c.after)}". No hashes touched.`, 'bad');
    await actions.verify();
    return true;
  },
  async restore() {
    const r = await api('POST', '/restore');
    state.verify = r.verification;
    await refresh();
    stageResult('prove', r.repaired_blocks.length ? `Restored block(s) #${r.repaired_blocks.join(', #')} from replica · verified` : 'Nothing to restore · verified', 'ok');
    log(r.repaired_blocks.length ? `Restored block(s) #${r.repaired_blocks.join(', #')} from the append-only replica; ledger verifies again.` : 'Ledger already matched the replica.', 'ok');
  },
};

async function run(name, button) {
  document.querySelectorAll('button').forEach((b) => (b.disabled = true));
  try {
    const skipRefresh = await actions[name]();
    if (!skipRefresh) await refresh({ verify: state.verify !== null });
  } catch (e) {
    toast(e.message, true);
    log(esc(e.message), 'bad');
  } finally {
    document.querySelectorAll('button').forEach((b) => (b.disabled = false));
    button?.focus();
  }
}

// ── Wiring ───────────────────────────────────────────────────────────────────
document.querySelectorAll('[data-action]').forEach((b) => b.addEventListener('click', () => run(b.dataset.action, b)));
document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => showTab(t.dataset.tab)));
$('#blocks').addEventListener('click', (e) => {
  const li = e.target.closest('.block');
  if (li) showBlock(Number(li.dataset.idx)).catch((err) => toast(err.message, true));
});
$('#btn-reset').addEventListener('click', async () => {
  if (!confirm('Wipe the local demo database?')) return;
  await api('POST', '/reset');
  state.verify = null;
  state.selected = null;
  state.migrated.clear();
  ['detect', 'score', 'defend', 'prove'].forEach((s) => {
    $(`#res-${s}`).textContent = 'Not run';
    $(`#res-${s}`).className = 'stage-result';
    document.querySelector(`.stage[data-stage="${s}"]`).classList.remove('done', 'alert');
  });
  $('#tab-cbom').textContent = 'No CBOM yet.';
  $('#tab-evidence').textContent = 'No migration yet.';
  $('#tab-detail').textContent = 'Select a block in the ledger.';
  await refresh();
  log('Demo database reset.');
});

refresh({ verify: true }).then(loadCbom).catch((e) => toast(e.message, true));
log('QuantumLedger ready. All processing is local.');
