import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { Status, VectorId } from '@/lib/types'
import { makeDotTexture, makeLabelTexture } from './textures'

export interface LatticeNode {
  id: VectorId
  abbr: string
  name: string
  status: Status
  summary: string
}

const HEX: Record<Status, string> = {
  pass: '#10b981',
  warn: '#f59e0b',
  fail: '#ef4444',
  info: '#64748b',
  error: '#475569',
}
const PALETTE = Object.fromEntries(Object.entries(HEX).map(([k, v]) => [k, new THREE.Color(v)])) as Record<
  Status,
  THREE.Color
>
// Bloom only picks up colours brighter than 1.0, so these multipliers decide
// what glows: live links and passing nodes do, unmeasured ones stay dark.
const GLOW: Record<Status, number> = { pass: 2.6, warn: 1.9, fail: 3, info: 0.5, error: 0.4 }

const ORBIT_R = 3.4
const CORE_R = 1.15
const NODE_R = 0.26
const ORBIT_SPEED = 0.11
const TILTS = [-0.4, 0, 0.4]
// Data streams: each link carries STREAM packets, each drawn with a fading
// TRAIL, plus SPARKS points reserved for the break on failing links.
const STREAM = 10
const TRAIL = 3
const TRAIL_GAP = 0.022
const TRAIL_FADE = [1, 0.45, 0.18]
const SPARKS = 2
// Failing links also shed DEBRIS short fragments that scatter around the break.
const DEBRIS = 6
const POINTS_PER_LINK = STREAM * TRAIL + SPARKS
const WHITE = new THREE.Color(1, 1, 1)
const UP = new THREE.Vector3(0, 1, 0)

const rand = (min: number, max: number) => min + Math.random() * (max - min)
/** Deterministic 0..1 noise, so each packet keeps its own speed and phase. */
const hash = (n: number) => {
  const x = Math.sin(n * 12.9898) * 43758.5453
  return x - Math.floor(x)
}

interface Packet {
  phase: number
  speed: number
  inbound: boolean // responses flow node -> core, requests core -> node
  dropAt: number // packet loss point on degraded (warn) links; >1 = never
}

interface Shard {
  dir: THREE.Vector3 // scatter direction from the break
  spin: THREE.Vector3 // second axis the shard tumbles through
  reach: number
  length: number
  rate: number
  phase: number
}

function makeShards(count: number): Shard[][] {
  return Array.from({ length: count }, (_, i) =>
    Array.from({ length: DEBRIS }, (_, k) => {
      const seed = i * 53.7 + k * 7.9
      const dir = new THREE.Vector3(hash(seed) - 0.5, hash(seed + 1) - 0.5, hash(seed + 2) - 0.5).normalize()
      const spin = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0))
      if (spin.lengthSq() < 1e-4) spin.set(1, 0, 0)
      return {
        dir,
        spin: spin.normalize(),
        reach: 0.18 + 0.32 * hash(seed + 3),
        length: 0.07 + 0.12 * hash(seed + 4),
        rate: 0.6 + 1.8 * hash(seed + 5),
        phase: hash(seed + 6) * Math.PI * 2,
      }
    }),
  )
}

/** Lat/long wireframe sphere as line segments (a clean globe, no triangle edges). */
function globeGeometry(radius: number, parallels = 8, meridians = 12, steps = 64): THREE.BufferGeometry {
  const pts: number[] = []
  const at = (phi: number, theta: number) => [
    radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta),
  ]
  for (let i = 1; i < parallels; i++) {
    const phi = (i / parallels) * Math.PI
    for (let k = 0; k < steps; k++)
      pts.push(...at(phi, (k / steps) * Math.PI * 2), ...at(phi, ((k + 1) / steps) * Math.PI * 2))
  }
  for (let j = 0; j < meridians; j++) {
    const theta = (j / meridians) * Math.PI * 2
    for (let k = 0; k < steps / 2; k++)
      pts.push(...at((k / (steps / 2)) * Math.PI, theta), ...at(((k + 1) / (steps / 2)) * Math.PI, theta))
  }
  return new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
}

