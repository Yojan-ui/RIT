// The holographic core and its surroundings, all GPU-animated (per-vertex shaders, no per-frame buffer
// uploads except the two data streams).
//
//   LatticeCore   a skewed 3D lattice (the Module-LWE picture behind ML-KEM / ML-DSA) inside the globe.
//                 Its points "consolidate" from a scattered cloud into lattice sites as the post-quantum
//                 patch deploys, then pulse in HDR cyan (the bloom pass makes it glow).
//   DustMotes     slow drifting dust that brightens near the core, as if catching its light.
//   CommandDeck   a dim, vast tactical room: long floor grid, a ring of server racks fading into fog.
//   DataStreams   particles flowing from the Diagnostics and Terminal panes into the core.
import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { Story } from './anchor'
import { spatial } from './spatial'
import { xrState } from './xr'

const R = 1.5 // globe radius, same as HudGlobe
const ICE = new THREE.Color('#67e8f9')
const CYAN = new THREE.Color('#06b6d4')
const EMERALD = new THREE.Color('#10b981')
const AMBER = new THREE.Color('#f97316')
const STEEL = new THREE.Color('#577c95')

// ── lattice core ─────────────────────────────────────────────────────────────

const LATTICE_VERT = /* glsl */ `
  attribute vec3 aNoise;
  attribute float aPhase;
  uniform float uC;      // consolidation 0 (scattered) .. 1 (every point on its lattice site)
  uniform float uTime;
  uniform float uSize;
  varying float vShimmer;
  varying float vC;
  void main() {
    // staggered snap: each point starts moving at its own phase, so the lattice assembles in a wave
    float c = smoothstep(aPhase * 0.45, aPhase * 0.45 + 0.55, uC);
    vec3 drift = vec3(sin(uTime * 1.3 + aPhase * 40.0), cos(uTime * 1.1 + aPhase * 23.0), sin(uTime * 0.9 + aPhase * 31.0)) * 0.06 * (1.0 - c);
    vec3 p = mix(aNoise, position, c) + drift;
    vShimmer = 0.5 + 0.5 * sin(uTime * 3.2 + aPhase * 6.2831);
    vC = c;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uSize * (0.7 + 0.6 * vShimmer);
  }
`
const LATTICE_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uGain;
  uniform float uOpacity;
  varying float vShimmer;
  varying float vC;
  void main() {
    vec2 d = gl_PointCoord - 0.5;
    float a = smoothstep(0.5, 0.1, length(d));
    gl_FragColor = vec4(uColor * uGain * (0.55 + 0.9 * vShimmer), a * uOpacity * (0.35 + 0.65 * vC));
  }
