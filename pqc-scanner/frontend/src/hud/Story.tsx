// QuantumLedger's 3D storytelling layer, drawn in the hologram's own space (child of the fitted
// root group). Each pipeline stage has its own scene and camera framing; every beat is driven by
// real pipeline state, and timings only choreograph the move between two real states.
//
//   1 DETECT  fragile white TLS link, pulsing crimson wiretap into adversary storage
//   2 SCORE   camera closes on the storage node; Q-Day dial + Mosca project out of it
//   3 DEFEND  white link shatters, lattice cages wrap client + server, wiretap snaps on contact
//   4 PROVE   camera pulls back to the Merkle tree; secured link compresses into a block that snaps into the chain
//   5 RESCAN  radar plane drops over the whole topology; every node locks to pulsing emerald
import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import gsap from 'gsap'
import { coreZone, hudAnchor, type Story } from './anchor'
import { sfx } from './sfx'
import { xrState } from './xr'

const R = 1.5 // globe radius, same as HudGlobe

const WHITE = new THREE.Color('#e6edf3')
const CRIMSON = new THREE.Color('#ef4444')
const AMBER = new THREE.Color('#f97316')
const EMERALD = new THREE.Color('#10b981')
const CYAN = new THREE.Color('#06b6d4')
const ICE = new THREE.Color('#67e8f9')
const STEEL = new THREE.Color('#577c95')

// HDR (> 1) colours: only these pass the bloom threshold, so light bleeds from the
// lattice, shields, data streams, siphon and locked block, and nowhere else.
const hdr = (c: THREE.Color, k: number) => c.clone().multiplyScalar(k)
const G_CYAN = hdr(CYAN, 7)
const G_LATTICE = hdr(CYAN, 2.6) // dense geometry: a lower gain keeps the bleed diffuse, not a wash
const G_ICE = hdr(ICE, 3)
const G_CRIMSON = hdr(CRIMSON, 5)
const G_EMERALD = hdr(EMERALD, 3.2)
const G_WHITE = hdr(WHITE, 2.2)
const G_AMBER = hdr(AMBER, 3)

/** True when the object and all its ancestors are visible. */
function visibleDeep(o: THREE.Object3D | null) {
  for (; o; o = o.parent) if (!o.visible) return false
  return true
}

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
const P_CONTACT = P_TAP.clone().add(P_INTAKE.clone().sub(P_TAP).normalize().multiplyScalar(0.075 * R))
const CAGE_R = 0.3 * R

// Q-Day dial projected out of the storage node (to its right, clear of the siphon)
const P_DIAL = v3(0.95, -1.62, 0.85)
const DIAL_R = 0.34 * R

// Merkle tree above the globe: 4 leaf slots (3 stage records + duplicate), 2 inner nodes, root inside the block
const Z_TREE = 0.2
const LEAVES = [-0.72, -0.24, 0.24, 0.72].map((x) => v3(x, 1.32, Z_TREE))
const INNER = [v3(-0.48, 1.58, Z_TREE), v3(0.48, 1.58, Z_TREE)]
const P_BLOCK = v3(0, 1.86, Z_TREE)
const P_HOVER = v3(0, 2.45, Z_TREE)
const P_PREV = v3(-0.78, 1.86, Z_TREE)
const P_NEXT = v3(0.78, 1.86, Z_TREE)

// floor-level network topology lit by the radar plane
const FLOOR_Y = -2.3 * R

const ANCHORS: Record<string, THREE.Vector3> = {
  client: P_CLIENT,
  server: P_SERVER,
  tap: P_TAP,
  vault: P_VAULT,
  dial: P_DIAL,
  dialTop: P_DIAL.clone().add(new THREE.Vector3(0, DIAL_R * 1.3, 0)),
  dialBottom: P_DIAL.clone().add(new THREE.Vector3(0, -DIAL_R * 1.2, 0)),
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

function ring(r: number, n = 64, plane: 'xz' | 'yz' | 'xy' = 'xz') {
  const pts: THREE.Vector3[] = []
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2
    const c = Math.cos(a) * r
    const s = Math.sin(a) * r
    pts.push(plane === 'xz' ? new THREE.Vector3(c, 0, s) : plane === 'yz' ? new THREE.Vector3(0, c, s) : new THREE.Vector3(c, s, 0))
  }
  return new THREE.BufferGeometry().setFromPoints(pts)
}

function boxEdges(w: number, h: number, d: number) {
  return new THREE.EdgesGeometry(new THREE.BoxGeometry(w, h, d))
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

/** Geodesic lattice cage: outer icosphere + inner shell joined by struts. */
function buildCage() {
  const outer = new THREE.IcosahedronGeometry(CAGE_R, 1)
  const inner = new THREE.IcosahedronGeometry(CAGE_R * 0.7, 0)
  const pos = outer.getAttribute('position')
  const seen = new Set<string>()
  const verts: THREE.Vector3[] = []
  for (let i = 0; i < pos.count; i++) {
    const v = new THREE.Vector3().fromBufferAttribute(pos, i)
    const k = v.toArray().map((n) => n.toFixed(3)).join()
    if (!seen.has(k)) {
      seen.add(k)
      verts.push(v)
    }
  }
  const struts: number[] = []
  verts.forEach((v) => {
    const w = v.clone().multiplyScalar(0.7)
    struts.push(v.x, v.y, v.z, w.x, w.y, w.z)
  })
  return { outer: new THREE.EdgesGeometry(outer), inner: new THREE.EdgesGeometry(inner), struts: segs(struts), nodes: new THREE.BufferGeometry().setFromPoints(verts) }
}

// Fragment pool for shattering lines
const N_SHARD = 128
interface Shards {
  pos: Float32Array
  vel: Float32Array
  dir: Float32Array
  life: Float32Array
  col: Float32Array
  next: number
}

function burst(sh: Shards, origin: THREE.Vector3, n: number, speed: number, color: THREE.Color, len = 0.03) {
  for (let i = 0; i < n; i++) {
    const k = sh.next++ % N_SHARD
    const v = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.35, Math.random() - 0.5).normalize().multiplyScalar(speed * (0.4 + Math.random()))
    const d = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(len * R * (0.5 + Math.random()))
    sh.pos.set([origin.x, origin.y, origin.z], k * 3)
    sh.vel.set([v.x, v.y, v.z], k * 3)
    sh.dir.set([d.x, d.y, d.z], k * 3)
    sh.col.set([color.r, color.g, color.b], k * 3)
    sh.life[k] = 1
  }
}

type CamMode = 'base' | 'vault' | 'wide' | 'radar'