function makeStreams(count: number): Packet[][] {
  return Array.from({ length: count }, (_, i) =>
    Array.from({ length: STREAM }, (_, k) => {
      const seed = i * 97.3 + k * 13.1
      return {
        phase: hash(seed),
        speed: 0.55 + 0.95 * hash(seed + 1),
        inbound: k % 4 === 3,
        dropAt: hash(seed + 2) < 0.35 ? 0.3 + 0.5 * hash(seed + 3) : 2,
      }
    }),
  )
}

function nodePosition(i: number, count: number, t: number, out: THREE.Vector3) {
  const angle = (i / count) * Math.PI * 2 + t * ORBIT_SPEED
  const tilt = TILTS[i % TILTS.length]
  const x = Math.cos(angle) * ORBIT_R
  const z = Math.sin(angle) * ORBIT_R
  // Point on a flat ring, rotated about X by the ring's tilt, plus a slow bob.
  return out.set(x, -z * Math.sin(tilt) + 0.12 * Math.sin(t * 0.9 + i * 1.7), z * Math.cos(tilt))
}

interface NodeAnim {
  status: Status | null // null until the first frame, so the intro snap plays
  from: number
  target: 0 | 1
  changedAt: number
  glitchUntil: number
  nextGlitch: number
  jitter: THREE.Vector3
}

/**
 * 0 = link intact, 1 = fully snapped. Snapping is an under-damped spring
 * (overshoots, then settles); reconnecting is a clean exponential ease.
 */
function breakAmount(a: NodeAnim, t: number): number {
  const tau = t - a.changedAt
  if (tau <= 0) return a.from
  if (a.target === 1) return a.from + (1 - a.from) * (1 - Math.exp(-6 * tau) * Math.cos(14 * tau))
  return a.from * Math.exp(-7 * tau)
}

function freshAnim(): NodeAnim {
  return { status: null, from: 0, target: 0, changedAt: 0, glitchUntil: 0, nextGlitch: 0, jitter: new THREE.Vector3() }
}

function orbitRing(tilt: number): THREE.LineLoop {
  const points: THREE.Vector3[] = []
  for (let k = 0; k < 128; k++) {
    const a = (k / 128) * Math.PI * 2
    const z = Math.sin(a) * ORBIT_R
    points.push(new THREE.Vector3(Math.cos(a) * ORBIT_R, -z * Math.sin(tilt), z * Math.cos(tilt)))
  }
  const material = new THREE.LineBasicMaterial({ color: '#1e293b', transparent: true, opacity: 0.8 })
  return new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(points), material)
}

// --------------------------------------------------------------------------- //

interface SatelliteRefs {
  mount: THREE.Group | null // follows the orbit
  rotor: THREE.Group | null // spins + glitches
  wire: THREE.MeshBasicMaterial | null
  heart: THREE.MeshBasicMaterial | null
}

function Satellite({
  node,
  refs,
  onHover,
  onSelect,
}: {
  node: LatticeNode
  refs: SatelliteRefs
  onHover: (id: VectorId | null) => void
  onSelect: (id: VectorId) => void
}) {
  const label = useMemo(() => makeLabelTexture(node.abbr, HEX[node.status]), [node.abbr, node.status])
  useEffect(() => () => label.dispose(), [label])

  const over = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation()
    onHover(node.id)
    document.body.style.cursor = 'pointer'
  }
  const out = () => {
    onHover(null)
    document.body.style.cursor = ''
  }
  useEffect(() => () => void (document.body.style.cursor = ''), [])

  return (
    <group ref={(g) => void (refs.mount = g)}>
      <group ref={(g) => void (refs.rotor = g)}>
        <mesh>
          <octahedronGeometry args={[NODE_R, 0]} />
          <meshBasicMaterial ref={(m) => void (refs.wire = m)} wireframe toneMapped={false} />
        </mesh>
        <mesh>
          <octahedronGeometry args={[NODE_R * 0.42, 0]} />
          <meshBasicMaterial ref={(m) => void (refs.heart = m)} toneMapped={false} />
        </mesh>
      </group>
      {/* Invisible, generous hit target: 1px wireframes are hard to hover. */}
      <mesh
        onPointerOver={over}
        onPointerOut={out}
        onClick={(e) => {
          e.stopPropagation()
          onSelect(node.id)
        }}
      >
        <sphereGeometry args={[NODE_R * 2.2, 12, 12]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      <sprite position={[0, NODE_R + 0.32, 0]} scale={[1.1, 0.275, 1]}>
        <spriteMaterial map={label} transparent depthWrite={false} toneMapped={false} opacity={0.9} />
      </sprite>
    </group>
  )
}

