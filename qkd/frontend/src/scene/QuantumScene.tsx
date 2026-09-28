import { useEffect, useMemo, useRef, type ReactNode, type RefObject } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Environment, Lightformer, Line, MeshReflectorMaterial, Sparkles } from '@react-three/drei'
import { Bloom, ChromaticAberration, EffectComposer, Vignette } from '@react-three/postprocessing'
import type { ChromaticAberrationEffect } from 'postprocessing'
import * as THREE from 'three'
import { CROSS, GAP, SPHERES, transmission } from '../transmission'
import { useCollapse } from './collapse'

// Stage layout (scene units). The beam runs along x at y = 0.
const ALICE_X = -4.6
const BOB_X = 4.6
const BEAM_START = ALICE_X + 0.95
const BEAM_END = BOB_X - 0.95
const EVE_Y = 1.95
const FOV = 35
/** Vertical extent the camera must fit: from the labels under the nodes to the top of Eve. */
const SPAN = { bottom: -1.5, top: 2.9 }

const LITE = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('lite')

const col = (hex: string, k = 1) => new THREE.Color(hex).multiplyScalar(k)
const CYAN = '#38e1ff'
const VIOLET = '#a78bfa'
const RED = '#ff3b5c'
const GREEN = '#34f5a0'
const C = { cyan: col(CYAN), red: col(RED), green: col(GREEN), white: col('#ffffff') }

export interface Band {
  /** Screen-space pixels the stage should occupy (between banner and step cards). */
  top: number
  bottom: number
  /** Whether Alice/Bob should line up with three side-by-side columns. */
  columns: boolean
}

interface SceneProps {
  attack: boolean
  collapseKey: number
  band: Band
}

type LabelId = 'alice' | 'bob' | 'cable' | 'eve'
type LabelRefs = RefObject<Record<LabelId, HTMLDivElement | null>>

export function QuantumScene({ attack, collapseKey, band }: SceneProps) {
  const labels = useRef<Record<LabelId, HTMLDivElement | null>>({ alice: null, bob: null, cable: null, eve: null })
  const eve = useRef({ y: 8 })
  return (
    <div className="relative h-full w-full">
      <Canvas camera={{ position: [0, 0.5, 13], fov: FOV }} dpr={[1, 2]} gl={{ antialias: true }}>
        <color attach="background" args={['#020306']} />
        <fog attach="fog" args={['#020306', 16, 36]} />
        <ambientLight intensity={0.3} />
        <Environment resolution={256} frames={1}>
          <Lightformer form="rect" intensity={2} position={[0, 5, 2]} scale={[12, 1.2, 1]} rotation-x={Math.PI / 2} />
          <Lightformer form="rect" intensity={1} position={[-7, 1, 3]} scale={[3, 4, 1]} rotation-y={Math.PI / 2} color={CYAN} />
          <Lightformer form="rect" intensity={1} position={[7, 1, 3]} scale={[3, 4, 1]} rotation-y={-Math.PI / 2} color={VIOLET} />
        </Environment>
        <pointLight position={[ALICE_X, 1, 2]} color={CYAN} intensity={10} distance={6} />
        <pointLight position={[BOB_X, 1, 2]} color={VIOLET} intensity={10} distance={6} />
        <Sparkles count={70} scale={[20, 7, 8]} size={1.6} speed={0.2} opacity={0.3} color="#a5b4fc" />

        <CameraRig band={band} />
        <Alice />
        <Fiber attack={attack} collapseKey={collapseKey} />
        <Photons attack={attack} collapseKey={collapseKey} />
        <Bob attack={attack} />
        <Eve attack={attack} state={eve} collapseKey={collapseKey} />
        <CollapseBurst collapseKey={collapseKey} />
        <Floor />
        <SceneLabels els={labels} eve={eve} />
        {!LITE && <Effects collapseKey={collapseKey} />}
      </Canvas>

      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <LabelBox id="alice" els={labels}>
          <LabelCard color={CYAN}>ALICE (SENDER)</LabelCard>
        </LabelBox>
        <LabelBox id="bob" els={labels}>
          <LabelCard color={VIOLET}>BOB (RECEIVER)</LabelCard>
        </LabelBox>
        <LabelBox id="cable" els={labels}>
          <div className="rounded-full border border-white/10 bg-black/50 px-3 py-1 text-center text-[11px] font-semibold tracking-[0.14em] text-zinc-300 backdrop-blur-md sm:text-xs">
            FIBER OPTIC CABLE <span className="text-zinc-500">(THE QUANTUM CHANNEL)</span>
          </div>
        </LabelBox>
        <LabelBox id="eve" els={labels}>
          <LabelCard color={RED} danger>
            EVE (THE SPY)
          </LabelCard>
        </LabelBox>
      </div>
    </div>
  )
}