`
const EDGE_VERT = /* glsl */ `
  attribute vec3 aNoise;
  attribute float aPhase;
  uniform float uC;
  uniform float uTime;
  varying float vA;
  void main() {
    float c = smoothstep(aPhase * 0.45, aPhase * 0.45 + 0.55, uC);
    vec3 p = mix(aNoise, position, c);
    vA = c * c * (0.6 + 0.4 * sin(uTime * 2.1 + aPhase * 12.0));
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`
const EDGE_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uGain;
  uniform float uOpacity;
  varying float vA;
  void main() { gl_FragColor = vec4(uColor * uGain, vA * uOpacity); }
`

/** Lattice sites  a·b1 + b·b2 + c·b3  inside a ball, their bonds, and a scattered start position for each. */
function buildLattice() {
  const n = 3 // sites from -n..n along each basis vector
  const b1 = new THREE.Vector3(1, 0, 0)
  const b2 = new THREE.Vector3(0.38, 0.93, 0)
  const b3 = new THREE.Vector3(0.24, 0.31, 0.92)
  const s = 0.25 * R
  const radius = 0.86 * R
  const key = (a: number, b: number, c: number) => `${a},${b},${c}`
  const sites = new Map<string, { p: THREE.Vector3; i: number }>()
  const pos: number[] = []
  const noise: number[] = []
  const phase: number[] = []
  const rand = (): THREE.Vector3 => {
    const v = new THREE.Vector3(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1)
    return v.lengthSq() > 1 ? rand() : v
  }
  for (let a = -n; a <= n; a++)
    for (let b = -n; b <= n; b++)
      for (let c = -n; c <= n; c++) {
        const p = b1.clone().multiplyScalar(a).addScaledVector(b2, b).addScaledVector(b3, c).multiplyScalar(s)
        if (p.length() > radius) continue
        const q = rand().multiplyScalar(radius * 1.15)
        sites.set(key(a, b, c), { p, i: pos.length / 3 })
        pos.push(p.x, p.y, p.z)
        noise.push(q.x, q.y, q.z)
        phase.push(Math.min(1, p.length() / radius) * 0.7 + Math.random() * 0.3) // assemble from the centre out
      }
  const points = new THREE.BufferGeometry()
  points.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  points.setAttribute('aNoise', new THREE.Float32BufferAttribute(noise, 3))
  points.setAttribute('aPhase', new THREE.Float32BufferAttribute(phase, 1))

  const ePos: number[] = []
  const eNoise: number[] = []
  const ePhase: number[] = []
  sites.forEach((site, k) => {
    const [a, b, c] = k.split(',').map(Number)
    for (const [da, db, dc] of [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ]) {
      const o = sites.get(key(a + da, b + db, c + dc))
      if (!o) continue
      for (const e of [site, o]) {
        ePos.push(e.p.x, e.p.y, e.p.z)
        eNoise.push(noise[e.i * 3], noise[e.i * 3 + 1], noise[e.i * 3 + 2])
        ePhase.push(phase[e.i])
      }
    }
  })
  const edges = new THREE.BufferGeometry()
  edges.setAttribute('position', new THREE.Float32BufferAttribute(ePos, 3))
  edges.setAttribute('aNoise', new THREE.Float32BufferAttribute(eNoise, 3))
  edges.setAttribute('aPhase', new THREE.Float32BufferAttribute(ePhase, 1))
  return { points, edges }
}

export function LatticeCore({ story }: { story: Story }) {
  const group = useRef<THREE.Group>(null)
  const geo = useMemo(buildLattice, [])
  const pointsMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: LATTICE_VERT,
        fragmentShader: LATTICE_FRAG,
        uniforms: { uC: { value: 0.8 }, uTime: { value: 0 }, uSize: { value: 5 }, uColor: { value: ICE.clone() }, uGain: { value: 2 }, uOpacity: { value: 1 } },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    [],
  )
  const edgeMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: EDGE_VERT,
        fragmentShader: EDGE_FRAG,
        uniforms: { uC: { value: 0.8 }, uTime: { value: 0 }, uColor: { value: CYAN.clone() }, uGain: { value: 1.6 }, uOpacity: { value: 0.5 } },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    [],
  )
  const st = useRef({ c: 0.8, patchT: -1 })

  useFrame(({ clock }, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05)
    const t = clock.elapsedTime
    const s = st.current
    const results = story.active && !story.scanning
    const exposed = results && story.vulnerable && !story.patching && !story.patched
    const done = results && story.stage === 5 && story.rescan === 'done'
    // consolidation target follows the real pipeline state
    let target = 0.8 + 0.08 * Math.sin(t * 0.7) // standby: formed, breathing
    if (story.scanning) target = 0.45 + 0.2 * Math.sin(t * 2.4) // probing
    else if (exposed) target = 0.1 // classical crypto: no lattice, a scattered cloud
    else if (results && !story.vulnerable) target = 1
    if (story.patching) {
      if (s.patchT < 0) s.patchT = t
      target = Math.min(1, (t - s.patchT) / 1.8) // assembles over the deployment
    } else s.patchT = -1
    if (story.patched) target = 1
    s.c += (target - s.c) * (1 - Math.exp(-dt * (story.patching ? 12 : 2.5)))

    // cyan pulse once consolidated; warm and dim while the handshake is still classical
    const pulse = 0.5 + 0.5 * Math.sin(t * 2.6)
    const col = done ? EMERALD : exposed ? AMBER : story.scanning ? STEEL.clone().lerp(ICE, 0.5) : ICE
    const hover = spatial.hoverAmt
    const gain = exposed ? 0.9 : story.patched || story.patching ? 2.4 + 2.2 * pulse : 1.6 + 0.5 * pulse
    pointsMat.uniforms.uC.value = edgeMat.uniforms.uC.value = s.c
    pointsMat.uniforms.uTime.value = edgeMat.uniforms.uTime.value = t
    ;(pointsMat.uniforms.uColor.value as THREE.Color).copy(col)
    ;(edgeMat.uniforms.uColor.value as THREE.Color).copy(done ? EMERALD : exposed ? AMBER : CYAN)
    pointsMat.uniforms.uGain.value = gain * (1 + 0.35 * hover) // the room light rises when a pane is touched
    edgeMat.uniforms.uGain.value = gain * 0.7 * (1 + 0.35 * hover)
    // DPR-aware sprite size; smaller while the camera is pulled back for the ledger
    pointsMat.uniforms.uSize.value = (story.stage >= 4 && results ? 4 : 5.5) * Math.min(2, devicePixelRatio)
    if (group.current) {
      group.current.rotation.y += dt * (story.patching ? 0.9 : 0.16)
      group.current.rotation.x = 0.35 + 0.08 * Math.sin(t * 0.3)
    }
  })

  return (
    <group ref={group}>
      <lineSegments geometry={geo.edges} material={edgeMat} />
      <points geometry={geo.points} material={pointsMat} />
    </group>
  )
}