export function StoryLayer({ story }: { story: Story }) {
  const { camera, size, scene, gl } = useThree()
  const g = {
    self: useRef<THREE.Group>(null),
    ends: useRef<THREE.Group>(null),
    cages: useRef<THREE.Group>(null),
    link: useRef<THREE.Group>(null),
    lattice: useRef<THREE.Group>(null),
    harvest: useRef<THREE.Group>(null),
    vault: useRef<THREE.Group>(null),
    dial: useRef<THREE.Group>(null),
    probe: useRef<THREE.Group>(null),
    ledger: useRef<THREE.Group>(null),
    tree: useRef<THREE.Group>(null),
    block: useRef<THREE.Group>(null),
    chain: useRef<THREE.Group>(null),
    condense: useRef<THREE.Group>(null),
    radar: useRef<THREE.Group>(null),
    floor: useRef<THREE.Group>(null),
    halos: useRef<THREE.Group>(null),
  }
  const linkMat = useRef<THREE.LineBasicMaterial>(null)
  const packetMat = useRef<THREE.PointsMaterial>(null)
  const packets = useRef<THREE.BufferGeometry>(null)
  const siphonMat = useRef<THREE.LineBasicMaterial>(null)
  const siphonPk = useRef<THREE.BufferGeometry>(null)
  const fill = useRef<THREE.Mesh>(null)
  const latLines = useRef<THREE.LineSegments>(null)
  const latPoints = useRef<THREE.Points>(null)
  const cageSpin = useRef<(THREE.Group | null)[]>([])
  const cageMat = useRef<(THREE.LineBasicMaterial | null)[]>([])
  const dialFace = useRef<THREE.Group>(null)
  const dialHand = useRef<THREE.Group>(null)
  const probeGeo = useRef<THREE.BufferGeometry>(null)
  const flash = useRef<THREE.Mesh>(null)
  const shardGeo = useRef<THREE.BufferGeometry>(null)
  const condenseGeo = useRef<THREE.BufferGeometry>(null)
  const leafMats = useRef<(THREE.LineBasicMaterial | null)[]>([])
  const blockMat = useRef<THREE.LineBasicMaterial>(null)
  const lock = useRef<THREE.Mesh>(null)
  const plane = useRef<THREE.Group>(null)
  const sweep = useRef<THREE.Group>(null)
  const cut = useRef<THREE.LineLoop>(null)
  const floorGeo = useRef<THREE.BufferGeometry>(null)
  const floorLinkMat = useRef<THREE.LineBasicMaterial>(null)
  const halo = useRef<(THREE.Mesh | null)[]>([])
  const blockGlass = useRef<THREE.MeshPhysicalMaterial>(null)
  const light = {
    tap: useRef<THREE.PointLight>(null),
    link: useRef<THREE.PointLight>(null),
    client: useRef<THREE.PointLight>(null),
    server: useRef<THREE.PointLight>(null),
    block: useRef<THREE.PointLight>(null),
  }
  // Raycast-inspectable objects: each is a group tagged with an inspect id; its meshes are the hit targets.
  const hov = useRef<Record<string, THREE.Group | null>>({})
  const H = (id: string) => (el: THREE.Group | null) => {
    hov.current[id] = el
    if (el) el.userData.inspect = id
  }
  const pointer = useRef({ ndc: new THREE.Vector2(), inside: false, dragging: false })
  const ray = useMemo(() => new THREE.Raycaster(), [])
  const sph = useMemo(() => new THREE.Spherical(), [])

  const st = useRef({
    harvest: { on: false, t0: 0 },
    patch: { on: false, t0: 0 },
    anchored: { on: false, t0: 0 },
    rescan: { on: false, t0: 0 },
    prog: 0,
    shattered: false,
    snapped: false,
    flash: 0,
    probePh: 0,
    sweepA: 0,
    flight: { active: false, t: 0, dur: 2, swoop: 0, fromT: new THREE.Vector3(), from: new THREE.Spherical(), to: new THREE.Spherical() },
    reframe: false,
    hover: null as string | null,
    mode: '' as string,
    frames: 0,
    fpsT: 0,
  })

  // User camera: orbit / zoom / pan anywhere; each stage change (or a double-click) flies back to the stage framing.
  const controls = useMemo(() => {
    const c = new OrbitControls(camera, gl.domElement)
    c.enableDamping = true
    c.dampingFactor = 0.08
    c.rotateSpeed = 0.55
    c.zoomSpeed = 0.8
    c.minDistance = 1.2
    c.maxDistance = 22
    return c
  }, [camera, gl])
  useEffect(() => {
    const s = st.current
    const el = gl.domElement
    const ptr = pointer.current
    // grabbing the scene hands the camera to OrbitControls mid-flight
    const grab = () => {
      gsap.killTweensOf(s.flight)
      s.flight.active = false
      hudAnchor.userCam = true
    }
    const reframe = () => {
      s.reframe = true
    }
    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect()
      ptr.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
      ptr.inside = true
    }
    const leave = () => {
      ptr.inside = false
    }
    const down = () => {
      ptr.dragging = true
    }
    const up = () => {
      ptr.dragging = false
    }
    controls.addEventListener('start', grab)
    el.addEventListener('dblclick', reframe)
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerleave', leave)
    el.addEventListener('pointerdown', down)
    addEventListener('pointerup', up)
    return () => {
      gsap.killTweensOf(s.flight)
      controls.removeEventListener('start', grab)
      el.removeEventListener('dblclick', reframe)
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerleave', leave)
      el.removeEventListener('pointerdown', down)
      removeEventListener('pointerup', up)
      controls.dispose()
    }
  }, [controls, gl])

  const geo = useMemo(() => {
    const vault: number[] = []
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2
      vault.push(Math.cos(a) * VAULT_R, -VAULT_H / 2, Math.sin(a) * VAULT_R, Math.cos(a) * VAULT_R, VAULT_H / 2, Math.sin(a) * VAULT_R)
    }
    const funnel: number[] = []
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2
      funnel.push(Math.cos(a) * VAULT_R * 0.55, VAULT_H / 2, Math.sin(a) * VAULT_R * 0.55, Math.cos(a) * 0.05 * R, VAULT_H / 2 + 0.1 * R, Math.sin(a) * 0.05 * R)
    }
    const fillG = new THREE.CylinderGeometry(VAULT_R * 0.92, VAULT_R * 0.92, VAULT_H, 32, 1, true)
    fillG.translate(0, VAULT_H / 2, 0)

    // dial: 60 ticks, remaining-window arc, projector beams from the storage node's rim
    const ticks: number[] = []
    for (let i = 0; i < 60; i++) {
      const a = (i / 60) * Math.PI * 2
      const r0 = i % 5 === 0 ? DIAL_R * 0.86 : DIAL_R * 0.92
      ticks.push(Math.sin(a) * r0, Math.cos(a) * r0, 0, Math.sin(a) * DIAL_R, Math.cos(a) * DIAL_R, 0)
    }
    const arcPts = Array.from({ length: 129 }, (_, i) => {
      const a = (i / 128) * Math.PI * 2
      return new THREE.Vector3(Math.sin(a) * DIAL_R * 0.8, Math.cos(a) * DIAL_R * 0.8, 0)
    })
    const rim = P_VAULT.clone().add(new THREE.Vector3(0, VAULT_H / 2, 0))
    const beams: number[] = []
    for (const [dx, dz, ex, ey] of [
      [VAULT_R, 0, -1, -1],
      [0, VAULT_R, -1, 1],
      [VAULT_R * 0.7, -VAULT_R * 0.7, 1, -1],
    ]) {
      const a = rim.clone().add(new THREE.Vector3(dx, 0, dz))
      const b = P_DIAL.clone().add(new THREE.Vector3(ex * DIAL_R * 0.7, ey * DIAL_R * 0.7, 0))
      beams.push(a.x, a.y, a.z, b.x, b.y, b.z)
    }

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

    const PR = 2.7 * R

    // floor topology: grid intersections inside an ellipse, linked to some orthogonal neighbours
    const nodes: THREE.Vector3[] = []
    const key = new Map<string, number>()
    for (let i = -4; i <= 4; i++)
      for (let j = -3; j <= 3; j++) {
        const x = i * 0.5 * R
        const z = j * 0.5 * R
        if ((x / (2.3 * R)) ** 2 + (z / (1.7 * R)) ** 2 > 1) continue
        key.set(`${i},${j}`, nodes.length)
        nodes.push(new THREE.Vector3(x, FLOOR_Y, z))
      }
    const floorLinks: number[] = []
    key.forEach((idx, k) => {
      const [i, j] = k.split(',').map(Number)
      for (const [di, dj] of [
        [1, 0],
        [0, 1],
      ]) {
        const o = key.get(`${i + di},${j + dj}`)
        if (o === undefined || Math.abs(i * 7 + j * 13 + di) % 3 === 0) continue
        const a = nodes[idx]
        const b = nodes[o]
        floorLinks.push(a.x, a.y, a.z, b.x, b.y, b.z)
      }
    })

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
      dialTicks: segs(ticks),
      dialRing: ring(DIAL_R * 1.06, 96, 'xy'),
      dialArc: new THREE.BufferGeometry().setFromPoints(arcPts),
      dialHand: segs([0, 0, 0, 0, DIAL_R * 0.74, 0]),
      beams: segs(beams),
      lattice: buildLattice(),
      cage: buildCage(),
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
      flashRing: new THREE.RingGeometry(0.05 * R, 0.058 * R, 40),
      halo: new THREE.RingGeometry(0.12 * R, 0.13 * R, 48),
      planeLines: segs([-PR, 0, 0, PR, 0, 0, 0, 0, -PR, 0, 0, PR]),
      planeRings: [0.9, 1.8, 2.7].map((k) => ring(k * R, 128)),
      unit: ring(1, 128),
      radarEdge: segs([0, 0, 0, PR, 0, 0]),
      floorNodes: nodes,
      floorLinks: segs(floorLinks),
    }
  }, [])

  const shards = useMemo<Shards>(
    () => ({ pos: new Float32Array(N_SHARD * 3), vel: new Float32Array(N_SHARD * 3), dir: new Float32Array(N_SHARD * 3), life: new Float32Array(N_SHARD), col: new Float32Array(N_SHARD * 3), next: 0 }),
    [],
  )
  const shardBuf = useMemo(() => ({ pos: new Float32Array(N_SHARD * 6), col: new Float32Array(N_SHARD * 6) }), [])
  const condense = useMemo(() => {
    const n = 110
    const from = new Float32Array(n * 3)
    const to = new Float32Array(n * 3)
    const h = 0.12 * R
    for (let i = 0; i < n; i++) {
      const a = CURVE.getPoint(0.04 + Math.random() * 0.92)
      const b = P_HOVER.clone().add(new THREE.Vector3((Math.random() - 0.5) * 2 * h, (Math.random() - 0.5) * 2 * h, (Math.random() - 0.5) * 2 * h))
      from.set([a.x, a.y, a.z], i * 3)
      to.set([b.x, b.y, b.z], i * 3)
    }
    return { n, from, to, cur: new Float32Array(n * 3), delay: Float32Array.from({ length: n }, () => Math.random() * 0.3) }
  }, [])
  const floor = useMemo(() => {
    const n = geo.floorNodes.length
    const pos = new Float32Array(n * 3)
    geo.floorNodes.forEach((v, i) => pos.set([v.x, v.y, v.z], i * 3))
    return { n, pos, col: new Float32Array(n * 3), dist: geo.floorNodes.map((v) => Math.hypot(v.x, v.z) / R) }
  }, [geo])
  const pk = useMemo(() => ({ link: new Float32Array(12 * 3), siphon: new Float32Array(6 * 3) }), [])
  const tmp = useMemo(() => ({ v: new THREE.Vector3(), w: new THREE.Vector3(), c: new THREE.Color(), p: new THREE.Vector3(), l: new THREE.Vector3() }), [])

  useFrame(({ clock }, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05)
    const t = clock.elapsedTime
    const s = st.current
    const { active, scanning, stage, vulnerable, patching, patched, anchored, rescan } = story
    const results = active && !scanning
    const self = g.self.current
    if (self) self.updateMatrixWorld()

    // ── camera framing per stage (world space; the root group has no rotation) ──
    // In AR the viewer's own head / phone is the camera, so no framing or flights.
    const mode: CamMode = !results ? 'base' : stage === 2 && vulnerable ? 'vault' : stage === 4 ? 'wide' : stage === 5 ? 'radar' : 'base'
    if (xrState.presenting) s.mode = ''
    else if (self) {
      const toWorld = (x: number, y: number, z: number, out: THREE.Vector3) => out.set(x, y, z).applyMatrix4(self.matrixWorld)
      const k = self.getWorldScale(tmp.w).x * R // one globe radius in world units
      if (mode === 'vault') {
        toWorld(0.47 * R, -1.62 * R, 0.8 * R, tmp.l)
        tmp.p.copy(tmp.l).add(tmp.v.set(0, 0.5 * k, 4.6 * k))
      } else if (mode === 'wide') {
        toWorld(0, 0.7 * R, 0, tmp.l)
        tmp.p.copy(tmp.l).add(tmp.v.set(0, 2.3 * k, 13.4 * k))
      } else if (mode === 'radar') {
        toWorld(0, 0.05 * R, 0, tmp.l)
        tmp.p.copy(tmp.l).add(tmp.v.set(0, 3.6 * k, 10.4 * k))
      } else {
        tmp.p.set(0, 0.9, 7.4)
        tmp.l.set(0, 0, 0)
      }
      if (mode !== 'base') {
        // keep the framed subject centred in the core zone between the floating panes
        const z = coreZone()
        const wpp = (2 * tmp.p.distanceTo(tmp.l) * Math.tan(THREE.MathUtils.degToRad(19))) / size.height
        tmp.v.set(-(z.x + z.w / 2 - size.width / 2) * wpp, (z.y + z.h / 2 - size.height / 2) * wpp, 0)
        tmp.p.add(tmp.v)
        tmp.l.add(tmp.v)
      }
      // Cinematic flight to the stage framing: a GSAP expo in-out tween drives the progress; the path is
      // spherical about the moving focal point with a mid-flight rise and orbital sweep ("swoop"),
      // strongest for the pull-back into the Merkle tree.
      const f = s.flight
      const modeKey = `${mode}|${size.width}x${size.height}`
      if (modeKey !== s.mode || s.reframe) {
        const first = s.mode === ''
        s.mode = modeKey
        s.reframe = false
        f.active = true
        f.fromT.copy(controls.target)
        f.from.setFromVector3(tmp.v.copy(camera.position).sub(controls.target))
        const travel = camera.position.distanceTo(tmp.p) + controls.target.distanceTo(tmp.l)
        f.swoop = mode === 'wide' ? 1.25 : mode === 'radar' ? 0.8 : mode === 'vault' ? 0.6 : 0.35
        f.dur = Math.min(3.6, Math.max(mode === 'wide' ? 3 : 1.9, 1.5 + travel * 0.4))
        gsap.killTweensOf(f)
        if (first) f.t = 1
        else {
          f.t = 0
          gsap.to(f, { t: 1, duration: f.dur, ease: 'expo.inOut' })
        }
      }
      if (f.active) {
        const e = f.t // already eased by GSAP
        const arc = Math.sin(Math.PI * e)
        f.to.setFromVector3(tmp.v.copy(tmp.p).sub(tmp.l))
        let dTheta = f.to.theta - f.from.theta
        if (dTheta > Math.PI) dTheta -= Math.PI * 2
        if (dTheta < -Math.PI) dTheta += Math.PI * 2
        sph.set(
          THREE.MathUtils.lerp(f.from.radius, f.to.radius, e) * (1 + 0.22 * f.swoop * arc),
          THREE.MathUtils.clamp(THREE.MathUtils.lerp(f.from.phi, f.to.phi, e) - 0.36 * f.swoop * arc, 0.08, Math.PI - 0.08),
          f.from.theta + dTheta * e + 0.34 * f.swoop * arc,
        )
        controls.target.copy(f.fromT).lerp(tmp.l, e)
        camera.position.setFromSpherical(sph).add(controls.target)
        if (f.t >= 1) f.active = false
      }
      controls.update()
      const fog = scene.fog as THREE.Fog | null
      if (fog) {
        const d = camera.position.distanceTo(controls.target)
        // a long falloff: the deck and rack ring recede into the dark instead of stopping at the core
        fog.near = d - 1.25
        fog.far = d + 9
      }
    }

    // ── 1 · fragile white link + packets ──
    fade(g.ends.current, active ? 1 : 0, dt)
    const pAge = edge(s.patch, patching || patched, t)
    s.prog = patched ? Math.min(1, s.prog + dt / 0.45) : patching ? Math.min(0.92, s.prog + dt / 1.8) : 0
    fade(g.link.current, active && !patching && !patched ? 1 : 0, dt, patching || patched ? 40 : 5)
    if (linkMat.current) linkMat.current.userData.base = 0.55 + 0.1 * Math.sin(t * 7) * Math.sin(t * 2.3)
    const compressing = stage === 4 && anchored && t - s.anchored.t0 < 1.3
    fade(g.lattice.current, patching || patched ? (compressing ? 0.3 : 1) : 0, dt, 4)
    if (packetMat.current) {
      packetMat.current.color.copy(patched ? G_ICE : G_WHITE)
      packetMat.current.visible = active
    }
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

    // ── 1 · pulsing crimson wiretap into adversary storage ──
    const harvesting = results && vulnerable && !patched && stage <= 3
    const hAge = edge(s.harvest, results && vulnerable, t)
    fade(g.harvest.current, harvesting ? 1 : 0, dt, patched ? 30 : 4)
    if (siphonMat.current) siphonMat.current.userData.base = 0.45 + 0.45 * (0.5 + 0.5 * Math.sin(t * 5))
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

    // ── 2 · Q-Day dial projected from the storage node ──
    fade(g.dial.current, results && vulnerable && stage === 2 ? 1 : 0, dt, 3)
    if (dialFace.current) dialFace.current.quaternion.copy(camera.quaternion)
    {
      const qday = Date.UTC(2033, 0, 1)
      const left = clamp01((qday - Date.now()) / (qday - Date.UTC(2026, 0, 1)))
      geo.dialArc.setDrawRange(0, Math.max(2, Math.round(left * 128) + 1))
    }
    if (dialHand.current) dialHand.current.rotation.z = -(((Date.now() / 1000) % 60) / 60) * Math.PI * 2

    // ── 3 · white link shatters, lattice cages wrap the endpoints, wiretap snaps ──
    if (!patching && !patched) s.shattered = false
    if ((patching || patched) && !s.shattered && pAge >= 0 && pAge < 0.5) {
      s.shattered = true
      if (results && stage <= 3) {
        for (let i = 0; i <= 36; i++) burst(shards, CURVE.getPoint(i / 36, tmp.w), 1, 0.35 * R, G_WHITE, 0.035)
        if (vulnerable) burst(shards, P_TAP, 14, 0.8 * R, G_CRIMSON)
      }
    }
    const lat = geo.lattice
    latLines.current?.geometry.setDrawRange(0, Math.floor(ease(s.prog) * lat.segCount) * 2)
    latPoints.current?.geometry.setDrawRange(0, Math.floor(ease(s.prog) * lat.vertCount))
    fade(g.cages.current, patching || patched ? 1 : 0, dt, 4)
    cageSpin.current.forEach((c, i) => {
      if (!c) return
      c.rotation.y += dt * (i ? -0.3 : 0.3)
      c.rotation.x += dt * 0.12
      c.scale.setScalar((0.2 + 0.8 * ease(clamp01(pAge / 1.4))) * (1 + 0.05 * s.flash))
    })
    const done = results && stage === 5 && rescan === 'done'
    cageMat.current.forEach((m) => {
      if (!m) return
      m.color.copy(done ? G_EMERALD : G_LATTICE)
      m.userData.base = 0.5 + 0.35 * s.flash
    })

    // the adversary keeps probing; each wiretap snaps and dissolves on contact with the lattice
    const probing = patched && vulnerable && stage === 3 && pAge > 2.2
    let probeLen = 0
    if (probing) {
      const ph = (pAge - 2.2) % 3
      probeLen = ph < 0.8 ? ease(ph / 0.8) : 0
      if (s.probePh < 0.8 && ph >= 0.8) {
        burst(shards, P_CONTACT, 16, 0.6 * R, G_CRIMSON, 0.025)
        burst(shards, P_CONTACT, 6, 0.35 * R, G_CYAN, 0.02)
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
    if (flash.current) {
      const f = s.flash
      flash.current.visible = f > 0.01 && stage === 3
      flash.current.scale.setScalar(1 + (1 - f) * 2.2)
      flash.current.quaternion.copy(camera.quaternion)
      ;(flash.current.material as THREE.MeshBasicMaterial).opacity = f * 0.9
    }
    s.flash = Math.max(0, s.flash - dt * 2.2)

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

    // ── 4 · secured link compresses into a block that drops and snaps into the chain ──
    const la = edge(s.anchored, anchored, t)
    const fL = fade(g.ledger.current, results && stage === 4 ? 1 : 0, dt)
    fade(g.condense.current, la >= 0 && la < 1.15 ? fL : 0, dt, 10)
    if (condenseGeo.current && la >= 0 && la < 1.3) {
      const c = condense
      for (let i = 0; i < c.n; i++) {
        const u = ease(clamp01((la - c.delay[i]) / 0.8))
        for (let a = 0; a < 3; a++) c.cur[i * 3 + a] = c.from[i * 3 + a] + (c.to[i * 3 + a] - c.from[i * 3 + a]) * u
      }
      ;(condenseGeo.current.attributes.position as THREE.BufferAttribute).set(c.cur)
      condenseGeo.current.attributes.position.needsUpdate = true
    }
    leafMats.current.forEach((m, i) => {
      if (!m) return
      const lit = la > 0.2 + i * 0.15 && i < 3
      m.userData.base = lit ? 0.95 : 0.28
      m.color.copy(lit ? CYAN : STEEL)
    })
    fade(g.tree.current, la > 0.7 ? fL : 0, dt, 6)
    // hover while forming (0.75-1.25 s), fall (1.25-1.6 s), snap
    const fall = clamp01((la - 1.25) / 0.35)
    fade(g.block.current, la > 0.75 ? fL : 0, dt, 10)
    if (g.block.current) {
      const snapT = la - 1.6
      const bounce = snapT > 0 ? Math.exp(-snapT * 9) * Math.cos(snapT * 30) * 0.12 : 0
      g.block.current.position.y = (1 - fall * fall) * (P_HOVER.y - P_BLOCK.y)
      g.block.current.rotation.y = la < 1.6 ? (1 - fall) * t * 0.8 : 0
      g.block.current.scale.setScalar(1 + bounce)
    }
    if (la >= 1.6 && !s.snapped) {
      s.snapped = true
      if (stage === 4) {
        burst(shards, P_BLOCK, 18, 0.5 * R, G_EMERALD, 0.02)
        sfx.vaultLock()
      }
    }
    if (la < 0) s.snapped = false
    if (blockMat.current) blockMat.current.color.copy(la < 1.6 ? G_ICE : tmp.c.copy(G_WHITE).lerp(G_EMERALD, clamp01((la - 1.6) / 0.5)))
    if (blockGlass.current) {
      const snap = la >= 1.6 ? Math.exp(-(la - 1.6) * 3) : 0
      blockGlass.current.emissive.copy(la < 1.6 ? ICE : EMERALD)
      blockGlass.current.emissiveIntensity = blockGlass.current.userData.ei = la < 0.75 ? 0 : la < 1.6 ? 0.9 : 0.55 + 3.2 * snap
    }
    if (lock.current) {
      const lk = clamp01((la - 1.6) / 0.7)
      lock.current.visible = la > 1.6 && lk < 1
      lock.current.scale.setScalar(1 + lk * 1.8)
      ;(lock.current.material as THREE.MeshBasicMaterial).opacity = (1 - lk) * 0.9 * fL
      lock.current.quaternion.copy(camera.quaternion)
    }
    fade(g.chain.current, la > 1.6 ? fL : 0, dt, 8)

    // ── 5 · radar plane drops over the topology; nodes lock emerald ──
    const rAge = edge(s.rescan, rescan !== 'idle', t)
    const onFive = results && stage === 5
    fade(g.radar.current, onFive && rescan !== 'idle' ? (rescan === 'done' ? 0.35 : 1) : 0, dt, 3)
    fade(g.floor.current, onFive ? 1 : 0, dt, 3)
    const drop = rAge < 0 ? 0 : ease(clamp01(rAge / 2.4))
    const py = 2.4 * R + (FLOOR_Y - 2.4 * R) * drop
    if (plane.current) plane.current.position.y = py
    if (cut.current) {
      const rr = Math.sqrt(Math.max(0, R * R - py * py))
      cut.current.visible = rr > 0.01
      cut.current.scale.setScalar(Math.max(0.001, rr * 1.01))
    }
    s.sweepA += dt * (rescan === 'running' ? 6.5 : 0.8)
    if (sweep.current) sweep.current.rotation.y = s.sweepA
    for (let i = 0; i < floor.n; i++) {
      const lit = rAge >= 0 && (drop >= 1 || done) && rAge > 2.4 + floor.dist[i] * 0.12
      const b = lit ? 0.65 + 0.35 * Math.sin(t * 3.9 - floor.dist[i] * 1.2) : 0.5
      tmp.c.copy(lit ? EMERALD : STEEL).multiplyScalar(b)
      floor.col.set([tmp.c.r, tmp.c.g, tmp.c.b], i * 3)
    }
    if (floorGeo.current) {
      ;(floorGeo.current.attributes.color as THREE.BufferAttribute).set(floor.col)
      floorGeo.current.attributes.color.needsUpdate = true
    }
    floorLinkMat.current?.color.copy(done ? EMERALD : STEEL)
    const fH = fade(g.halos.current, done ? 1 : 0, dt)
    halo.current.forEach((h, i) => {
      if (!h) return
      const ph = (t / 1.6 + i * 0.5) % 1
      h.scale.setScalar(1 + ph * 1.4)
      h.quaternion.copy(camera.quaternion)
      ;(h.material as THREE.MeshBasicMaterial).opacity = (1 - ph) * 0.8 * fH
    })

    // ── render stats (proof this is a live WebGL scene) ──
    s.frames++
    s.fpsT += dtRaw
    if (s.fpsT >= 0.5) {
      hudAnchor.stats = { fps: Math.round(s.frames / s.fpsT), calls: gl.info.render.calls, points: gl.info.render.points + gl.info.render.lines, flying: s.flight.active }
      s.frames = 0
      s.fpsT = 0
    }

    // ── dynamic lights: the crimson tap, the cyan lattice and shields, the emerald block ──
    const L = (l: THREE.PointLight | null, target: number) => {
      if (l) l.intensity += (target - l.intensity) * (1 - Math.exp(-dt * 4))
    }
    L(light.tap.current, harvesting ? 0.35 + 0.25 * Math.sin(t * 5) : 0)
    L(light.link.current, patched && stage <= 5 ? 0.6 + 0.9 * s.flash : patching ? 0.4 : 0)
    L(light.client.current, patched ? 0.35 : 0)
    L(light.server.current, patched ? 0.35 : 0)
    L(light.block.current, stage === 4 && la >= 1.6 ? 0.45 + 2.5 * Math.exp(-(la - 1.6) * 3) : 0)

    // ── raycast hover: glow + scale the inspected object, publish it for the HTML tooltip ──
    let hit: string | null = null
    const ptr = pointer.current
    if (ptr.inside && !ptr.dragging && !s.flight.active) {
      ray.setFromCamera(ptr.ndc, camera)
      const meshes: THREE.Object3D[] = []
      for (const id in hov.current) {
        const h0 = hov.current[id]
        if (h0 && visibleDeep(h0) && ((h0.parent?.userData.f as number | undefined) ?? 1) > 0.3) h0.traverse((o) => (o as THREE.Mesh).isMesh && meshes.push(o))
      }
      for (const h1 of ray.intersectObjects(meshes, false)) {
        let o: THREE.Object3D | null = h1.object
        while (o && !o.userData.inspect) o = o.parent
        if (o) {
          hit = o.userData.inspect as string
          break
        }
      }
    }
    if (hit !== s.hover) {
      s.hover = hit
      gl.domElement.style.cursor = hit ? 'crosshair' : ''
    }
    for (const id in hov.current) {
      const h0 = hov.current[id]
      if (!h0) continue
      const was = (h0.userData.h as number | undefined) ?? 0
      const now = was + ((id === hit ? 1 : 0) - was) * (1 - Math.exp(-dt * 14))
      h0.userData.h = now
      if (now < 0.002 && was < 0.002) continue
      h0.scale.setScalar(1 + 0.09 * now)
      h0.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined
        if (m && 'emissiveIntensity' in m) {
          if (m.userData.ei === undefined) m.userData.ei = m.emissiveIntensity
          m.emissiveIntensity = (m.userData.ei as number) + 0.9 * now
        }
      })
    }
    if (hit && hov.current[hit]) {
      hov.current[hit]!.getWorldPosition(tmp.v).project(camera)
      hudAnchor.hover = { id: hit, x: (tmp.v.x * 0.5 + 0.5) * size.width, y: (-tmp.v.y * 0.5 + 0.5) * size.height }
    } else hudAnchor.hover = null

    // ── publish story anchors in screen pixels ──
    if (self) {
      for (const k in ANCHORS) {
        tmp.v.copy(ANCHORS[k]).applyMatrix4(self.matrixWorld).project(camera)
        hudAnchor.points[k] = { x: (tmp.v.x * 0.5 + 0.5) * size.width, y: (-tmp.v.y * 0.5 + 0.5) * size.height, on: tmp.v.z < 1 }
      }
    }
  })

  const endCol = story.stage === 5 && story.rescan === 'done' ? EMERALD : WHITE
  const line = (color: THREE.Color, opacity: number) => <lineBasicMaterial color={color} transparent opacity={opacity} depthWrite={false} />
  // PBR: clear acrylic / glass (clearcoat, low roughness) and brushed titanium (high metalness), lit by the room environment
  const glass = (color: string, emissive: THREE.Color, opacity = 0.2, ei = 0.12) => (
    <meshPhysicalMaterial color={color} emissive={emissive} emissiveIntensity={ei} roughness={0.08} metalness={0.05} clearcoat={1} clearcoatRoughness={0.05} ior={1.49} transparent opacity={opacity} depthWrite={false} envMapIntensity={1.5} side={THREE.DoubleSide} />
  )
  const metal = (color = '#3a4552', roughness = 0.32) => <meshStandardMaterial color={color} metalness={0.92} roughness={roughness} emissive={ICE} emissiveIntensity={0} transparent opacity={1} envMapIntensity={1.2} />
  const hitbox = (r: number) => (
    <mesh>
      <sphereGeometry args={[r, 12, 8]} />
      <meshBasicMaterial visible={false} />
    </mesh>
  )

  return (
    <group ref={g.self}>
      {/* dynamic lights: they light the PBR bodies and follow the story state */}
      <pointLight ref={light.tap} position={P_TAP.clone().add(v3(0, 0.12, 0.3))} color={CRIMSON} intensity={0} decay={2} />
      <pointLight ref={light.link} position={P_TAP.clone().add(v3(0, 0.3, 0.45))} color={CYAN} intensity={0} decay={2} />
      <pointLight ref={light.client} position={P_CLIENT.clone().add(v3(0.15, 0.1, 0.4))} color={CYAN} intensity={0} decay={2} />
      <pointLight ref={light.server} position={P_SERVER.clone().add(v3(-0.15, 0.1, 0.4))} color={CYAN} intensity={0} decay={2} />
      <pointLight ref={light.block} position={P_BLOCK.clone().add(v3(0, 0.05, 0.45))} color={EMERALD} intensity={0} decay={2} />

      {/* client + server nodes */}
      <group ref={g.ends} visible={false}>
        <group position={P_CLIENT}>
          <group ref={H('client')}>
            <mesh position={[0, 0, 0.004 * R]}>
              <boxGeometry args={[0.3 * R, 0.18 * R, 0.01 * R]} />
              {glass('#0b2030', ICE, 0.55, 0.35)}
            </mesh>
            <mesh position={[0, 0, -0.008 * R]}>
              <boxGeometry args={[0.32 * R, 0.2 * R, 0.012 * R]} />
              {metal('#2b343e', 0.28)}
            </mesh>
            <mesh position={[0, -0.135 * R, -0.01 * R]}>
              <cylinderGeometry args={[0.008 * R, 0.01 * R, 0.07 * R, 12]} />
              {metal('#5a6672', 0.22)}
            </mesh>
            <mesh position={[0, -0.172 * R, 0]}>
              <boxGeometry args={[0.16 * R, 0.008 * R, 0.06 * R]} />
              {metal()}
            </mesh>
            <lineSegments geometry={geo.client}>{line(endCol, 0.85)}</lineSegments>
          </group>
        </group>
        <group position={P_SERVER}>
          <group ref={H('server')}>
            <mesh>
              <boxGeometry args={[0.19 * R, 0.33 * R, 0.19 * R]} />
              {metal('#222b35', 0.36)}
            </mesh>
            {[-0.09, -0.03, 0.03, 0.09].map((y) => (
              <mesh key={y} position={[0, y * R, 0.0962 * R]}>
                <boxGeometry args={[0.13 * R, 0.01 * R, 0.002 * R]} />
                <meshStandardMaterial color="#061218" emissive={story.patched ? CYAN : ICE} emissiveIntensity={1.6} transparent opacity={1} />
              </mesh>
            ))}
            <lineSegments geometry={geo.server}>{line(endCol, 0.85)}</lineSegments>
          </group>
        </group>
      </group>

      {/* lattice cages (ML-KEM / ML-DSA) wrapping client and server */}
      <group ref={g.cages} visible={false}>
        {[P_CLIENT, P_SERVER].map((p, i) => (
          <group key={i} position={p}>
            <group ref={H(`cage${i}`)}>{hitbox(CAGE_R)}</group>
            <group ref={(el) => { cageSpin.current[i] = el }}>
              <lineSegments geometry={geo.cage.outer}>
                <lineBasicMaterial ref={(m) => { cageMat.current[i] = m }} color={G_LATTICE} transparent opacity={0.5} depthWrite={false} />
              </lineSegments>
              <lineSegments geometry={geo.cage.inner}>{line(ICE, 0.35)}</lineSegments>
              <lineSegments geometry={geo.cage.struts}>{line(CYAN, 0.22)}</lineSegments>
              <points geometry={geo.cage.nodes}>
                <pointsMaterial color={G_ICE} size={2.4} sizeAttenuation={false} transparent opacity={0.9} depthWrite={false} />
              </points>
            </group>
          </group>
        ))}
      </group>

      {/* fragile classical link (RSA / ECDSA TLS) */}
      <group ref={g.link} visible={false}>
        <line>
          <primitive object={geo.curve} attach="geometry" />
          <lineBasicMaterial ref={linkMat} color={WHITE} transparent opacity={0.6} depthWrite={false} />
        </line>
      </group>
      <points>
        <bufferGeometry ref={packets}>
          <bufferAttribute attach="attributes-position" args={[pk.link, 3]} />
        </bufferGeometry>
        <pointsMaterial ref={packetMat} color={G_WHITE} size={3} sizeAttenuation={false} transparent opacity={0.9} depthWrite={false} visible={false} />
      </points>

      {/* lattice tube replacing the link */}
      <group ref={g.lattice} visible={false}>
        <lineSegments ref={latLines} geometry={geo.lattice.lines}>{line(G_LATTICE, 0.36)}</lineSegments>
        <points ref={latPoints} geometry={geo.lattice.points}>
          <pointsMaterial color={G_ICE} size={2.2} sizeAttenuation={false} transparent opacity={0.9} depthWrite={false} />
        </points>
      </group>

      {/* crimson wiretap: clamp on the link, pulsing siphon into storage */}
      <group ref={g.harvest} visible={false}>
        <group position={P_TAP}>
          <group ref={H('tap')}>
            <mesh rotation={[0, Math.PI / 2, 0]}>
              <torusGeometry args={[0.07 * R, 0.013 * R, 10, 40]} />
              <meshStandardMaterial color="#3a1416" metalness={0.85} roughness={0.3} emissive={CRIMSON} emissiveIntensity={0.6} transparent opacity={1} />
            </mesh>
            <lineLoop geometry={geo.clampA}>{line(G_CRIMSON, 0.95)}</lineLoop>
            <lineLoop geometry={geo.clampB}>{line(CRIMSON, 0.45)}</lineLoop>
            {hitbox(0.12 * R)}
          </group>
        </group>
        <line>
          <primitive object={geo.siphon} attach="geometry" />
          <lineBasicMaterial ref={siphonMat} color={G_CRIMSON} transparent opacity={0.8} depthWrite={false} />
        </line>
        <points>
          <bufferGeometry ref={siphonPk}>
            <bufferAttribute attach="attributes-position" args={[pk.siphon, 3]} />
          </bufferGeometry>
          <pointsMaterial color={G_CRIMSON} size={3} sizeAttenuation={false} transparent opacity={1} depthWrite={false} />
        </points>
      </group>

      {/* adversary storage node */}
      <group ref={g.vault} visible={false} position={P_VAULT}>
        <group ref={H('vault')}>
        <mesh>
          <cylinderGeometry args={[VAULT_R, VAULT_R, VAULT_H, 48, 1, true]} />
          {glass('#2a0a0c', CRIMSON, 0.2, 0.1)}
        </mesh>
        {[-VAULT_H / 2, VAULT_H / 2].map((y) => (
          <mesh key={y} position={[0, y, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[VAULT_R, 0.014 * R, 8, 64]} />
            {metal('#454f5a', 0.26)}
          </mesh>
        ))}
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
      </group>

      {/* Q-Day dial + projector beams (amber) */}
      <group ref={g.dial} visible={false}>
        <lineSegments geometry={geo.beams}>{line(AMBER, 0.28)}</lineSegments>
        <group position={P_DIAL}>
          <group ref={dialFace}>
            <lineSegments geometry={geo.dialTicks}>{line(AMBER, 0.75)}</lineSegments>
            <lineLoop geometry={geo.dialRing}>{line(AMBER, 0.3)}</lineLoop>
            <line>
              <primitive object={geo.dialArc} attach="geometry" />
              <lineBasicMaterial color={G_AMBER} transparent opacity={1} depthWrite={false} />
            </line>
            <group ref={dialHand}>
              <lineSegments geometry={geo.dialHand}>{line(WHITE, 0.7)}</lineSegments>
            </group>
          </group>
        </group>
      </group>

      {/* adversary probe + contact flash */}
      <group ref={g.probe} visible={false}>
        <line>
          <bufferGeometry ref={probeGeo}>
            <bufferAttribute attach="attributes-position" args={[new Float32Array([P_INTAKE.x, P_INTAKE.y, P_INTAKE.z, P_INTAKE.x, P_INTAKE.y, P_INTAKE.z]), 3]} />
          </bufferGeometry>
          <lineBasicMaterial color={G_CRIMSON} transparent opacity={0.9} depthWrite={false} />
        </line>
      </group>
      <mesh ref={flash} geometry={geo.flashRing} position={P_CONTACT} visible={false}>
        <meshBasicMaterial color={G_CYAN} transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>

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
          <group key={i} position={p} ref={i < 3 ? H(`leaf${i}`) : undefined}>
            <mesh>
              <boxGeometry args={[0.085 * R, 0.085 * R, 0.085 * R]} />
              {glass('#0c2a33', CYAN, i === 3 ? 0.06 : 0.16, 0.2)}
            </mesh>
            <lineSegments geometry={geo.leaf}>
              <lineBasicMaterial ref={(m) => { leafMats.current[i] = m }} color={STEEL} transparent opacity={i === 3 ? 0.18 : 0.28} depthWrite={false} />
            </lineSegments>
          </group>
        ))}
        <group ref={g.condense} visible={false}>
          <points frustumCulled={false}>
            <bufferGeometry ref={condenseGeo}>
              <bufferAttribute attach="attributes-position" args={[condense.cur, 3]} />
            </bufferGeometry>
            <pointsMaterial color={ICE} size={2.4} sizeAttenuation={false} transparent opacity={0.95} depthWrite={false} />
          </points>
        </group>
        <group ref={g.tree} visible={false}>
          <lineSegments geometry={geo.treeEdges}>{line(CYAN, 0.45)}</lineSegments>
          {INNER.map((p, i) => (
            <group key={i} position={p}>
              <mesh>
                <boxGeometry args={[0.1 * R, 0.1 * R, 0.1 * R]} />
                {glass('#0c2a33', CYAN, 0.18, 0.3)}
              </mesh>
              <lineSegments geometry={geo.inner}>{line(CYAN, 0.8)}</lineSegments>
            </group>
          ))}
        </group>
        <group position={P_PREV} ref={H('prev')}>
          <mesh>
            <boxGeometry args={[0.2 * R, 0.2 * R, 0.2 * R]} />
            {glass('#10202a', STEEL, 0.2, 0.08)}
          </mesh>
          <lineSegments geometry={geo.prev}>{line(STEEL, 0.55)}</lineSegments>
        </group>
        <primitive object={geo.nextSlot} />
        <group position={P_NEXT} ref={H('next')}>{hitbox(0.12 * R)}</group>
        <group position={P_BLOCK}>
          <group ref={g.block} visible={false}>
            <group ref={H('block')}>
              <mesh>
                <boxGeometry args={[0.26 * R, 0.26 * R, 0.26 * R]} />
                <meshPhysicalMaterial ref={blockGlass} color="#08241c" emissive={ICE} emissiveIntensity={0} roughness={0.06} metalness={0.05} clearcoat={1} clearcoatRoughness={0.04} ior={1.5} transparent opacity={0.3} depthWrite={false} envMapIntensity={1.6} side={THREE.DoubleSide} />
              </mesh>
            </group>
            <lineSegments geometry={geo.block}>
              <lineBasicMaterial ref={blockMat} color={ICE} transparent opacity={0.95} depthWrite={false} />
            </lineSegments>
            <lineSegments geometry={geo.root}>{line(EMERALD, 0.9)}</lineSegments>
          </group>
          <mesh ref={lock} geometry={geo.lockRing} visible={false}>
            <meshBasicMaterial color={G_EMERALD} transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
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

      {/* radar plane: drops from above the ledger to the floor, sweeping as it goes */}
      <group ref={g.radar} visible={false}>
        <group ref={plane}>
          <mesh rotation={[-Math.PI / 2, 0, 0]}>
            <circleGeometry args={[2.7 * R, 96]} />
            <meshBasicMaterial color={EMERALD} transparent opacity={0.035} depthWrite={false} side={THREE.DoubleSide} />
          </mesh>
          {geo.planeRings.map((rg, i) => (
            <lineLoop key={i} geometry={rg}>{line(EMERALD, i === 2 ? 0.55 : 0.22)}</lineLoop>
          ))}
          <lineSegments geometry={geo.planeLines}>{line(EMERALD, 0.18)}</lineSegments>
          <lineLoop ref={cut} geometry={geo.unit}>{line(G_EMERALD, 0.9)}</lineLoop>
          <group ref={sweep}>
            {[0.18, 0.36, 0.6].map((len, i) => (
              <mesh key={len} rotation={[-Math.PI / 2, 0, 0]}>
                <circleGeometry args={[2.7 * R, 32, -len, len]} />
                <meshBasicMaterial color={EMERALD} transparent opacity={0.08 - i * 0.02} depthWrite={false} side={THREE.DoubleSide} />
              </mesh>
            ))}
            <lineSegments geometry={geo.radarEdge}>{line(G_EMERALD, 0.9)}</lineSegments>
          </group>
        </group>
      </group>

      {/* network topology on the floor grid */}
      <group ref={g.floor} visible={false}>
        <lineSegments geometry={geo.floorLinks}>
          <lineBasicMaterial ref={floorLinkMat} color={STEEL} transparent opacity={0.3} depthWrite={false} />
        </lineSegments>
        <points frustumCulled={false}>
          <bufferGeometry ref={floorGeo}>
            <bufferAttribute attach="attributes-position" args={[floor.pos, 3]} />
            <bufferAttribute attach="attributes-color" args={[floor.col, 3]} />
          </bufferGeometry>
          <pointsMaterial size={4.5} sizeAttenuation={false} vertexColors transparent opacity={1} depthWrite={false} />
        </points>
      </group>

      {/* stable emerald pulses on the endpoints once verified */}
      <group ref={g.halos} visible={false}>
        {[P_CLIENT, P_SERVER, P_TAP].map((p, i) => (
          <mesh key={i} ref={(m) => { halo.current[i] = m }} geometry={geo.halo} position={p}>
            <meshBasicMaterial color={G_EMERALD} transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
          </mesh>
        ))}
      </group>
    </group>
  )
}