function LabelBox({ id, els, children }: { id: LabelId; els: LabelRefs; children: ReactNode }) {
  return (
    <div
      ref={(el) => {
        els.current[id] = el
      }}
      className="absolute top-0 left-0 whitespace-nowrap select-none"
      style={{ transform: 'translate(-9999px, 0)' }}
    >
      {children}
    </div>
  )
}

function LabelCard({ color, danger, children }: { color: string; danger?: boolean; children: ReactNode }) {
  return (
    <div
      className={`flex items-center gap-2 rounded-xl border bg-black/60 px-3.5 py-1.5 text-sm font-extrabold tracking-[0.12em] backdrop-blur-md sm:text-base ${
        danger ? 'border-red-500/60 text-red-400' : 'border-white/15 text-white'
      }`}
      style={{ boxShadow: `0 0 24px -6px ${color}` }}
    >
      <span className="size-2 rounded-full" style={{ background: color, boxShadow: `0 0 10px ${color}` }} />
      {children}
    </div>
  )
}

/** Projects the DOM label cards onto their 3D anchors each frame. */
function SceneLabels({ els, eve }: { els: LabelRefs; eve: RefObject<{ y: number }> }) {
  const { camera, size } = useThree()
  const v = useMemo(() => new THREE.Vector3(), [])
  useFrame(() => {
    const place = (id: LabelId, x: number, y: number, z: number, opacity = 1) => {
      const el = els.current?.[id]
      if (!el) return
      v.set(x, y, z).project(camera)
      el.style.opacity = v.z > 1 ? '0' : String(opacity)
      // keep the whole card on screen on narrow viewports
      const half = el.offsetWidth / 2 + 8
      const px = Math.min(size.width - half, Math.max(half, (v.x * 0.5 + 0.5) * size.width))
      el.style.transform = `translate(${px}px, ${(-v.y * 0.5 + 0.5) * size.height}px) translate(-50%, -50%)`
    }
    place('alice', ALICE_X, -1.2, 0)
    place('bob', BOB_X, -1.2, 0)
    place('cable', 0, -0.62, 0)
    const ey = eve.current?.y ?? 8
    place('eve', 2.75, ey + 0.1, 0, Math.max(0, 1 - (ey - EVE_Y) * 0.8))
  })
  return null
}

/**
 * Frames the stage inside the screen band left between the banner and the
 * step cards; on wide screens Alice and Bob sit over the first and last column.
 */
function CameraRig({ band }: { band: Band }) {
  const { camera, size } = useThree()
  useEffect(() => {
    const cam = camera as THREE.PerspectiveCamera
    const { width: W, height: H } = size
    const tan = Math.tan(THREE.MathUtils.degToRad(FOV / 2))
    const aspect = W / H
    const bandH = Math.max(120, band.bottom - band.top)
    // fit the stage height into the band
    const dHeight = ((SPAN.top - SPAN.bottom) * H) / (2 * tan * bandH)
    // Alice/Bob at the column centres (1/6 and 5/6 of the width), or just fit the width
    const dWidth = band.columns ? BOB_X / ((2 / 3) * tan * aspect) : (BOB_X + 1.6) / (tan * aspect)
    const d = Math.max(dHeight, dWidth)
    const midY = (SPAN.top + SPAN.bottom) / 2
    cam.position.set(0, midY + d * 0.06, d)
    cam.lookAt(0, midY, 0)
    // shift the rendered image so the stage centre lands on the band centre
    const dy = H / 2 - (band.top + band.bottom) / 2
    cam.setViewOffset(W, H, 0, dy, W, H)
    cam.updateProjectionMatrix()
  }, [camera, size, band])
  return null
}