// ── dust motes ───────────────────────────────────────────────────────────────

const DUST_VERT = /* glsl */ `
  attribute float aSeed;
  uniform float uTime;
  uniform float uPx;
  varying float vB;
  void main() {
    vec3 p = position;
    p.x += sin(uTime * 0.07 + aSeed * 17.0) * 0.6;
    p.y += mod(uTime * (0.03 + aSeed * 0.05) + aSeed * 9.0, 8.0) - 4.0;
    p.z += cos(uTime * 0.05 + aSeed * 11.0) * 0.6;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    // catches the core's light: brightest near the centre of the room
    float near = exp(-dot(p, p) / 22.0);
    vB = (0.12 + 1.3 * near) * (0.6 + 0.4 * sin(uTime * 2.0 + aSeed * 40.0));
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uPx * (1.0 + aSeed) / -mv.z;
  }
`
const DUST_FRAG = /* glsl */ `
  uniform vec3 uColor;
  varying float vB;
  void main() {
    float a = smoothstep(0.5, 0.0, length(gl_PointCoord - 0.5));
    gl_FragColor = vec4(uColor * vB, a * min(1.0, vB));
  }
`

export function DustMotes({ count = 700 }: { count?: number }) {
  const geo = useMemo(() => {
    const p = new Float32Array(count * 3)
    const seed = new Float32Array(count)
    for (let i = 0; i < count; i++) {
      p.set([(Math.random() * 2 - 1) * 9, (Math.random() * 2 - 1) * 4, (Math.random() * 2 - 1) * 7 - 1], i * 3)
      seed[i] = Math.random()
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(p, 3))
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1))
    return g
  }, [count])
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: DUST_VERT,
        fragmentShader: DUST_FRAG,
        uniforms: { uTime: { value: 0 }, uPx: { value: 18 }, uColor: { value: new THREE.Color('#bfeaf5') } },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        fog: false,
      }),
    [],
  )
  useFrame(({ clock }) => {
    mat.uniforms.uTime.value = clock.elapsedTime
    mat.uniforms.uPx.value = 18 * Math.min(2, devicePixelRatio)
  })
  return <points geometry={geo} material={mat} frustumCulled={false} />
}

// ── command deck ─────────────────────────────────────────────────────────────

