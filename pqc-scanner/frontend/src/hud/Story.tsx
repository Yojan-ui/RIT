// The Harvest-Now-Decrypt-Later narrative, drawn in the hologram's own space (child of the
// fitted root group). Every beat is driven by real pipeline state; timings only choreograph
// the transition between two real states.
import { useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { hudAnchor, type Story } from './anchor'

const R = 1.5 // globe radius, same as HudGlobe

const CRIMSON = new THREE.Color('#ef4444')
const EMERALD = new THREE.Color('#10b981')
const CYAN = new THREE.Color('#06b6d4')
const ICE = new THREE.Color('#67e8f9')
const STEEL = new THREE.Color('#577c95')

const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x * R, y * R, z * R)

// client ↔ server link sags under the globe's front face; the tap sits at its lowest point
const P_CLIENT = v3(-1.85, -0.25, 0.35)
const P_SERVER = v3(1.85, -0.25, 0.35)
const CURVE = new THREE.QuadraticBezierCurve3(P_CLIENT, v3(0, -1.95, 1.1), P_SERVER)
const P_TAP = CURVE.getPoint(0.5)
const VAULT_R = 0.3 * R
const VAULT_H = 0.42 * R
const P_VAULT = v3(0, -1.9, 0.75)
const P_INTAKE = P_VAULT.clone().add(new THREE.Vector3(0, VAULT_H / 2 + 0.1 * R, 0))
const SHIELD_R = 0.28 * R
const P_CONTACT = P_TAP.clone().add(P_INTAKE.clone().sub(P_TAP).normalize().multiplyScalar(SHIELD_R))

// Merkle tree above the globe: 4 leaf slots (3 stage records + duplicate), 2 inner nodes, root inside the block
const Z_TREE = 0.2
const LEAVES = [-0.72, -0.24, 0.24, 0.72].map((x) => v3(x, 1.32, Z_TREE))
const INNER = [v3(-0.48, 1.58, Z_TREE), v3(0.48, 1.58, Z_TREE)]
const P_BLOCK = v3(0, 1.86, Z_TREE)
const P_PREV = v3(-0.78, 1.86, Z_TREE)
const P_NEXT = v3(0.78, 1.86, Z_TREE)

const ANCHORS: Record<string, THREE.Vector3> = {
  client: P_CLIENT,
  server: P_SERVER,
  tap: P_TAP,
  vault: P_VAULT,
  vaultBase: P_VAULT.clone().add(new THREE.Vector3(0, -VAULT_H / 2, 0)),
  mosca: v3(0, 1.28, 0.2),
  top: v3(0, 1.22, 0),
  block: P_BLOCK,
  prev: P_PREV,
  next: P_NEXT,
  leaf0: LEAVES[0],
  leaf1: LEAVES[1],
  leaf2: LEAVES[2],
}

const ease = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t))
const clamp01 = (t: number) => Math.min(1, Math.max(0, t))

function segs(p: number[]) {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3))
  return g
}

function ring(r: number, n = 64, plane: 'xz' | 'yz' = 'xz') {
  const pts: THREE.Vector3[] = []
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2
    pts.push(plane === 'xz' ? new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r) : new THREE.Vector3(0, Math.cos(a) * r, Math.sin(a) * r))
  }
  return new THREE.BufferGeometry().setFromPoints(pts)
}

/** Fade every material under `g` toward `target`, scaling each material's base opacity. */
export function fade(g: THREE.Object3D | null, target: number, dt: number, rate = 5) {
  if (!g) return 0
  const f = (g.userData.f ?? 0) as number
  const nf = Math.abs(target - f) < 0.002 ? target : f + (target - f) * (1 - Math.exp(-dt * rate))
  g.userData.f = nf
  g.visible = nf > 0.004
  if (g.visible)
    g.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined
      if (!m) return
      for (const mm of Array.isArray(m) ? m : [m]) {
        if (mm.userData.base === undefined) mm.userData.base = mm.opacity
        mm.opacity = mm.userData.base * nf
      }
    })
  return nf
}

/** Seconds since `flag` last turned on, or -1 while it is off. */
function edge(e: { on: boolean; t0: number }, flag: boolean, now: number) {
  if (flag && !e.on) {
    e.on = true
    e.t0 = now
  } else if (!flag) e.on = false
  return e.on ? now - e.t0 : -1
}