function Effects({ collapseKey }: { collapseKey: number }) {
  const ca = useRef<ChromaticAberrationEffect>(null)
  const sample = useCollapse(collapseKey)
  const offset = useMemo(() => new THREE.Vector2(0.0004, 0.0004), [])
  useFrame(({ clock }) => {
    const o = 0.0004 + sample(clock.elapsedTime).g * 0.008
    ca.current?.offset.set(o, o * 0.6)
  })
  return (
    <EffectComposer multisampling={4}>
      <Bloom mipmapBlur luminanceThreshold={0.5} luminanceSmoothing={0.2} intensity={1.3} radius={0.75} />
      <ChromaticAberration ref={ca} offset={offset} radialModulation={false} modulationOffset={0} />
      <Vignette eskil={false} offset={0.2} darkness={0.8} />
    </EffectComposer>
  )
}

function Floor() {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.1, 0]}>
      <planeGeometry args={[80, 80]} />
      {LITE ? (
        <meshStandardMaterial color="#05060a" roughness={0.6} />
      ) : (
        <MeshReflectorMaterial
          blur={[300, 80]}
          resolution={512}
          mixBlur={1}
          mixStrength={16}
          roughness={1}
          depthScale={1.1}
          minDepthThreshold={0.4}
          maxDepthThreshold={1.4}
          color="#05060a"
          metalness={0.6}
          mirror={0.5}
        />
      )}
    </mesh>
  )
}

/** Soft radial falloff used for every glow sprite. */
let glowTexture: THREE.Texture | null = null
function glowMap() {
  if (glowTexture) return glowTexture
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const ctx = c.getContext('2d')!
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.2, 'rgba(255,255,255,0.5)')
  g.addColorStop(0.5, 'rgba(255,255,255,0.1)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 128, 128)
  glowTexture = new THREE.CanvasTexture(c)
  return glowTexture
}

function Glow({ color, scale, opacity = 1 }: { color: THREE.Color | string; scale: number; opacity?: number }) {
  const map = useMemo(glowMap, [])
  return (
    <sprite scale={scale}>
      <spriteMaterial map={map} color={color} transparent opacity={opacity} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
    </sprite>
  )
}

/** The bits of drei's <Line> (a Line2) we touch each frame. */
interface BoltLine {
  visible: boolean
  geometry: { setPositions: (points: number[]) => void }
}

const metal = { color: '#2a2c34', metalness: 0.9, roughness: 0.3, envMapIntensity: 1.1 } as const

/** Alice: a glowing photon emitter. Flashes each time it fires a sphere. */
function Alice() {
  const core = useRef<THREE.MeshBasicMaterial>(null)
  const ring = useRef<THREE.Group>(null)
  useFrame((_, dt) => {
    const e = transmission.elapsed()
    const k = Math.floor(e / GAP)
    const firing = k >= 0 && k < SPHERES ? Math.exp(-(e - k * GAP) * 5) : 0
    core.current?.color.copy(C.cyan).multiplyScalar(1.4 + firing * 3)
    if (ring.current) ring.current.rotation.x += dt * (0.4 + firing * 4)
  })
  return (
    <group position={[ALICE_X, 0, 0]}>
      <mesh>
        <cylinderGeometry args={[0.62, 0.72, 1.1, 48]} />
        <meshStandardMaterial {...metal} />
      </mesh>
      <mesh position={[0, 0, 0]} rotation={[0, 0, -Math.PI / 2]}>
        <cylinderGeometry args={[0.3, 0.42, 1.5, 48]} />
        <meshStandardMaterial {...metal} />
      </mesh>
      <mesh position={[0.76, 0, 0]}>
        <sphereGeometry args={[0.24, 32, 24]} />
        <meshBasicMaterial ref={core} toneMapped={false} />
      </mesh>
      <group position={[0.76, 0, 0]}>
        <Glow color={C.cyan} scale={2.2} opacity={0.8} />
      </group>
      <group ref={ring} position={[0.25, 0, 0]}>
        <mesh rotation={[0, Math.PI / 2, 0]}>
          <torusGeometry args={[0.85, 0.025, 12, 80]} />
          <meshBasicMaterial color={col(CYAN, 1.6)} toneMapped={false} />
        </mesh>
      </group>
      <mesh position={[0, -0.8, 0]}>
        <cylinderGeometry args={[0.9, 1, 0.12, 48]} />
        <meshStandardMaterial {...metal} />
      </mesh>
    </group>
  )
}