/** A vast dim room: a ring of server racks with thin status strips, fading into the fog. */
export function CommandDeck({ floorY }: { floorY: number }) {
  const racks = useMemo(() => {
    const n = 34
    const body = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: '#111a24', metalness: 0.8, roughness: 0.5, envMapIntensity: 0.6 }), n)
    const strip = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: ICE.clone().multiplyScalar(0.3) }), n * 2) // dim status LEDs, fogged with the room
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const e = new THREE.Euler()
    for (let i = 0; i < n; i++) {
      // a half-ring behind and beside the core
      const a = Math.PI * (0.08 + (0.84 * i) / (n - 1))
      const r = 11 + (i % 3) * 1.4
      const h = 3.2 + ((i * 7) % 5) * 0.55
      const x = Math.cos(a) * r
      const z = -Math.sin(a) * r - 1
      q.setFromEuler(e.set(0, Math.atan2(-x, -z), 0)) // front (+z, with the strips) faces the core
      body.setMatrixAt(i, m.compose(new THREE.Vector3(x, floorY + h / 2, z), q, new THREE.Vector3(1.1, h, 0.9)))
      for (let j = 0; j < 2; j++) {
        const off = new THREE.Vector3((j ? 0.3 : -0.3), 0, 0.46).applyQuaternion(q)
        strip.setMatrixAt(i * 2 + j, m.compose(new THREE.Vector3(x + off.x, floorY + h * (0.35 + j * 0.3), z + off.z), q, new THREE.Vector3(0.28, 0.025, 0.02)))
      }
    }
    return { body, strip }
  }, [floorY])
  return (
    <group>
      <primitive object={racks.body} />
      <primitive object={racks.strip} />
    </group>
  )
}

// ── data streams: panes → core ───────────────────────────────────────────────

const STREAMS = ['diagnostics', 'terminal'] as const
const PER = 42

/** Particles along an arc from each streaming pane's inner edge into the core; activity speeds them up. */
export function DataStreams({ core }: { core: React.RefObject<THREE.Object3D | null> }) {
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(STREAMS.length * PER * 3), 3))
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(STREAMS.length * PER * 3), 3))
    return g
  }, [])
  const st = useRef({ u: STREAMS.map(() => Array.from({ length: PER }, (_, i) => i / PER + Math.random() * 0.02)), tmp: { c: new THREE.Vector3(), m: new THREE.Vector3(), p: new THREE.Vector3(), col: new THREE.Color() } })
  const pts = useRef<THREE.Points>(null)

  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05)
    const on = spatial.on && !xrState.presenting && !!core.current
    if (pts.current) pts.current.visible = on
    if (!on) return
    const { tmp, u } = st.current
    core.current!.getWorldPosition(tmp.c)
    const pos = geo.attributes.position as THREE.BufferAttribute
    const col = geo.attributes.color as THREE.BufferAttribute
    STREAMS.forEach((id, s) => {
      const from = spatial.emitters.get(id)
      const pulse = spatial.pulse[id] ?? 0
      spatial.pulse[id] = Math.max(0, pulse - dt * 1.2)
      const speed = 0.22 + 0.55 * pulse
      for (let i = 0; i < PER; i++) {
        const k = s * PER + i
        if (!from) {
          col.setXYZ(k, 0, 0, 0)
          continue
        }
        u[s][i] = (u[s][i] + dt * speed) % 1
        const t = u[s][i]
        // quadratic arc: lifted above the straight line, bowing toward the viewer
        tmp.m.copy(from).lerp(tmp.c, 0.5)
        tmp.m.y += 0.9
        tmp.m.z += 0.6
        const a = (1 - t) * (1 - t)
        const b = 2 * (1 - t) * t
        const c = t * t
        tmp.p.set(a * from.x + b * tmp.m.x + c * tmp.c.x, a * from.y + b * tmp.m.y + c * tmp.c.y, a * from.z + b * tmp.m.z + c * tmp.c.z)
        pos.setXYZ(k, tmp.p.x, tmp.p.y, tmp.p.z)
        // HDR cyan, fading in off the pane and out into the core; black is invisible under additive blending
        const f = Math.sin(Math.PI * t) * (0.9 + 0.8 * Math.min(1, pulse)) * 2.2
        tmp.col.copy(ICE).multiplyScalar(f)
        col.setXYZ(k, tmp.col.r, tmp.col.g, tmp.col.b)
      }
    })
    pos.needsUpdate = true
    col.needsUpdate = true
  })

  return (
    <points ref={pts} geometry={geo} frustumCulled={false}>
      <pointsMaterial size={3.2} sizeAttenuation={false} vertexColors transparent depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
    </points>
  )
}