/** Twisted, skewed lattice tube along the link: the ML-KEM / ML-DSA structure. */
function buildLattice() {
  const n = 46
  const s = 0.042 * R
  const up = new THREE.Vector3(0, 1, 0)
  const lines: number[] = []
  const verts: number[] = []
  let prev: THREE.Vector3[] | null = null
  const push = (a: THREE.Vector3, b: THREE.Vector3) => lines.push(a.x, a.y, a.z, b.x, b.y, b.z)
  for (let i = 0; i < n; i++) {
    const t = 0.035 + (0.93 * i) / (n - 1)
    const p = CURVE.getPoint(t)
    const tan = CURVE.getTangent(t)
    const nrm = new THREE.Vector3().crossVectors(tan, up).normalize()
    const bin = new THREE.Vector3().crossVectors(tan, nrm).normalize()
    const tw = t * Math.PI * 1.6
    const b1 = nrm.clone().multiplyScalar(Math.cos(tw)).addScaledVector(bin, Math.sin(tw))
    const b2 = nrm.clone().multiplyScalar(-Math.sin(tw)).addScaledVector(bin, Math.cos(tw))
    const cell = [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ].map(([a, b]) => p.clone().addScaledVector(b1, (a + 0.35 * b) * s).addScaledVector(b2, b * s))
    cell.forEach((c) => verts.push(c.x, c.y, c.z))
    for (let k = 0; k < 4; k++) push(cell[k], cell[(k + 1) % 4])
    push(cell[0], cell[2])
    if (prev) {
      for (let k = 0; k < 4; k++) {
        push(prev[k], cell[k])
        push(prev[k], cell[(k + 1) % 4])
      }
    }
    prev = cell
  }
  return { lines: segs(lines), points: segs(verts), segCount: lines.length / 6, vertCount: verts.length / 3 }
}

function boxEdges(w: number, h: number, d: number) {
  return new THREE.EdgesGeometry(new THREE.BoxGeometry(w, h, d))
}

// Fragment pool for the shattering wiretap / probe
const N_SHARD = 64
interface Shards {
  pos: Float32Array
  vel: Float32Array
  dir: Float32Array
  life: Float32Array
  col: Float32Array
  next: number
}

function burst(sh: Shards, origin: THREE.Vector3, n: number, speed: number, color: THREE.Color, spread = new THREE.Vector3()) {
  for (let i = 0; i < n; i++) {
    const k = sh.next++ % N_SHARD
    const o = origin.clone().addScaledVector(spread, Math.random())
    const v = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.35, Math.random() - 0.5).normalize().multiplyScalar(speed * (0.4 + Math.random()))
    const d = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(0.03 * R * (0.5 + Math.random()))
    sh.pos.set([o.x, o.y, o.z], k * 3)
    sh.vel.set([v.x, v.y, v.z], k * 3)
    sh.dir.set([d.x, d.y, d.z], k * 3)
    sh.col.set([color.r, color.g, color.b], k * 3)
    sh.life[k] = 1
  }
}