/** Bob: a detector ring that lights up as it catches each sphere. */
function Bob({ attack }: { attack: boolean }) {
  const lens = useRef<THREE.MeshBasicMaterial>(null)
  const halo = useRef<THREE.SpriteMaterial>(null)
  const tint = useMemo(() => new THREE.Color(), [])
  useFrame(() => {
    const e = transmission.elapsed()
    // time since the most recent sphere arrived
    const k = Math.floor((e - CROSS) / GAP)
    const hit = k >= 0 && k < SPHERES ? Math.exp(-(e - CROSS - k * GAP) * 4) : 0
    tint.copy(attack ? C.red : C.green)
    lens.current?.color.copy(col(VIOLET, 0.6)).lerp(tint, hit).multiplyScalar(1 + hit * 2.5)
    if (halo.current) {
      halo.current.color.copy(tint)
      halo.current.opacity = hit * 0.9
    }
  })
  const map = useMemo(glowMap, [])
  return (
    <group position={[BOB_X, 0, 0]}>
      <mesh rotation={[0, 0, Math.PI / 2]} position={[0.2, 0, 0]}>
        <cylinderGeometry args={[0.75, 0.55, 0.9, 48, 1, true]} />
        <meshStandardMaterial {...metal} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[-0.25, 0, 0]} rotation={[0, Math.PI / 2, 0]}>
        <torusGeometry args={[0.75, 0.05, 16, 80]} />
        <meshBasicMaterial color={col(VIOLET, 1.6)} toneMapped={false} />
      </mesh>
      <mesh position={[0.05, 0, 0]} rotation={[0, -Math.PI / 2, 0]}>
        <circleGeometry args={[0.55, 48]} />
        <meshBasicMaterial ref={lens} toneMapped={false} />
      </mesh>
      <sprite scale={3} position={[-0.1, 0, 0]}>
        <spriteMaterial ref={halo} map={map} transparent opacity={0} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </sprite>
      <mesh position={[0.3, 0, 0]}>
        <boxGeometry args={[0.9, 1.2, 1.2]} />
        <meshStandardMaterial {...metal} />
      </mesh>
      <mesh position={[0.3, -0.8, 0]}>
        <cylinderGeometry args={[0.9, 1, 0.12, 48]} />
        <meshStandardMaterial {...metal} />
      </mesh>
    </group>
  )
}

const fiberVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

// Glowing core; downstream of Eve it turns red and crackles during an attack.
const fiberFragment = /* glsl */ `
  uniform float uTime;
  uniform float uAttack;
  uniform float uGlitch;
  varying vec2 vUv;
  float hash(float n) { return fract(sin(n) * 43758.5453); }
  void main() {
    float x = vUv.y;
    float flow = 0.5 + 0.5 * sin(x * 24.0 - uTime * 2.2);
    vec3 cyan = vec3(0.22, 0.88, 1.0);
    vec3 red = vec3(1.0, 0.23, 0.36);
    float past = uAttack * smoothstep(0.47, 0.53, x);
    float crackle = past * step(0.6, hash(floor(x * 60.0) + floor(uTime * 18.0)));
    vec3 c = mix(cyan, red, clamp(past + uGlitch, 0.0, 1.0));
    float a = 0.55 + flow * 0.2 + crackle * 0.5;
    a *= 1.0 - uGlitch * 0.6 * hash(floor(uTime * 30.0));
    gl_FragColor = vec4(c * (1.4 + flow * 0.4 + crackle), a);
  }
`

function Fiber({ attack, collapseKey }: { attack: boolean; collapseKey: number }) {
  const sample = useCollapse(collapseKey)
  const uniforms = useMemo(() => ({ uTime: { value: 0 }, uAttack: { value: 0 }, uGlitch: { value: 0 } }), [])
  useFrame(({ clock }, dt) => {
    uniforms.uTime.value = clock.elapsedTime
    uniforms.uAttack.value = THREE.MathUtils.damp(uniforms.uAttack.value, attack ? 1 : 0, 3, dt)
    uniforms.uGlitch.value = sample(clock.elapsedTime).g
  })
  const len = BEAM_END - BEAM_START
  return (
    <group position={[(BEAM_START + BEAM_END) / 2, 0, 0]} rotation={[0, 0, -Math.PI / 2]}>
      {/* glass cladding */}
      <mesh>
        <cylinderGeometry args={[0.2, 0.2, len, 48, 1, true]} />
        <meshStandardMaterial color="#9ad8ff" transparent opacity={0.1} roughness={0.05} metalness={0.2} depthWrite={false} />
      </mesh>
      {/* glowing core */}
      <mesh>
        <cylinderGeometry args={[0.05, 0.05, len, 16, 1, true]} />
        <shaderMaterial vertexShader={fiberVertex} fragmentShader={fiberFragment} uniforms={uniforms} transparent depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </mesh>
    </group>
  )
}