// --------------------------------------------------------------------------- //

export function Lattice({
  nodes,
  score,
  hovered,
  focus,
  positions,
  reducedMotion,
  onHover,
  onSelect,
}: {
  nodes: LatticeNode[]
  score: number
  hovered: VectorId | null
  /** Node the camera is flying to; everything else dims. */
  focus: VectorId | null
  /** Written every frame with each node's (un-jittered) position, read by the camera rig. */
  positions: THREE.Vector3[]
  reducedMotion: boolean
  onHover: (id: VectorId | null) => void
  onSelect: (id: VectorId) => void
}) {
  const count = nodes.length
  const live = useRef({ nodes, hovered, focus, score, reducedMotion })
  useEffect(() => {
    live.current = { nodes, hovered, focus, score, reducedMotion }
  }, [nodes, hovered, focus, score, reducedMotion])

  const anims = useRef<NodeAnim[]>([])
  if (anims.current.length !== count) anims.current = nodes.map(freshAnim)
  const sats = useMemo<SatelliteRefs[]>(
    () => Array.from({ length: count }, () => ({ mount: null, rotor: null, wire: null, heart: null })),
    [count],
  )
  const streams = useMemo(() => makeStreams(count), [count])
  const shards = useMemo(() => makeShards(count), [count])
  const globe = useMemo(() => globeGeometry(CORE_R), [])
  const core = useRef<THREE.Group>(null)
  const coreWire = useRef<THREE.LineBasicMaterial>(null)
  const coreHeart = useRef<THREE.MeshBasicMaterial>(null)

  // Two segments per link (core->break, break->node), rewritten every frame.
  const links = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 12), 3).setUsage(THREE.DynamicDrawUsage))
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(count * 12), 3).setUsage(THREE.DynamicDrawUsage))
    return g
  }, [count])
  const packets = useMemo(() => {
    const n = count * POINTS_PER_LINK * 3
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n), 3).setUsage(THREE.DynamicDrawUsage))
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n), 3).setUsage(THREE.DynamicDrawUsage))
    return g
  }, [count])
  const debris = useMemo(() => {
    const g = new THREE.BufferGeometry()
    const n = count * DEBRIS * 2 * 3
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n), 3).setUsage(THREE.DynamicDrawUsage))
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n), 3).setUsage(THREE.DynamicDrawUsage))
    return g
  }, [count])
  const dot = useMemo(makeDotTexture, [])
  const rings = useMemo(() => TILTS.map(orbitRing), [])
  useEffect(
    () => () => {
      links.dispose()
      packets.dispose()
      debris.dispose()
      globe.dispose()
      dot.dispose()
      rings.forEach((r) => {
        r.geometry.dispose()
        ;(r.material as THREE.Material).dispose()
      })
    },
    [links, packets, debris, globe, dot, rings],
  )

  const v = useMemo(
    () => ({
      pos: new THREE.Vector3(),
      dir: new THREE.Vector3(),
      s: new THREE.Vector3(),
      e: new THREE.Vector3(),
      a: new THREE.Vector3(),
      b: new THREE.Vector3(),
      perp: new THREE.Vector3(),
      p: new THREE.Vector3(),
      c: new THREE.Color(),
      inbound: new THREE.Color(),
      mid: new THREE.Vector3(),
      q: new THREE.Vector3(),
      axis: new THREE.Vector3(),
    }),
    [],
  )

  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    const { nodes, hovered, focus, score, reducedMotion } = live.current
    const motion = reducedMotion ? 0 : 1
    const lp = links.attributes.position.array as Float32Array
    const lc = links.attributes.color.array as Float32Array
    const pp = packets.attributes.position.array as Float32Array
    const pc = packets.attributes.color.array as Float32Array
    const dp = debris.attributes.position.array as Float32Array
    const dc = debris.attributes.color.array as Float32Array

    const write = (arr: Float32Array, idx: number, x: number, y: number, z: number) => {
      arr[idx * 3] = x
      arr[idx * 3 + 1] = y
      arr[idx * 3 + 2] = z
    }
    const writeVec = (arr: Float32Array, idx: number, vec: THREE.Vector3) => write(arr, idx, vec.x, vec.y, vec.z)
    const writeCol = (arr: Float32Array, idx: number, col: THREE.Color, k: number) =>
      write(arr, idx, col.r * k, col.g * k, col.b * k)

    nodes.forEach((node, i) => {
      const anim = anims.current[i]
      const failing = node.status === 'fail'

      if (anim.status !== node.status) {
        const first = anim.status === null
        anim.from = breakAmount(anim, t)
        anim.target = failing ? 1 : 0
        // Stagger so multiple failures snap one after another.
        anim.changedAt = t + (first ? 0.6 + i * 0.12 : i * 0.05)
        anim.status = node.status
      }
      const broken = reducedMotion ? anim.target : breakAmount(anim, t)
      const snapped = failing && t > anim.changedAt

      // ---- satellite: orbit, spin, glitch ----
      nodePosition(i, count, t * motion, v.pos)
      positions[i]?.copy(v.pos)
      if (snapped && t > anim.nextGlitch) {
        anim.glitchUntil = t + rand(0.05, 0.2)
        anim.nextGlitch = anim.glitchUntil + rand(0.25, 1.2)
        anim.jitter.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).multiplyScalar(0.16)
      }
      const glitching = snapped && motion > 0 && t < anim.glitchUntil
      const isFocused = focus === node.id
      const isHovered = hovered === node.id || isFocused
      // While the camera is locked on one node, the rest of the lattice drops
      // below the bloom threshold so the target is the only thing glowing.
      const dim = focus && !isFocused ? 0.28 : 1
      const sat = sats[i]
      if (sat.mount) {
        sat.mount.position.copy(v.pos)
        if (glitching) sat.mount.position.add(anim.jitter)
      }
      if (sat.rotor) {
        const base = isHovered ? 1.4 : 1
        if (glitching) sat.rotor.scale.set(base * rand(0.5, 1.6), base * rand(0.4, 1.4), base * rand(0.7, 1.3))
        else sat.rotor.scale.setScalar(base)
        sat.rotor.rotation.set(t * 0.4 * motion + i, t * 0.7 * motion + i, glitching ? rand(-0.6, 0.6) : 0)
      }
      const glow = GLOW[node.status] * (isHovered ? 1.3 : 1) * dim
      if (sat.wire) {
        // Glitch frames flash hot red-white rather than pure white, so the node stays red under bloom.
        if (glitching && Math.random() > 0.5) sat.wire.color.setRGB(2.4 * dim, 0.85 * dim, 0.85 * dim)
        else sat.wire.color.copy(PALETTE[node.status]).multiplyScalar(glow)
      }
      if (sat.heart) {
        const flicker = failing ? 0.6 + 0.4 * Math.abs(Math.sin(t * 9 + i)) : 1
        sat.heart.color.copy(PALETTE[node.status]).multiplyScalar(glow * flicker)
      }

      // ---- link: intact, or snapped with recoil + droop ----
      v.dir.copy(v.pos).normalize()
      v.s.copy(v.dir).multiplyScalar(CORE_R)
      v.e.copy(v.pos).addScaledVector(v.dir, -(NODE_R + 0.08))
      if (broken < 0.001) {
        v.a.lerpVectors(v.s, v.e, 0.5)
        v.b.copy(v.a)
      } else {
        const tau = t - anim.changedAt
        v.a.lerpVectors(v.s, v.e, 0.5 - 0.22 * broken)
        v.b.lerpVectors(v.s, v.e, 0.5 + 0.22 * broken)
        v.perp.crossVectors(v.dir, UP)
        if (v.perp.lengthSq() < 1e-4) v.perp.set(1, 0, 0)
        v.perp.normalize()
        // A whip when it snaps, then a slow dangle.
        const whip = anim.target === 1 && tau > 0 ? 0.4 * Math.exp(-3 * tau) * Math.sin(22 * tau) : 0
        const sway = 0.05 * Math.sin(t * 2.3 + i)
        const lateral = motion * (whip + sway)
        v.a.y -= 0.45 * broken
        v.b.y -= 0.45 * broken
        v.a.addScaledVector(v.perp, lateral)
        v.b.addScaledVector(v.perp, -lateral)
      }
      const base = i * 4
      writeVec(lp, base, v.s)
      writeVec(lp, base + 1, v.a)
      writeVec(lp, base + 2, v.b)
      writeVec(lp, base + 3, v.e)

      // ---- debris: fragments scattered around the break, tumbling and flickering ----
      const shatter = failing ? Math.min(1, Math.max(0, (broken - 0.2) / 0.8)) : 0
      v.mid.addVectors(v.a, v.b).multiplyScalar(0.5)
      shards[i].forEach((sh, k) => {
        const idx = (i * DEBRIS + k) * 2
        if (shatter <= 0) {
          writeVec(dp, idx, v.mid) // zero-length: draws nothing
          writeVec(dp, idx + 1, v.mid)
          write(dc, idx, 0, 0, 0)
          write(dc, idx + 1, 0, 0, 0)
          return
        }
        const drift = sh.reach * shatter + 0.05 * Math.sin(t * sh.rate + sh.phase) * motion
        v.q.copy(v.mid).addScaledVector(sh.dir, drift)
        v.q.y -= 0.12 * shatter // fragments sag with the broken ends
        const ang = t * sh.rate * motion + sh.phase
        v.axis.copy(sh.dir).multiplyScalar(Math.cos(ang)).addScaledVector(sh.spin, Math.sin(ang))
        v.p.copy(v.q).addScaledVector(v.axis, -sh.length / 2)
        writeVec(dp, idx, v.p)
        v.p.copy(v.q).addScaledVector(v.axis, sh.length / 2)
        writeVec(dp, idx + 1, v.p)
        const flicker = motion ? 1.4 + 1.8 * Math.random() : 2.2
        writeCol(dc, idx, v.c.copy(PALETTE.fail), flicker * shatter * dim)
        writeCol(dc, idx + 1, v.c, flicker * 0.5 * shatter * dim)
      })

      v.c.copy(PALETTE[node.status])
      const linkGlow = GLOW[node.status] * (isHovered ? 1.4 : 1) * dim
      const endGlow = failing ? linkGlow * (0.9 + 0.5 * Math.random()) : linkGlow // broken ends crackle
      writeCol(lc, base, v.c, linkGlow * 0.45)
      writeCol(lc, base + 1, v.c, endGlow)
      writeCol(lc, base + 2, v.c, endGlow)
      writeCol(lc, base + 3, v.c, linkGlow)

      // ---- data streams ----
      // pass: steady bidirectional traffic. warn: slower, some packets drop
      // mid-link. fail: outbound packets run into the break and die there.
      let slot = i * POINTS_PER_LINK
      const emit = (col: THREE.Color, k: number) => {
        writeVec(pp, slot, v.p)
        writeCol(pc, slot, col, k)
        slot++
      }
      const skip = () => {
        writeCol(pc, slot, v.c, 0) // additive blending: black = invisible
        slot++
      }
      const flowing = node.status === 'pass' || node.status === 'warn' || failing
      const pace = motion * (isFocused ? 1.7 : 1) * (node.status === 'warn' ? 0.6 : 1)
      v.inbound.copy(v.c).lerp(WHITE, 0.55)
      for (const pk of streams[i]) {
        if (!flowing || (failing && pk.inbound)) {
          for (let j = 0; j < TRAIL; j++) skip()
          continue
        }
        const u = (t * pk.speed * pace + pk.phase) % 1
        for (let j = 0; j < TRAIL; j++) {
          const uj = u - j * TRAIL_GAP
          if (uj < 0 || uj > pk.dropAt) {
            skip()
            continue
          }
          if (failing) {
            v.p.lerpVectors(v.s, v.a, uj)
            emit(v.c, 3 * (uj > 0.85 ? 1.8 : 1) * TRAIL_FADE[j] * dim)
          } else {
            v.p.lerpVectors(v.s, v.e, pk.inbound ? 1 - uj : uj)
            const fade = Math.sin(Math.PI * uj) * (node.status === 'warn' ? 0.75 : 1)
            emit(pk.inbound ? v.inbound : v.c, 3.4 * fade * TRAIL_FADE[j] * dim)
          }
        }
      }
      for (let k = 0; k < SPARKS; k++) {
        if (failing && broken > 0.3) {
          v.p.copy(k === 0 ? v.a : v.b)
          v.p.x += rand(-0.06, 0.06) * motion
          v.p.y += rand(-0.06, 0.06) * motion
          emit(v.c, (Math.random() > 0.45 ? 4 : 0.3) * dim)
        } else skip()
      }
    })

    links.attributes.position.needsUpdate = true
    links.attributes.color.needsUpdate = true
    debris.attributes.position.needsUpdate = true
    debris.attributes.color.needsUpdate = true
    packets.attributes.position.needsUpdate = true
    packets.attributes.color.needsUpdate = true

    // ---- core: the target domain, tinted by overall score ----
    const tone = score >= 80 ? PALETTE.pass : score >= 50 ? PALETTE.warn : PALETTE.fail
    const coreDim = focus ? 0.45 : 1
    if (core.current) {
      core.current.rotation.set(t * 0.12 * motion, t * 0.18 * motion, 0)
      core.current.scale.setScalar(1 + 0.025 * Math.sin(t * 2) * motion)
    }
    const unstable = score < 50 && motion > 0 && Math.random() > 0.93
    coreWire.current?.color.copy(tone).multiplyScalar((unstable ? 0.4 : 1.5) * coreDim)
    coreHeart.current?.color.copy(tone).multiplyScalar((0.35 + 0.1 * Math.sin(t * 2)) * coreDim)
  })

  return (
    <>
      {rings.map((ring, i) => (
        <primitive key={i} object={ring} />
      ))}

      <group ref={core}>
        {/* Target domain: lat/long wireframe sphere around a dim solid heart */}
        <lineSegments geometry={globe} rotation={[0.35, 0, 0.2]}>
          <lineBasicMaterial ref={coreWire} toneMapped={false} />
        </lineSegments>
        <mesh>
          <sphereGeometry args={[CORE_R * 0.42, 20, 14]} />
          <meshBasicMaterial ref={coreHeart} toneMapped={false} />
        </mesh>
      </group>

      <lineSegments geometry={links} frustumCulled={false}>
        <lineBasicMaterial vertexColors toneMapped={false} />
      </lineSegments>

      <lineSegments geometry={debris} frustumCulled={false}>
        <lineBasicMaterial vertexColors toneMapped={false} />
      </lineSegments>

      <points geometry={packets} frustumCulled={false}>
        <pointsMaterial
          map={dot}
          size={0.13}
          sizeAttenuation
          vertexColors
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
        />
      </points>

      {nodes.map((node, i) => (
        <Satellite key={node.id} node={node} refs={sats[i]} onHover={onHover} onSelect={onSelect} />
      ))}
    </>
  )
}