export function StoryLayer({ story }: { story: Story }) {
  const { camera, size } = useThree()
  const g = {
    ends: useRef<THREE.Group>(null),
    link: useRef<THREE.Group>(null),
    harvest: useRef<THREE.Group>(null),
    vault: useRef<THREE.Group>(null),
    shield: useRef<THREE.Group>(null),
    lattice: useRef<THREE.Group>(null),
    probe: useRef<THREE.Group>(null),
    ledger: useRef<THREE.Group>(null),
    tree: useRef<THREE.Group>(null),
    block: useRef<THREE.Group>(null),
    chain: useRef<THREE.Group>(null),
    condense: useRef<THREE.Group>(null),
    lock: useRef<THREE.Mesh>(null),
    radar: useRef<THREE.Group>(null),
    halos: useRef<THREE.Group>(null),
    self: useRef<THREE.Group>(null),
  }
  const linkLine = useRef<THREE.LineBasicMaterial>(null)
  const packetMat = useRef<THREE.PointsMaterial>(null)
  const packets = useRef<THREE.BufferGeometry>(null)
  const siphonPk = useRef<THREE.BufferGeometry>(null)
  const fill = useRef<THREE.Mesh>(null)
  const latLines = useRef<THREE.LineSegments>(null)
  const latPoints = useRef<THREE.Points>(null)
  const shieldMat = useRef<THREE.LineBasicMaterial>(null)
  const shieldSpin = useRef<THREE.Group>(null)
  const probeGeo = useRef<THREE.BufferGeometry>(null)
  const shardGeo = useRef<THREE.BufferGeometry>(null)
  const condenseGeo = useRef<THREE.BufferGeometry>(null)
  const leafMats = useRef<(THREE.LineBasicMaterial | null)[]>([])
  const blockMat = useRef<THREE.LineBasicMaterial>(null)
  const sweep = useRef<THREE.Group>(null)
  const halo = useRef<(THREE.Mesh | null)[]>([])

  const st = useRef({
    harvest: { on: false, t0: 0 },
    patched: { on: false, t0: 0 },
    anchored: { on: false, t0: 0 },
    prog: 0,
    shattered: false,
    flash: 0,
    probePh: 0,
    sweepA: 0,
  })

  const geo = useMemo(() => {
    const vault: number[] = []
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2
      vault.push(Math.cos(a) * VAULT_R, -VAULT_H / 2, Math.sin(a) * VAULT_R, Math.cos(a) * VAULT_R, VAULT_H / 2, Math.sin(a) * VAULT_R)
    }
    // intake funnel from the top rim to a narrow throat
    const funnel: number[] = []
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2
      funnel.push(Math.cos(a) * VAULT_R * 0.55, VAULT_H / 2, Math.sin(a) * VAULT_R * 0.55, Math.cos(a) * 0.05 * R, VAULT_H / 2 + 0.1 * R, Math.sin(a) * 0.05 * R)
    }
    const fillG = new THREE.CylinderGeometry(VAULT_R * 0.92, VAULT_R * 0.92, VAULT_H, 32, 1, true)
    fillG.translate(0, VAULT_H / 2, 0)
    const edges: number[] = []
    const e = (a: THREE.Vector3, b: THREE.Vector3) => edges.push(a.x, a.y, a.z, b.x, b.y, b.z)
    e(LEAVES[0], INNER[0])
    e(LEAVES[1], INNER[0])
    e(LEAVES[2], INNER[1])
    e(LEAVES[3], INNER[1])
    e(INNER[0], P_BLOCK)
    e(INNER[1], P_BLOCK)
    const chainNext = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([P_BLOCK.clone().add(v3(0.14, 0, 0)), P_NEXT.clone().add(v3(-0.08, 0, 0))]),
      new THREE.LineDashedMaterial({ color: STEEL, dashSize: 0.03, gapSize: 0.03, transparent: true, opacity: 0.6, depthWrite: false }),
    )
    chainNext.computeLineDistances()
    const nextSlot = new THREE.LineSegments(boxEdges(0.16 * R, 0.16 * R, 0.16 * R), new THREE.LineDashedMaterial({ color: STEEL, dashSize: 0.02, gapSize: 0.02, transparent: true, opacity: 0.55, depthWrite: false }))
    nextSlot.computeLineDistances()
    nextSlot.position.copy(P_NEXT)
    return {
      curve: new THREE.BufferGeometry().setFromPoints(CURVE.getPoints(120)),
      siphon: new THREE.BufferGeometry().setFromPoints([P_TAP, P_INTAKE]),
      clampA: ring(0.06 * R, 40, 'yz'),
      clampB: ring(0.095 * R, 40, 'yz'),
      vaultRing: ring(VAULT_R, 64),
      vaultThroat: ring(0.05 * R, 24),
      vaultBars: segs(vault),
      funnel: segs(funnel),
      fill: fillG,
      shieldOuter: new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(SHIELD_R, 1)),
      shieldInner: new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(SHIELD_R * 0.62, 0)),
      lattice: buildLattice(),
      server: boxEdges(0.2 * R, 0.34 * R, 0.2 * R),
      serverSlots: segs([-0.09, -0.03, 0.03, 0.09].flatMap((y) => [-0.07 * R, y * R, 0.101 * R, 0.07 * R, y * R, 0.101 * R])),
      client: boxEdges(0.32 * R, 0.2 * R, 0.02 * R),
      clientStand: segs([0, -0.1 * R, 0, 0, -0.17 * R, 0, -0.08 * R, -0.17 * R, 0, 0.08 * R, -0.17 * R, 0]),
      leaf: boxEdges(0.085 * R, 0.085 * R, 0.085 * R),
      inner: boxEdges(0.1 * R, 0.1 * R, 0.1 * R),
      block: boxEdges(0.26 * R, 0.26 * R, 0.26 * R),
      root: boxEdges(0.1 * R, 0.1 * R, 0.1 * R),
      prev: boxEdges(0.2 * R, 0.2 * R, 0.2 * R),
      treeEdges: segs(edges),
      chainPrev: new THREE.BufferGeometry().setFromPoints([P_PREV.clone().add(v3(0.1, 0, 0)), P_BLOCK.clone().add(v3(-0.14, 0, 0))]),
      chainNext,
      nextSlot,
      lockRing: new THREE.RingGeometry(0.2 * R, 0.21 * R, 64),
      halo: new THREE.RingGeometry(0.12 * R, 0.13 * R, 48),
      radarEdge: segs([0, 0, 0, 1.75 * R, 0, 0]),
      meridian: new THREE.BufferGeometry().setFromPoints(
        Array.from({ length: 65 }, (_, i) => {
          const e2 = -Math.PI / 2 + (Math.PI * i) / 64
          return new THREE.Vector3(Math.cos(e2) * R * 1.02, Math.sin(e2) * R * 1.02, 0)
        }),
      ),
    }
  }, [])

  const shards = useMemo<Shards>(
    () => ({ pos: new Float32Array(N_SHARD * 3), vel: new Float32Array(N_SHARD * 3), dir: new Float32Array(N_SHARD * 3), life: new Float32Array(N_SHARD), col: new Float32Array(N_SHARD * 3), next: 0 }),
    [],
  )
  const shardBuf = useMemo(() => ({ pos: new Float32Array(N_SHARD * 6), col: new Float32Array(N_SHARD * 6) }), [])
  const condense = useMemo(() => {
    const n = 90
    const from = new Float32Array(n * 3)
    const to = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) {
      const a = CURVE.getPoint(0.04 + Math.random() * 0.92)
      const b = LEAVES[i % 3].clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.06 * R, (Math.random() - 0.5) * 0.06 * R, (Math.random() - 0.5) * 0.06 * R))
      from.set([a.x, a.y, a.z], i * 3)
      to.set([b.x, b.y, b.z], i * 3)
    }
    return { n, from, to, cur: new Float32Array(n * 3), delay: Float32Array.from({ length: n }, () => Math.random() * 0.35) }
  }, [])
  const pk = useMemo(() => ({ link: new Float32Array(12 * 3), siphon: new Float32Array(6 * 3) }), [])
  const tmp = useMemo(() => ({ v: new THREE.Vector3(), w: new THREE.Vector3() }), [])

  useFrame(({ clock }, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05)
    const t = clock.elapsedTime
    const s = st.current
    const { active, scanning, stage, vulnerable, patching, patched, anchored, rescan } = story
    const results = active && !scanning

    // ── link + packets ──
    fade(g.ends.current, active ? 1 : 0, dt)
    fade(g.link.current, active ? 1 : 0, dt)
    s.prog = patched ? Math.min(1, s.prog + dt / 0.45) : patching ? Math.min(0.92, s.prog + dt / 1.8) : 0
    if (linkLine.current) linkLine.current.userData.base = 0.75 * (1 - s.prog) + 0.06
    packetMat.current?.color.copy(ICE).lerp(EMERALD, s.prog)
    const pace = scanning ? 0.55 : 0.22
    for (let i = 0; i < 12; i++) {
      let u = (t * pace + i / 12) % 1
      if (i % 2) u = 1 - u
      CURVE.getPoint(u, tmp.w)
      pk.link.set([tmp.w.x, tmp.w.y, tmp.w.z], i * 3)
    }
    if (packets.current) {
      ;(packets.current.attributes.position as THREE.BufferAttribute).set(pk.link)
      packets.current.attributes.position.needsUpdate = true
    }

    // ── harvest: wiretap, siphon, vault ──
    const harvesting = results && vulnerable && !patched && stage <= 3
    const hAge = edge(s.harvest, results && vulnerable, t)
    fade(g.harvest.current, harvesting ? 1 : 0, dt, patched ? 30 : 4)
    fade(g.vault.current, results && vulnerable && stage <= 3 ? 1 : 0, dt)
    if (fill.current) fill.current.scale.y = Math.max(0.02, Math.min(0.9, 0.12 + Math.max(0, hAge) * 0.035))
    for (let i = 0; i < 6; i++) {
      const u = (t * 0.7 + i / 6) % 1
      tmp.w.copy(P_TAP).lerp(P_INTAKE, u)
      pk.siphon.set([tmp.w.x, tmp.w.y, tmp.w.z], i * 3)
    }
    if (siphonPk.current) {
      ;(siphonPk.current.attributes.position as THREE.BufferAttribute).set(pk.siphon)
      siphonPk.current.attributes.position.needsUpdate = true
    }

    // ── defend: lattice, shield, shattered wiretap, failing probes ──
    const pAge = edge(s.patched, patched, t)
    if (!patched) s.shattered = false
    if (patched && !s.shattered && pAge < 0.5) {
      s.shattered = true
      if (vulnerable && stage <= 3) {
        burst(shards, P_TAP, 14, 0.9 * R, CRIMSON)
        burst(shards, P_TAP, 18, 0.5 * R, CRIMSON, P_INTAKE.clone().sub(P_TAP))
        s.flash = 1
      }
    }
    fade(g.lattice.current, patching || patched ? 1 : 0, dt)
    const lat = geo.lattice
    latLines.current?.geometry.setDrawRange(0, Math.floor(ease(s.prog) * lat.segCount) * 2)
    latPoints.current?.geometry.setDrawRange(0, Math.floor(ease(s.prog) * lat.vertCount))
    fade(g.shield.current, patched && stage <= 3 ? 1 : 0, dt, 4)
    if (shieldSpin.current) {
      shieldSpin.current.rotation.y += dt * 0.25
      shieldSpin.current.rotation.x += dt * 0.1
      shieldSpin.current.scale.setScalar(ease(clamp01(pAge / 0.6)) * (1 + 0.06 * s.flash))
    }
    if (shieldMat.current) shieldMat.current.userData.base = 0.4 + 0.55 * s.flash
    s.flash = Math.max(0, s.flash - dt * 2.2)

    // adversary retries every 3 s and shatters on the shield
    const probing = patched && vulnerable && stage === 3 && pAge > 1.4
    let probeLen = 0
    if (probing) {
      const ph = (pAge - 1.4) % 3
      probeLen = ph < 0.75 ? ease(ph / 0.75) : 0
      if (s.probePh < 0.75 && ph >= 0.75) {
        burst(shards, P_CONTACT, 12, 0.7 * R, CRIMSON)
        burst(shards, P_CONTACT, 6, 0.45 * R, EMERALD)
        s.flash = 1
      }
      s.probePh = ph
    } else s.probePh = 0
    fade(g.probe.current, probeLen > 0 ? 1 : 0, dt, 20)
    if (probeGeo.current && probeLen > 0) {
      tmp.w.copy(P_INTAKE).lerp(P_CONTACT, probeLen)
      ;(probeGeo.current.attributes.position as THREE.BufferAttribute).setXYZ(1, tmp.w.x, tmp.w.y, tmp.w.z)
      probeGeo.current.attributes.position.needsUpdate = true
    }

    // shards: short line fragments, fading out through additive colour
    for (let k = 0; k < N_SHARD; k++) {
      const l = shards.life[k]
      const o = k * 6
      if (l <= 0) {
        shardBuf.col.fill(0, o, o + 6)
        continue
      }
      shards.life[k] = l - dt / 0.9
      for (let a = 0; a < 3; a++) {
        shards.vel[k * 3 + a] *= 1 - dt * 1.5
        shards.pos[k * 3 + a] += shards.vel[k * 3 + a] * dt
      }
      shards.vel[k * 3 + 1] -= dt * 0.8 * R
      for (let a = 0; a < 3; a++) {
        shardBuf.pos[o + a] = shards.pos[k * 3 + a] - shards.dir[k * 3 + a]
        shardBuf.pos[o + 3 + a] = shards.pos[k * 3 + a] + shards.dir[k * 3 + a]
        shardBuf.col[o + a] = shardBuf.col[o + 3 + a] = shards.col[k * 3 + a] * Math.max(0, l)
      }
    }
    if (shardGeo.current) {
      ;(shardGeo.current.attributes.position as THREE.BufferAttribute).set(shardBuf.pos)
      ;(shardGeo.current.attributes.color as THREE.BufferAttribute).set(shardBuf.col)
      shardGeo.current.attributes.position.needsUpdate = true
      shardGeo.current.attributes.color.needsUpdate = true
    }

    // ── prove: condense into leaves, build tree, drop block into chain ──
    const aAge = edge(s.anchored, anchored, t)
    const fL = fade(g.ledger.current, results && stage === 4 ? 1 : 0, dt)
    const la = aAge < 0 ? -1 : aAge
    fade(g.condense.current, la >= 0 && la < 1.35 ? fL : 0, dt, 10)
    if (condenseGeo.current && la >= 0 && la < 1.5) {
      const c = condense
      for (let i = 0; i < c.n; i++) {
        const u = ease(clamp01((la - c.delay[i]) / 0.9))
        for (let a = 0; a < 3; a++) c.cur[i * 3 + a] = c.from[i * 3 + a] + (c.to[i * 3 + a] - c.from[i * 3 + a]) * u
      }
      ;(condenseGeo.current.attributes.position as THREE.BufferAttribute).set(c.cur)
      condenseGeo.current.attributes.position.needsUpdate = true
    }
    leafMats.current.forEach((m, i) => {
      if (!m) return
      const lit = la > 0.9 + i * 0.08 && i < 3
      m.userData.base = lit ? 0.95 : 0.28
      m.color.copy(lit ? CYAN : STEEL)
    })
    fade(g.tree.current, la > 1.05 ? fL : 0, dt, 6)
    const drop = clamp01((la - 1.45) / 0.45)
    fade(g.block.current, la > 1.45 ? fL : 0, dt, 12)
    if (g.block.current) {
      g.block.current.position.y = (1 - ease(drop)) * 0.45 * R
      g.block.current.rotation.y = (1 - ease(drop)) * 1.2
    }
    blockMat.current?.color.copy(drop >= 1 ? EMERALD : CYAN)
    if (g.lock.current) {
      const lk = clamp01((la - 1.9) / 0.7)
      g.lock.current.visible = la > 1.9 && lk < 1
      g.lock.current.scale.setScalar(1 + lk * 1.6)
      ;(g.lock.current.material as THREE.MeshBasicMaterial).opacity = (1 - lk) * 0.8 * fL
      g.lock.current.quaternion.copy(camera.quaternion)
    }
    fade(g.chain.current, la > 1.95 ? fL : 0, dt, 6)

    // ── rescan: rapid 360° radar sweep, then a slow watch ──
    fade(g.radar.current, results && stage === 5 && rescan !== 'idle' ? 1 : 0, dt)
    s.sweepA += dt * (rescan === 'running' ? 6.5 : 0.9)
    if (sweep.current) sweep.current.rotation.y = s.sweepA
    const done = results && stage === 5 && rescan === 'done'
    fade(g.halos.current, done ? 1 : 0, dt)
    halo.current.forEach((h, i) => {
      if (!h) return
      const ph = (t / 1.6 + i * 0.5) % 1
      h.scale.setScalar(1 + ph * 1.4)
      h.quaternion.copy(camera.quaternion)
      ;(h.material as THREE.MeshBasicMaterial).opacity = (1 - ph) * 0.8 * ((g.halos.current?.userData.f as number) ?? 0)
    })

    // ── publish story anchors in screen pixels ──
    const self = g.self.current
    if (self) {
      self.updateMatrixWorld()
      for (const k in ANCHORS) {
        tmp.v.copy(ANCHORS[k]).applyMatrix4(self.matrixWorld).project(camera)
        hudAnchor.points[k] = { x: (tmp.v.x * 0.5 + 0.5) * size.width, y: (-tmp.v.y * 0.5 + 0.5) * size.height, on: true }
      }
    }
  })

  const serverCol = story.stage === 5 && story.rescan === 'done' ? EMERALD : story.patched ? CYAN : new THREE.Color('#cfd8e0')
  const clientCol = story.stage === 5 && story.rescan === 'done' ? EMERALD : new THREE.Color('#cfd8e0')
  const line = (color: THREE.Color, opacity: number) => <lineBasicMaterial color={color} transparent opacity={opacity} depthWrite={false} />

  return (
    <group ref={g.self}>
      {/* client + server */}
      <group ref={g.ends} visible={false}>
        <group position={P_CLIENT}>
          <lineSegments geometry={geo.client}>{line(clientCol, 0.85)}</lineSegments>
          <lineSegments geometry={geo.clientStand}>{line(clientCol, 0.6)}</lineSegments>
        </group>
        <group position={P_SERVER}>
          <lineSegments geometry={geo.server}>{line(serverCol, 0.85)}</lineSegments>
          <lineSegments geometry={geo.serverSlots}>{line(serverCol, 0.5)}</lineSegments>
        </group>
      </group>

      {/* classical link with packets in both directions */}
      <group ref={g.link} visible={false}>
        <line>
          <primitive object={geo.curve} attach="geometry" />
          <lineBasicMaterial ref={linkLine} color={ICE} transparent opacity={0.75} depthWrite={false} />
        </line>
        <points>
          <bufferGeometry ref={packets}>
            <bufferAttribute attach="attributes-position" args={[pk.link, 3]} />
          </bufferGeometry>
          <pointsMaterial ref={packetMat} color={ICE} size={3.5} sizeAttenuation={false} transparent opacity={0.95} depthWrite={false} />
        </points>
      </group>

      {/* hostile wiretap: clamp on the link, crimson siphon down into the vault */}
      <group ref={g.harvest} visible={false}>
        <group position={P_TAP}>
          <lineLoop geometry={geo.clampA}>{line(CRIMSON, 0.95)}</lineLoop>
          <lineLoop geometry={geo.clampB}>{line(CRIMSON, 0.45)}</lineLoop>
        </group>
        <line>
          <primitive object={geo.siphon} attach="geometry" />
          <lineBasicMaterial color={CRIMSON} transparent opacity={0.8} depthWrite={false} />
        </line>
        <points>
          <bufferGeometry ref={siphonPk}>
            <bufferAttribute attach="attributes-position" args={[pk.siphon, 3]} />
          </bufferGeometry>
          <pointsMaterial color={CRIMSON} size={3} sizeAttenuation={false} transparent opacity={1} depthWrite={false} />
        </points>
      </group>

      {/* adversary storage vault */}
      <group ref={g.vault} visible={false} position={P_VAULT}>
        {[-VAULT_H / 2, 0, VAULT_H / 2].map((y) => (
          <lineLoop key={y} geometry={geo.vaultRing} position={[0, y, 0]}>{line(CRIMSON, y === 0 ? 0.25 : 0.7)}</lineLoop>
        ))}
        <lineSegments geometry={geo.vaultBars}>{line(CRIMSON, 0.3)}</lineSegments>
        <lineSegments geometry={geo.funnel}>{line(CRIMSON, 0.5)}</lineSegments>
        <lineLoop geometry={geo.vaultThroat} position={[0, VAULT_H / 2 + 0.1 * R, 0]}>{line(CRIMSON, 0.8)}</lineLoop>
        <mesh ref={fill} geometry={geo.fill} position={[0, -VAULT_H / 2, 0]}>
          <meshBasicMaterial color={CRIMSON} transparent opacity={0.13} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
      </group>

      {/* ML-KEM / ML-DSA lattice replacing the classical link */}
      <group ref={g.lattice} visible={false}>
        <lineSegments ref={latLines} geometry={geo.lattice.lines}>{line(CYAN, 0.36)}</lineSegments>
        <points ref={latPoints} geometry={geo.lattice.points}>
          <pointsMaterial color={EMERALD} size={2.2} sizeAttenuation={false} transparent opacity={0.9} depthWrite={false} />
        </points>
      </group>

      {/* cryptographic shield around the old tap point */}
      <group ref={g.shield} visible={false} position={P_TAP}>
        <group ref={shieldSpin}>
          <lineSegments geometry={geo.shieldOuter}>
            <lineBasicMaterial ref={shieldMat} color={EMERALD} transparent opacity={0.4} depthWrite={false} />
          </lineSegments>
          <lineSegments geometry={geo.shieldInner}>{line(CYAN, 0.3)}</lineSegments>
        </group>
      </group>

      {/* adversary probe that fails on the shield */}
      <group ref={g.probe} visible={false}>
        <line>
          <bufferGeometry ref={probeGeo}>
            <bufferAttribute attach="attributes-position" args={[new Float32Array([P_INTAKE.x, P_INTAKE.y, P_INTAKE.z, P_INTAKE.x, P_INTAKE.y, P_INTAKE.z]), 3]} />
          </bufferGeometry>
          <lineBasicMaterial color={CRIMSON} transparent opacity={0.9} depthWrite={false} />
        </line>
      </group>

      <lineSegments frustumCulled={false}>
        <bufferGeometry ref={shardGeo}>
          <bufferAttribute attach="attributes-position" args={[shardBuf.pos, 3]} />
          <bufferAttribute attach="attributes-color" args={[shardBuf.col, 3]} />
        </bufferGeometry>
        <lineBasicMaterial vertexColors transparent blending={THREE.AdditiveBlending} depthWrite={false} />
      </lineSegments>

      {/* Merkle tree + block chain */}
      <group ref={g.ledger} visible={false}>
        {LEAVES.map((p, i) => (
          <lineSegments key={i} geometry={geo.leaf} position={p}>
            <lineBasicMaterial ref={(m) => { leafMats.current[i] = m }} color={STEEL} transparent opacity={i === 3 ? 0.18 : 0.28} depthWrite={false} />
          </lineSegments>
        ))}
        <group ref={g.condense} visible={false}>
          <points frustumCulled={false}>
            <bufferGeometry ref={condenseGeo}>
              <bufferAttribute attach="attributes-position" args={[condense.cur, 3]} />
            </bufferGeometry>
            <pointsMaterial color={EMERALD} size={2.4} sizeAttenuation={false} transparent opacity={0.95} depthWrite={false} />
          </points>
        </group>
        <group ref={g.tree} visible={false}>
          <lineSegments geometry={geo.treeEdges}>{line(CYAN, 0.45)}</lineSegments>
          {INNER.map((p, i) => (
            <lineSegments key={i} geometry={geo.inner} position={p}>{line(CYAN, 0.8)}</lineSegments>
          ))}
        </group>
        <lineSegments geometry={geo.prev} position={P_PREV}>{line(STEEL, 0.55)}</lineSegments>
        <primitive object={geo.nextSlot} />
        <group position={P_BLOCK}>
          <group ref={g.block} visible={false}>
            <lineSegments geometry={geo.block}>
              <lineBasicMaterial ref={blockMat} color={CYAN} transparent opacity={0.95} depthWrite={false} />
            </lineSegments>
            <lineSegments geometry={geo.root}>{line(EMERALD, 0.9)}</lineSegments>
          </group>
          <mesh ref={g.lock} geometry={geo.lockRing} visible={false}>
            <meshBasicMaterial color={EMERALD} transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
          </mesh>
        </group>
        <group ref={g.chain} visible={false}>
          <line>
            <primitive object={geo.chainPrev} attach="geometry" />
            <lineBasicMaterial color={EMERALD} transparent opacity={0.7} depthWrite={false} />
          </line>
          <primitive object={geo.chainNext} />
        </group>
      </group>

      {/* radar sweep aligned to the globe's equator */}
      <group ref={g.radar} visible={false} rotation={[0.28, 0, 0]}>
        <group ref={sweep}>
          {[0.18, 0.36, 0.6].map((len, i) => (
            <mesh key={len} rotation={[-Math.PI / 2, 0, 0]}>
              <circleGeometry args={[1.75 * R, 32, -len, len]} />
              <meshBasicMaterial color={EMERALD} transparent opacity={0.07 - i * 0.015} depthWrite={false} side={THREE.DoubleSide} />
            </mesh>
          ))}
          <lineSegments geometry={geo.radarEdge}>{line(EMERALD, 0.9)}</lineSegments>
          <line>
            <primitive object={geo.meridian} attach="geometry" />
            <lineBasicMaterial color={EMERALD} transparent opacity={0.85} depthWrite={false} />
          </line>
        </group>
      </group>

      {/* stable emerald pulses on every endpoint once verified */}
      <group ref={g.halos} visible={false}>
        {[P_CLIENT, P_SERVER, P_TAP].map((p, i) => (
          <mesh key={i} ref={(m) => { halo.current[i] = m }} geometry={geo.halo} position={p}>
            <meshBasicMaterial color={EMERALD} transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
          </mesh>
        ))}
      </group>
    </group>
  )
}