interface SphereSlot {
  group: THREE.Group | null
  body: THREE.Mesh | null
  bodyMat: THREE.MeshBasicMaterial | null
  shell: THREE.Mesh | null
  shellMat: THREE.MeshBasicMaterial | null
  glowMat: THREE.SpriteMaterial | null
  shards: (THREE.Mesh | null)[]
}

const SHARDS = 7

/** A handful of big, slow photon spheres. Past Eve they turn red and break apart. */
function Photons({ attack, collapseKey }: { attack: boolean; collapseKey: number }) {
  const sample = useCollapse(collapseKey)
  const slots = useMemo<SphereSlot[]>(
    () => Array.from({ length: SPHERES }, () => ({ group: null, body: null, bodyMat: null, shell: null, shellMat: null, glowMat: null, shards: [] })),
    [],
  )
  // Fixed random scatter direction per shard so a broken sphere looks consistently shattered.
  const shardDirs = useMemo(
    () => Array.from({ length: SPHERES * SHARDS }, () => new THREE.Vector3(Math.random() - 0.3, Math.random() - 0.5, Math.random() - 0.5).normalize()),
    [],
  )
  const tmp = useMemo(() => new THREE.Color(), [])
  const map = useMemo(glowMap, [])

  useFrame(({ clock }) => {
    const e = transmission.elapsed()
    const t = clock.elapsedTime
    const { g } = sample(t)
    slots.forEach((s, k) => {
      if (!s.group) return
      const p = (e - k * GAP) / CROSS
      if (p < 0 || p > 1) {
        s.group.visible = false
        return
      }
      s.group.visible = true
      const x = BEAM_START + p * (BEAM_END - BEAM_START)
      const broken = attack && x > 0
      // how far past Eve (0 → 1) for the break-apart animation
      const past = broken ? Math.min(1, x / 1.2) : 0
      const jitter = broken ? 0.05 : 0
      s.group.position.set(x + (Math.random() - 0.5) * jitter, Math.sin(t * 2 + k) * 0.04 + (Math.random() - 0.5) * jitter, 0)
      const fade = Math.min(1, p / 0.05, (1 - p) / 0.05)
      s.group.scale.setScalar(Math.max(0.001, fade) * (1 + Math.sin(t * 5 + k) * 0.05))

      tmp.copy(C.cyan)
      if (broken) tmp.lerp(C.red, Math.min(1, past * 2))
      if (g > 0) tmp.lerp(C.red, g)
      s.bodyMat?.color.copy(tmp).lerp(C.white, broken ? 0.1 : 0.35).multiplyScalar(broken ? 1.6 : 2.2)
      if (s.body) s.body.scale.setScalar(1 - past * 0.45)
      s.shellMat?.color.copy(tmp).multiplyScalar(1.4)
      if (s.shell) {
        s.shell.visible = broken
        s.shell.rotation.set(t * 1.3, t * 0.9, 0)
        s.shell.scale.setScalar(1 + past * 0.25)
      }
      s.glowMat?.color.copy(tmp)
      if (s.glowMat) s.glowMat.opacity = broken ? 0.55 - past * 0.25 : 0.8
      s.shards.forEach((sh, j) => {
        if (!sh) return
        sh.visible = broken
        if (!broken) return
        const dir = shardDirs[k * SHARDS + j]
        sh.position.copy(dir).multiplyScalar(0.25 + past * 0.55)
        sh.rotation.set(t * 3 + j, t * 2 + j, 0)
      })
    })
  })

  return (
    <group>
      {slots.map((s, k) => (
        <group key={k} ref={(el) => { s.group = el }} visible={false}>
          <mesh ref={(el) => { s.body = el }}>
            <sphereGeometry args={[0.3, 32, 24]} />
            <meshBasicMaterial ref={(el) => { s.bodyMat = el }} toneMapped={false} />
          </mesh>
          <mesh ref={(el) => { s.shell = el }} visible={false}>
            <icosahedronGeometry args={[0.36, 0]} />
            <meshBasicMaterial ref={(el) => { s.shellMat = el }} wireframe toneMapped={false} />
          </mesh>
          <sprite scale={1.9}>
            <spriteMaterial ref={(el) => { s.glowMat = el }} map={map} transparent depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
          </sprite>
          {Array.from({ length: SHARDS }, (_, j) => (
            <mesh key={j} ref={(el) => { s.shards[j] = el }} visible={false}>
              <tetrahedronGeometry args={[0.07, 0]} />
              <meshBasicMaterial color={col(RED, 2)} toneMapped={false} />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  )
}

const BOLTS = 5
const BOLT_SEGMENTS = 9

/** Eve: a red drone-eye that drops over the channel and fires hazard lines into it. */
function Eve({ attack, state, collapseKey }: { attack: boolean; state: RefObject<{ y: number }>; collapseKey: number }) {
  const rig = useRef<THREE.Group>(null)
  const rotors = useRef<(THREE.Mesh | null)[]>([])
  const pupil = useRef<THREE.Group>(null)
  const bolts = useRef<(BoltLine | null)[]>([])
  const cone = useRef<THREE.MeshBasicMaterial>(null)
  const impacts = useRef<(THREE.SpriteMaterial | null)[]>([])
  const sample = useCollapse(collapseKey)
  const lastJag = useRef(0)
  const map = useMemo(glowMap, [])
  const targets = useMemo(() => Array.from({ length: BOLTS }, (_, i) => -1.1 + (i / (BOLTS - 1)) * 2.2), [])
  const initial = useMemo(() => Array.from({ length: BOLT_SEGMENTS + 1 }, () => new THREE.Vector3()), [])

  useFrame(({ clock }, dt) => {
    const g = rig.current
    if (!g || !state.current) return
    const t = clock.elapsedTime
    const y = THREE.MathUtils.damp(g.position.y, attack ? EVE_Y : 8, attack ? 2.6 : 3.5, dt)
    g.position.y = y + (attack ? Math.sin(t * 1.8) * 0.06 : 0)
    g.visible = y < 7.5
    state.current.y = y
    rotors.current.forEach((r) => r && (r.rotation.y += dt * 30))
    if (pupil.current) pupil.current.position.x = Math.sin(t * 0.9) * 0.08

    const { g: glitch } = sample(t)
    const on = attack && y < EVE_Y + 0.4
    // re-jag the hazard lines ~12x per second
    if (on && t - lastJag.current > 0.08) {
      lastJag.current = t
      bolts.current.forEach((b, i) => {
        if (!b) return
        const pts: number[] = []
        const from = new THREE.Vector3(0, -0.55, 0.2)
        const to = new THREE.Vector3(targets[i], -y, 0)
        for (let s = 0; s <= BOLT_SEGMENTS; s++) {
          const f = s / BOLT_SEGMENTS
          const p = from.clone().lerp(to, f)
          if (s > 0 && s < BOLT_SEGMENTS) {
            p.x += (Math.random() - 0.5) * 0.28
            p.z += (Math.random() - 0.5) * 0.2
          }
          pts.push(p.x, p.y, p.z)
        }
        b.geometry.setPositions(pts)
      })
    }
    bolts.current.forEach((b) => {
      if (b) b.visible = on && Math.random() > 0.08
    })
    impacts.current.forEach((m) => {
      if (m) m.opacity = on ? 0.5 + Math.random() * 0.5 : 0
    })
    if (cone.current) cone.current.opacity = on ? 0.07 + glitch * 0.2 : 0
  })

  return (
    <group ref={rig} position={[0, 8, 0]} visible={false}>
      {/* drone frame */}
      {[45, 135, 225, 315].map((deg, i) => {
        const a = THREE.MathUtils.degToRad(deg)
        const ax = Math.cos(a) * 1.05
        const az = Math.sin(a) * 0.55
        return (
          <group key={deg}>
            <mesh position={[ax / 2, 0.15, az / 2]} rotation={[0, -a, 0]}>
              <boxGeometry args={[1.1, 0.05, 0.07]} />
              <meshStandardMaterial {...metal} />
            </mesh>
            <mesh position={[ax, 0.22, az]}>
              <cylinderGeometry args={[0.06, 0.06, 0.14, 12]} />
              <meshStandardMaterial {...metal} />
            </mesh>
            <mesh ref={(el) => { rotors.current[i] = el }} position={[ax, 0.3, az]}>
              <boxGeometry args={[0.62, 0.012, 0.06]} />
              <meshBasicMaterial color="#71717a" transparent opacity={0.6} />
            </mesh>
          </group>
        )
      })}
      {/* the eye */}
      <mesh>
        <sphereGeometry args={[0.55, 48, 32]} />
        <meshStandardMaterial color="#1a0a0d" metalness={0.6} roughness={0.25} />
      </mesh>
      <mesh position={[0, 0, 0.05]} rotation={[0, 0, 0]}>
        <torusGeometry args={[0.6, 0.045, 16, 80]} />
        <meshBasicMaterial color={col(RED, 2)} toneMapped={false} />
      </mesh>
      <group ref={pupil} position={[0, -0.05, 0.5]} rotation={[-0.35, 0, 0]}>
        <mesh>
          <circleGeometry args={[0.3, 48]} />
          <meshBasicMaterial color={col(RED, 2.4)} toneMapped={false} />
        </mesh>
        <mesh position={[0, 0, 0.005]}>
          <circleGeometry args={[0.13, 32]} />
          <meshBasicMaterial color="#000000" />
        </mesh>
        <mesh position={[0.08, 0.08, 0.01]}>
          <circleGeometry args={[0.035, 16]} />
          <meshBasicMaterial color={col('#ffffff', 2)} toneMapped={false} />
        </mesh>
      </group>
      <group position={[0, 0, 0.3]}>
        <Glow color={C.red} scale={3.2} opacity={0.55} />
      </group>
      {/* scan cone down to the fibre */}
      <mesh position={[0, -EVE_Y / 2 - 0.25, 0]}>
        <coneGeometry args={[1.3, EVE_Y - 0.5, 48, 1, true]} />
        <meshBasicMaterial ref={cone} color={col(RED, 1.5)} transparent opacity={0} side={THREE.DoubleSide} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </mesh>
      {/* hazard lines crashing into the beam */}
      {targets.map((tx, i) => (
        <group key={i}>
          <Line
            ref={(el) => { bolts.current[i] = el as unknown as BoltLine | null }}
            points={initial}
            color={col(RED, 2.2)}
            lineWidth={3}
            toneMapped={false}
            transparent
          />
          <sprite position={[tx, -EVE_Y, 0]} scale={0.9}>
            <spriteMaterial ref={(el) => { impacts.current[i] = el }} map={map} color={C.red} transparent opacity={0} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
          </sprite>
        </group>
      ))}
    </group>
  )
}

const BURST = 1200

/** One red shockwave when Eve's attack lands. */
function CollapseBurst({ collapseKey }: { collapseKey: number }) {
  const points = useRef<THREE.Points>(null)
  const mat = useRef<THREE.PointsMaterial>(null)
  const sample = useCollapse(collapseKey)
  const { origin, velocity, positions } = useMemo(() => {
    const origin = new Float32Array(BURST * 3)
    const velocity = new Float32Array(BURST * 3)
    for (let i = 0; i < BURST; i++) {
      origin.set([(Math.random() - 0.5) * 1.5, 0, 0], i * 3)
      const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize()
      velocity.set([dir.x * 4, dir.y * 2.5, dir.z * 2.5].map((v) => v * (0.4 + Math.random())), i * 3)
    }
    return { origin, velocity, positions: new Float32Array(origin) }
  }, [])
  useFrame(({ clock }) => {
    const { g, d } = sample(clock.elapsedTime)
    if (!points.current || !mat.current) return
    points.current.visible = g > 0
    if (g <= 0) return
    const travel = 1 - Math.exp(-d * 2.4)
    for (let i = 0; i < BURST * 3; i++) positions[i] = origin[i] + velocity[i] * travel
    points.current.geometry.getAttribute('position').needsUpdate = true
    mat.current.opacity = g
  })
  return (
    <points ref={points} visible={false} frustumCulled={false}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial ref={mat} color={col(RED, 2.2)} size={0.06} transparent depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} sizeAttenuation />
    </points>
  )
}
