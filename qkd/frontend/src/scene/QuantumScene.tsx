import { useEffect, useMemo, useRef, type ReactNode, type RefObject } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Edges, Environment, Lightformer, MeshReflectorMaterial, OrbitControls, RoundedBox, Sparkles } from '@react-three/drei'
import { Bloom, ChromaticAberration, EffectComposer, Vignette } from '@react-three/postprocessing'
import type { ChromaticAberrationEffect } from 'postprocessing'
import * as THREE from 'three'
import type { Qubit } from '../api'
import { AMBER, BASIS_COLOR, GREEN, RED, polarizationDeg, verdict } from '../lib/quantum'
import { playback, TRAVEL } from '../playback'
import { useCollapse } from './collapse'

// Optical bench layout (scene units, beam along +x at y = 0).
const START = -4.45 // Alice's aperture
const END = 4.4 // centre of Bob's beam-splitter cube
const TAP = 0 // Eve's tap
const RAIL_Y = -0.62
const POOL = TRAVEL + 2
// ?lite skips post-processing and the reflective floor (weak GPUs, software rendering).
const LITE = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('lite')

const col = (hex: string, boost = 1) => new THREE.Color(hex).multiplyScalar(boost)
const C = {
  plus: col(BASIS_COLOR['+']),
  cross: col(BASIS_COLOR.x),
  red: col(RED),
  amber: col(AMBER),
  green: col(GREEN),
  dim: col('#3f3f46'),
  white: col('#ffffff'),
}

/** Radial falloff texture so photon glows have no hard edge. */
let glowTexture: THREE.Texture | null = null
function getGlowTexture() {
  if (glowTexture) return glowTexture
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const ctx = c.getContext('2d')!
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.18, 'rgba(255,255,255,0.55)')
  g.addColorStop(0.45, 'rgba(255,255,255,0.12)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 128, 128)
  glowTexture = new THREE.CanvasTexture(c)
  return glowTexture
}

/** Shared per-frame effects state between photons, Eve's tap and particles. */
interface Fx {
  eveHit: number
  eveY: number
  spawn: (disturbed: boolean) => void
}

interface SceneProps {
  qubits: Qubit[]
  attack: boolean
  collapseKey: number
  selected: number | null
  onSelect: (i: number) => void
}

export function QuantumScene({ qubits, attack, collapseKey, selected, onSelect }: SceneProps) {
  const fx = useMemo<Fx>(() => ({ eveHit: -10, eveY: 5, spawn: () => {} }), [])
  const labels = useRef<Record<LabelId, HTMLDivElement | null>>({ alice: null, bob: null, d0: null, d1: null, eve: null })
  return (
    <div className="relative h-full w-full">
      <Canvas camera={{ position: [0, 2.3, 11.5], fov: 38 }} dpr={[1, 2]} gl={{ antialias: true, powerPreference: 'high-performance' }}>
        <color attach="background" args={['#030304']} />
        <fog attach="fog" args={['#030304', 13, 30]} />
        <ambientLight intensity={0.25} />
        <directionalLight position={[3, 6, 5]} intensity={1.1} />
        <pointLight position={[-5, 1.5, 2]} color={BASIS_COLOR['+']} intensity={6} distance={7} />
        <pointLight position={[5, 1.5, 2]} color={BASIS_COLOR.x} intensity={6} distance={7} />
        {/* Procedural studio lighting (no HDR download) so the metal reads as metal. */}
        <Environment resolution={256} frames={1}>
          <Lightformer form="rect" intensity={2.2} position={[0, 5, 2]} scale={[12, 1.2, 1]} rotation-x={Math.PI / 2} />
          <Lightformer form="rect" intensity={0.8} position={[-7, 1, 3]} scale={[3, 4, 1]} rotation-y={Math.PI / 2} color={BASIS_COLOR['+']} />
          <Lightformer form="rect" intensity={0.8} position={[7, 1, 3]} scale={[3, 4, 1]} rotation-y={-Math.PI / 2} color={BASIS_COLOR.x} />
          <Lightformer form="ring" intensity={0.6} position={[0, 2, 8]} scale={4} />
        </Environment>
        <Sparkles count={50} scale={[18, 6, 8]} size={1.2} speed={0.15} opacity={0.25} color="#a1a1aa" />

        <CameraFit />
        <PlaybackDriver />
        <Bench />
        <Beam attack={attack} collapseKey={collapseKey} />
        <AliceSource qubits={qubits} />
        <BobAnalyzer qubits={qubits} />
        <EveTap attack={attack} fx={fx} collapseKey={collapseKey} />
        <Decoherence fx={fx} />
        <CollapseBurst collapseKey={collapseKey} />
        {qubits.length > 0 && (
          <PhotonStream qubits={qubits} attack={attack} fx={fx} selected={selected} onSelect={onSelect} collapseKey={collapseKey} />
        )}

        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.25, 0]}>
          <planeGeometry args={[60, 60]} />
          {LITE ? (
            <meshStandardMaterial color="#060607" metalness={0.6} roughness={0.5} />
          ) : (
          <MeshReflectorMaterial
            blur={[300, 80]}
            resolution={512}
            mixBlur={1}
            mixStrength={14}
            roughness={1}
            depthScale={1.1}
            minDepthThreshold={0.4}
            maxDepthThreshold={1.4}
            color="#060607"
            metalness={0.6}
            mirror={0.5}
          />
          )}
        </mesh>

        <OrbitControls
          target={[0, 1.2, 0]}
          enablePan={false}
          enableDamping
          minDistance={6}
          maxDistance={32}
          minPolarAngle={Math.PI * 0.2}
          maxPolarAngle={Math.PI * 0.52}
        />
        {!LITE && <Effects collapseKey={collapseKey} />}
        <SceneLabels els={labels} fx={fx} />
      </Canvas>
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <LabelBox id="alice" els={labels}>
          <LabelText title="ALICE" sub="single-photon source · polariser" color={BASIS_COLOR['+']} />
        </LabelBox>
        <LabelBox id="bob" els={labels}>
          <LabelText title="BOB" sub="waveplate · PBS · SPAD detectors" color={BASIS_COLOR.x} />
        </LabelBox>
        <LabelBox id="d0" els={labels}>
          <span className="font-mono text-[9px] text-zinc-500">D0</span>
        </LabelBox>
        <LabelBox id="d1" els={labels}>
          <span className="font-mono text-[9px] text-zinc-500">D1</span>
        </LabelBox>
        <LabelBox id="eve" els={labels}>
          <LabelText title="EVE" sub="optical tap · intercept-resend" color={RED} danger />
        </LabelBox>
      </div>
    </div>
  )
}

type LabelId = 'alice' | 'bob' | 'd0' | 'd1' | 'eve'
type LabelRefs = RefObject<Record<LabelId, HTMLDivElement | null>>

function LabelBox({ id, els, children }: { id: LabelId; els: LabelRefs; children: ReactNode }) {
  return (
    <div
      ref={(el) => {
        els.current[id] = el
      }}
      className="absolute top-0 left-0 select-none"
      style={{ transform: 'translate(-9999px, 0)' }}
    >
      {children}
    </div>
  )
}

function LabelText({ title, sub, color, danger }: { title: string; sub: string; color: string; danger?: boolean }) {
  return (
    <div className="flex flex-col items-center whitespace-nowrap">
      <div className={`flex items-center gap-1.5 text-[11px] font-medium tracking-[0.14em] ${danger ? 'text-q-red' : 'text-zinc-200'}`}>
        <span className="size-1.5 rounded-full" style={{ background: color, boxShadow: `0 0 8px ${color}` }} />
        {title}
      </div>
      <div className="mt-0.5 text-[10px] text-zinc-500">{sub}</div>
    </div>
  )
}

const LABEL_POS: Record<Exclude<LabelId, 'eve'>, [number, number, number]> = {
  alice: [-4.8, -1.02, 0],
  bob: [4.55, -1.02, 0],
  d0: [END + 1.05, 0.34, 0],
  d1: [END, 0.34, -1.05],
}

/**
 * Projects the DOM labels onto their 3D anchors each frame. Plain DOM rather
 * than drei <Html>, which mounts a React root per label.
 */
function SceneLabels({ els, fx }: { els: LabelRefs; fx: Fx }) {
  const { camera, size } = useThree()
  const v = useMemo(() => new THREE.Vector3(), [])
  useFrame(() => {
    const place = (id: LabelId, x: number, y: number, z: number, opacity = 1) => {
      const el = els.current?.[id]
      if (!el) return
      v.set(x, y, z).project(camera)
      const behind = v.z > 1
      el.style.opacity = behind ? '0' : String(opacity)
      el.style.transform = `translate(${(v.x * 0.5 + 0.5) * size.width}px, ${(-v.y * 0.5 + 0.5) * size.height}px) translate(-50%, -50%)`
    }
    for (const id of Object.keys(LABEL_POS) as (keyof typeof LABEL_POS)[]) place(id, ...LABEL_POS[id])
    place('eve', TAP + 0.05, fx.eveY + 1.05, 0, Math.max(0, 1 - fx.eveY * 1.5))
  })
  return null
}

function PlaybackDriver() {
  useFrame((_, dt) => playback.tick(Math.min(dt, 0.1)))
  return null
}

/** Pull back on narrow viewports so the whole bench stays in frame. */
function CameraFit() {
  const { camera, size } = useThree()
  useEffect(() => {
    const aspect = size.width / size.height
    const fovTan = Math.tan(THREE.MathUtils.degToRad(38 / 2))
    camera.position.setLength(Math.max(11.5, 6.6 / (fovTan * aspect)))
  }, [camera, size])
  return null
}

function Effects({ collapseKey }: { collapseKey: number }) {
  const ca = useRef<ChromaticAberrationEffect>(null)
  const sample = useCollapse(collapseKey)
  const offset = useMemo(() => new THREE.Vector2(0.0004, 0.0004), [])
  useFrame(({ clock }) => {
    const { g } = sample(clock.elapsedTime)
    const o = 0.0004 + g * 0.006
    ca.current?.offset.set(o, o * 0.6)
  })
  return (
    <EffectComposer multisampling={4}>
      <Bloom mipmapBlur luminanceThreshold={0.55} luminanceSmoothing={0.2} intensity={1.15} radius={0.7} />
      <ChromaticAberration ref={ca} offset={offset} radialModulation={false} modulationOffset={0} />
      <Vignette eskil={false} offset={0.2} darkness={0.75} />
    </EffectComposer>
  )
}

const metal = { color: '#2a2b31', metalness: 0.9, roughness: 0.28, envMapIntensity: 1.1 } as const

function Post({ x, top, z = 0 }: { x: number; top: number; z?: number }) {
  const h = top - RAIL_Y
  return (
    <group position={[x, RAIL_Y + h / 2, z]}>
      <mesh>
        <cylinderGeometry args={[0.035, 0.035, h, 16]} />
        <meshStandardMaterial {...metal} />
      </mesh>
      <mesh position={[0, -h / 2 + 0.03, 0]}>
        <cylinderGeometry args={[0.11, 0.13, 0.06, 24]} />
        <meshStandardMaterial {...metal} />
      </mesh>
    </group>
  )
}

function Bench() {
  return (
    <group>
      <mesh position={[0, RAIL_Y - 0.06, 0]}>
        <boxGeometry args={[12.2, 0.12, 0.5]} />
        <meshStandardMaterial color="#1c1d22" metalness={0.9} roughness={0.35} envMapIntensity={0.9} />
      </mesh>
      {/* hairline graduations along the rail */}
      {Array.from({ length: 49 }, (_, i) => (
        <mesh key={i} position={[-6 + i * 0.25, RAIL_Y + 0.001, 0.2]}>
          <boxGeometry args={[0.006, 0.002, i % 4 === 0 ? 0.08 : 0.04]} />
          <meshBasicMaterial color="#3f3f46" />
        </mesh>
      ))}
    </group>
  )
}

const beamVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

// Faint laser guide. uGlitch tears it into displaced
// slices; uAttack taints everything downstream of Eve's tap with a decoherence ripple.
const beamFragment = /* glsl */ `
  uniform float uTime;
  uniform float uGlitch;
  uniform float uAttack;
  uniform float uAlpha;
  uniform float uTap;
  varying vec2 vUv;
  float hash(float n) { return fract(sin(n) * 43758.5453); }
  void main() {
    float v = vUv.y;
    float slice = floor(v * 56.0);
    float tear = uGlitch * step(0.55, hash(slice + floor(uTime * 26.0)));
    v += tear * (hash(slice * 3.7 + floor(uTime * 26.0)) - 0.5) * 0.2;
    vec3 cyan = vec3(0.37, 0.9, 0.97);
    vec3 violet = vec3(0.7, 0.62, 1.0);
    vec3 red = vec3(1.0, 0.3, 0.42);
    vec3 col = mix(cyan, violet, vUv.y);
    float tainted = uAttack * smoothstep(uTap - 0.01, uTap + 0.04, vUv.y);
    float ripple = tainted * (0.5 + 0.5 * sin(vUv.y * 140.0 - uTime * 14.0));
    col = mix(col, red, clamp(tainted * 0.8 + uGlitch, 0.0, 1.0));
    float flicker = 1.0 - uGlitch * 0.7 * hash(floor(uTime * 32.0));
    float alpha = (0.1 + ripple * 0.2) * flicker * (1.0 + tear * 3.0);
    gl_FragColor = vec4(col * 1.2, alpha * uAlpha);
  }
`

function Beam({ attack, collapseKey }: { attack: boolean; collapseKey: number }) {
  const sample = useCollapse(collapseKey)
  const len = END - START
  const tapV = (TAP - START) / len
  const uniforms = useMemo(
    () => ({ uTime: { value: 0 }, uGlitch: { value: 0 }, uAttack: { value: 0 }, uAlpha: { value: 1 }, uTap: { value: tapV } }),
    [tapV],
  )
  const halo = useMemo(() => ({ ...uniforms, uAlpha: { value: 0.45 } }), [uniforms])
  useFrame(({ clock }, dt) => {
    uniforms.uTime.value = clock.elapsedTime
    uniforms.uGlitch.value = sample(clock.elapsedTime).g
    uniforms.uAttack.value = THREE.MathUtils.damp(uniforms.uAttack.value, attack ? 1 : 0, 2.5, dt)
  })
  return (
    <group position={[(START + END) / 2, 0, 0]} rotation={[0, 0, -Math.PI / 2]}>
      <mesh>
        <cylinderGeometry args={[0.012, 0.012, len, 8, 1, true]} />
        <shaderMaterial vertexShader={beamVertex} fragmentShader={beamFragment} uniforms={uniforms} transparent depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </mesh>
      <mesh>
        <cylinderGeometry args={[0.07, 0.07, len, 16, 1, true]} />
        <shaderMaterial vertexShader={beamVertex} fragmentShader={beamFragment} uniforms={halo} transparent depthWrite={false} side={THREE.DoubleSide} blending={THREE.AdditiveBlending} toneMapped={false} />
      </mesh>
    </group>
  )
}

/** Alice: attenuated laser source with a motorised polariser setting each photon's state. */
function AliceSource({ qubits }: { qubits: Qubit[] }) {
  const polarizer = useRef<THREE.Group>(null)
  const aperture = useRef<THREE.MeshBasicMaterial>(null)
  useFrame((_, dt) => {
    const i = Math.floor(playback.s)
    const q = qubits[i]
    if (q && polarizer.current) {
      const target = Math.PI / 2 - THREE.MathUtils.degToRad(polarizationDeg(q.alice_bit, q.alice_basis))
      polarizer.current.rotation.x = THREE.MathUtils.damp(polarizer.current.rotation.x, target, 14, dt)
    }
    if (aperture.current) {
      const flash = q ? Math.exp(-(playback.s - i) * 6) : 0
      aperture.current.color.copy(q?.alice_basis === 'x' ? C.cross : C.plus).multiplyScalar(0.6 + flash * 3)
    }
  })
  return (
    <group>
      <group position={[-5.05, 0, 0]}>
        <RoundedBox args={[1.2, 0.46, 0.46]} radius={0.08} smoothness={4}>
          <meshStandardMaterial {...metal} />
        </RoundedBox>
        {[0, 1, 2].map((k) => (
          <mesh key={k} position={[-0.35 + k * 0.1, 0.1, 0.232]}>
            <circleGeometry args={[0.014, 12]} />
            <meshBasicMaterial color={k === 2 ? col(GREEN, 2) : col('#52525b')} toneMapped={false} />
          </mesh>
        ))}
        <mesh position={[0.601, 0, 0]} rotation={[0, Math.PI / 2, 0]}>
          <torusGeometry args={[0.1, 0.022, 12, 40]} />
          <meshBasicMaterial ref={aperture} toneMapped={false} />
        </mesh>
      </group>
      <Post x={-5.05} top={-0.23} />
      {/* polariser: the tick marks the photon's polarisation axis */}
      <group ref={polarizer} position={[-4.18, 0, 0]}>
        <mesh rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.24, 0.24, 0.018, 48]} />
          <meshStandardMaterial color="#1c1d22" metalness={0.4} roughness={0.2} transparent opacity={0.55} />
        </mesh>
        <mesh>
          <boxGeometry args={[0.022, 0.4, 0.008]} />
          <meshBasicMaterial color={col('#ffffff', 1.4)} toneMapped={false} />
        </mesh>
      </group>
      <Post x={-4.18} top={-0.25} />
    </group>
  )
}

/** Bob: basis-selecting waveplate, polarising beam splitter and two SPAD detectors. */
function BobAnalyzer({ qubits }: { qubits: Qubit[] }) {
  const plate = useRef<THREE.Group>(null)
  const plateMat = useRef<THREE.MeshStandardMaterial>(null)
  const d0 = useRef<THREE.MeshBasicMaterial>(null)
  const d1 = useRef<THREE.MeshBasicMaterial>(null)
  const ray0 = useRef<THREE.MeshBasicMaterial>(null)
  const ray1 = useRef<THREE.MeshBasicMaterial>(null)
  const tmp = useMemo(() => new THREE.Color(), [])

  useFrame((_, dt) => {
    const { focus } = playback.get()
    const next = qubits[focus + 1] ?? qubits[focus]
    if (next && plate.current) {
      const target = next.bob_basis === 'x' ? Math.PI / 4 : 0
      plate.current.rotation.x = THREE.MathUtils.damp(plate.current.rotation.x, target, 10, dt)
      plateMat.current?.color.copy(next.bob_basis === 'x' ? C.cross : C.plus).multiplyScalar(0.35)
    }
    const q = qubits[focus]
    const since = focus >= 0 ? playback.s - (focus + TRAVEL) : 99
    const flash = q ? Math.exp(-Math.max(0, since) * 4) : 0
    const v = q ? verdict(q) : 'discarded'
    tmp.copy(v === 'key' ? C.green : v === 'sample' ? C.amber : v === 'error' ? C.red : C.white)
    const hit0 = q && q.bob_bit === 0 ? flash : 0
    const hit1 = q && q.bob_bit === 1 ? flash : 0
    d0.current?.color.copy(C.dim).lerp(tmp, hit0).multiplyScalar(1 + hit0 * 3)
    d1.current?.color.copy(C.dim).lerp(tmp, hit1).multiplyScalar(1 + hit1 * 3)
    if (ray0.current) {
      ray0.current.color.copy(tmp).multiplyScalar(2)
      ray0.current.opacity = hit0 * 0.9
    }
    if (ray1.current) {
      ray1.current.color.copy(tmp).multiplyScalar(2)
      ray1.current.opacity = hit1 * 0.9
    }
  })

  return (
    <group>
      {/* half-wave plate: turns for the × basis */}
      <group ref={plate} position={[3.7, 0, 0]}>
        <mesh rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.26, 0.26, 0.02, 48]} />
          <meshStandardMaterial ref={plateMat} metalness={0.3} roughness={0.15} transparent opacity={0.6} />
        </mesh>
        <mesh>
          <boxGeometry args={[0.02, 0.44, 0.008]} />
          <meshBasicMaterial color={col('#e4e4e7', 1.2)} toneMapped={false} />
        </mesh>
      </group>
      <Post x={3.7} top={-0.27} />

      {/* polarising beam splitter cube */}
      <mesh position={[END, 0, 0]}>
        <boxGeometry args={[0.56, 0.56, 0.56]} />
        <meshStandardMaterial color="#9fb7ff" transparent opacity={0.12} metalness={0.2} roughness={0.05} />
        <Edges color="#a1a1aa" />
      </mesh>
      <mesh position={[END, 0, 0]} rotation={[0, Math.PI / 4, 0]}>
        <planeGeometry args={[0.78, 0.55]} />
        <meshBasicMaterial color={col('#c7d2fe', 0.6)} transparent opacity={0.25} side={THREE.DoubleSide} toneMapped={false} />
      </mesh>
      <Post x={END} top={-0.28} />

      {/* D0: transmitted port */}
      <mesh position={[END + 0.62, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.012, 0.012, 0.66, 6]} />
        <meshBasicMaterial ref={ray0} transparent opacity={0} toneMapped={false} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
      <group position={[END + 1.05, 0, 0]}>
        <RoundedBox args={[0.42, 0.34, 0.34]} radius={0.05}>
          <meshStandardMaterial {...metal} />
        </RoundedBox>
        <mesh position={[-0.212, 0, 0]} rotation={[0, -Math.PI / 2, 0]}>
          <circleGeometry args={[0.1, 32]} />
          <meshBasicMaterial ref={d0} toneMapped={false} />
        </mesh>
      </group>
      <Post x={END + 1.05} top={-0.17} />

      {/* D1: reflected port */}
      <mesh position={[END, 0, -0.62]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.012, 0.012, 0.66, 6]} />
        <meshBasicMaterial ref={ray1} transparent opacity={0} toneMapped={false} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
      <group position={[END, 0, -1.05]}>
        <RoundedBox args={[0.34, 0.34, 0.42]} radius={0.05}>
          <meshStandardMaterial {...metal} />
        </RoundedBox>
        <mesh position={[0, 0, 0.212]}>
          <circleGeometry args={[0.1, 32]} />
          <meshBasicMaterial ref={d1} toneMapped={false} />
        </mesh>
      </group>

    </group>
  )
}

/** Eve's optical tap: a beam splitter on a stage that lowers into the beam. */
function EveTap({ attack, fx, collapseKey }: { attack: boolean; fx: Fx; collapseKey: number }) {
  const stage = useRef<THREE.Group>(null)
  const det = useRef<THREE.MeshBasicMaterial>(null)
  const light = useRef<THREE.PointLight>(null)
  const sample = useCollapse(collapseKey)
  useFrame(({ clock }, dt) => {
    const g = stage.current
    if (!g) return
    g.position.y = THREE.MathUtils.damp(g.position.y, attack ? 0 : 5, attack ? 3.2 : 4, dt)
    g.visible = g.position.y < 4.8
    fx.eveY = g.position.y
    const t = clock.elapsedTime
    const hit = Math.exp(-(t - fx.eveHit) * 5)
    const { g: glitch } = sample(t)
    det.current?.color.copy(C.red).multiplyScalar(0.5 + hit * 4 + glitch * 3)
    if (light.current) light.current.intensity = 1 + hit * 10 + glitch * 25
  })
  return (
    <group ref={stage} position={[TAP, 5, 0]} visible={false}>
      <mesh>
        <boxGeometry args={[0.42, 0.42, 0.42]} />
        <meshStandardMaterial color="#ff8095" transparent opacity={0.14} roughness={0.05} />
        <Edges color={RED} />
      </mesh>
      <mesh rotation={[0, Math.PI / 4, 0]}>
        <planeGeometry args={[0.58, 0.41]} />
        <meshBasicMaterial color={col(RED, 0.8)} transparent opacity={0.3} side={THREE.DoubleSide} toneMapped={false} />
      </mesh>
      <mesh position={[0, 2.6, 0]}>
        <cylinderGeometry args={[0.03, 0.03, 4.8, 12]} />
        <meshStandardMaterial {...metal} />
      </mesh>
      <mesh position={[0, 0.25, 0]}>
        <boxGeometry args={[0.5, 0.06, 0.5]} />
        <meshStandardMaterial {...metal} />
      </mesh>
      {/* Eve's detector on the tapped port */}
      <group position={[0, 0, -0.62]}>
        <RoundedBox args={[0.3, 0.3, 0.36]} radius={0.04}>
          <meshStandardMaterial {...metal} />
        </RoundedBox>
        <mesh position={[0, 0, 0.182]}>
          <circleGeometry args={[0.08, 24]} />
          <meshBasicMaterial ref={det} toneMapped={false} />
        </mesh>
      </group>
      <pointLight ref={light} color={RED} intensity={1} distance={4} position={[0, 0.2, 0.6]} />
    </group>
  )
}

const trailFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying vec2 vUv;
  void main() {
    gl_FragColor = vec4(uColor, pow(vUv.y, 2.4) * uOpacity);
  }
`

interface Slot {
  group: THREE.Group | null
  core: THREE.MeshBasicMaterial | null
  glow: THREE.Sprite | null
  glowMat: THREE.SpriteMaterial | null
  pol: THREE.Group | null
  polMat: THREE.MeshBasicMaterial | null
  ring: THREE.Mesh | null
  trail: { uColor: { value: THREE.Color }; uOpacity: { value: number } }
}

/** Discrete light packets with glowing tails; the bar through each shows its polarisation. */
function PhotonStream({ qubits, attack, fx, selected, onSelect, collapseKey }: {
  qubits: Qubit[]
  attack: boolean
  fx: Fx
  selected: number | null
  onSelect: (i: number) => void
  collapseKey: number
}) {
  const sample = useCollapse(collapseKey)
  const slots = useMemo<Slot[]>(
    () =>
      Array.from({ length: POOL }, () => ({
        group: null, core: null, glow: null, glowMat: null, pol: null, polMat: null, ring: null,
        trail: { uColor: { value: new THREE.Color() }, uOpacity: { value: 0 } },
      })),
    [],
  )
  const slotIndex = useRef<number[]>(Array(POOL).fill(-1))
  const lastP = useMemo(() => new Float32Array(qubits.length).fill(-1), [qubits])
  const tmp = useMemo(() => new THREE.Color(), [])
  const glowMap = useMemo(getGlowTexture, [])
  const selectedRef = useRef(selected)
  useEffect(() => {
    selectedRef.current = selected
  }, [selected])

  useFrame(({ clock }) => {
    const s = playback.s
    const t = clock.elapsedTime
    const { g } = sample(t)
    const head = Math.floor(s)
    const n = qubits.length
    for (let j = 0; j < POOL; j++) {
      const slot = slots[j]
      const grp = slot.group
      if (!grp) continue
      const i = head - j
      const p = (s - i) / TRAVEL
      if (i < 0 || i >= n || p < 0 || p > 1) {
        grp.visible = false
        slotIndex.current[j] = -1
        continue
      }
      grp.visible = true
      slotIndex.current[j] = i
      const q = qubits[i]
      const x = START + p * (END - START)
      const intercepted = attack && q.intercepted
      const pastEve = intercepted && x > TAP

      if (intercepted && lastP[i] >= 0 && lastP[i] < 0.5 && p >= 0.5) {
        fx.eveHit = t
        fx.spawn(q.state_disturbed)
      }
      lastP[i] = p

      const bit = pastEve && q.eve_bit !== null ? q.eve_bit : q.alice_bit
      const basis = pastEve && q.eve_basis ? q.eve_basis : q.alice_basis
      tmp.copy(basis === 'x' ? C.cross : C.plus)
      if (pastEve) tmp.lerp(q.state_disturbed ? C.red : C.amber, q.state_disturbed ? 0.9 : 0.55)
      if (g > 0) tmp.lerp(C.red, g)

      const jitter = (pastEve && q.state_disturbed ? 0.035 : 0) + g * 0.3
      grp.position.set(x + (Math.random() - 0.5) * jitter, (Math.random() - 0.5) * jitter, (Math.random() - 0.5) * jitter)
      const fade = Math.min(1, p / 0.035, (1 - p) / 0.05)
      grp.scale.setScalar(Math.max(0.001, fade))

      const pulse = 1 + Math.sin(t * 11 + i * 1.7) * 0.18
      slot.core?.color.copy(tmp).lerp(C.white, 0.55).multiplyScalar(3.2)
      slot.glow?.scale.setScalar(0.62 * pulse)
      slot.glowMat?.color.copy(tmp).multiplyScalar(1.8)
      slot.trail.uColor.value.copy(tmp).multiplyScalar(2.2)
      slot.trail.uOpacity.value = 0.75 * Math.min(1, p * TRAVEL)
      if (slot.pol) {
        const target = Math.PI / 2 - THREE.MathUtils.degToRad(polarizationDeg(bit, basis))
        slot.pol.rotation.x += (target - slot.pol.rotation.x) * 0.35
      }
      slot.polMat?.color.copy(tmp).lerp(C.white, 0.3).multiplyScalar(2)
      if (slot.ring) slot.ring.visible = selectedRef.current === i
    }
  })

  return (
    <group>
      {slots.map((slot, j) => (
        <group key={j} ref={(el) => { slot.group = el }} visible={false}>
          <mesh>
            <sphereGeometry args={[0.055, 16, 12]} />
            <meshBasicMaterial ref={(el) => { slot.core = el }} toneMapped={false} />
          </mesh>
          <sprite ref={(el) => { slot.glow = el }}>
            <spriteMaterial
              ref={(el) => { slot.glowMat = el }}
              map={glowMap}
              transparent
              depthWrite={false}
              blending={THREE.AdditiveBlending}
              toneMapped={false}
            />
          </sprite>
          <group position={[-0.5, 0, 0]} rotation={[0, 0, -Math.PI / 2]}>
            <mesh>
              <cylinderGeometry args={[0.045, 0.004, 1, 12, 1, true]} />
              <shaderMaterial
                vertexShader={beamVertex}
                fragmentShader={trailFragment}
                uniforms={slot.trail}
                transparent
                depthWrite={false}
                blending={THREE.AdditiveBlending}
                toneMapped={false}
              />
            </mesh>
          </group>
          <group ref={(el) => { slot.pol = el }}>
            <mesh>
              <boxGeometry args={[0.012, 0.36, 0.012]} />
              <meshBasicMaterial ref={(el) => { slot.polMat = el }} toneMapped={false} />
            </mesh>
          </group>
          <mesh ref={(el) => { slot.ring = el }} visible={false}>
            <torusGeometry args={[0.26, 0.008, 8, 48]} />
            <meshBasicMaterial color={col('#ffffff', 2)} toneMapped={false} />
          </mesh>
          {/* generous invisible hit target */}
          <mesh
            onClick={(e) => {
              e.stopPropagation()
              const i = slotIndex.current[j]
              if (i >= 0) onSelect(i)
            }}
            onPointerOver={() => { document.body.style.cursor = 'pointer' }}
            onPointerOut={() => { document.body.style.cursor = '' }}
          >
            <sphereGeometry args={[0.34, 10, 8]} />
            <meshBasicMaterial transparent opacity={0} depthWrite={false} />
          </mesh>
        </group>
      ))}
    </group>
  )
}

const DECO = 500

/** Red decoherence spray where Eve's tap collapses a photon. */
function Decoherence({ fx }: { fx: Fx }) {
  const geom = useRef<THREE.BufferGeometry>(null)
  const data = useMemo(
    () => ({
      pos: new Float32Array(DECO * 3),
      vel: new Float32Array(DECO * 3),
      colr: new Float32Array(DECO * 3),
      base: new Float32Array(DECO * 3),
      life: new Float32Array(DECO),
      cursor: 0,
    }),
    [],
  )

  useEffect(() => {
    fx.spawn = (disturbed) => {
      const count = disturbed ? 70 : 14
      const c = disturbed ? C.red : C.amber
      const spread = disturbed ? 1.6 : 0.6
      for (let k = 0; k < count; k++) {
        const i = data.cursor
        data.cursor = (data.cursor + 1) % DECO
        data.pos.set([TAP + (Math.random() - 0.5) * 0.1, (Math.random() - 0.5) * 0.1, (Math.random() - 0.5) * 0.1], i * 3)
        data.vel.set([0.4 + Math.random() * 1.4, (Math.random() - 0.5) * spread, (Math.random() - 0.5) * spread], i * 3)
        data.base.set([c.r * 2.5, c.g * 2.5, c.b * 2.5], i * 3)
        data.life[i] = 0.6 + Math.random() * 0.6
      }
    }
    return () => {
      fx.spawn = () => {}
    }
  }, [fx, data])

  useFrame((_, dt) => {
    const d = Math.min(dt, 0.05)
    for (let i = 0; i < DECO; i++) {
      if (data.life[i] <= 0) {
        data.colr[i * 3] = data.colr[i * 3 + 1] = data.colr[i * 3 + 2] = 0
        continue
      }
      data.life[i] -= d
      const k = Math.max(0, data.life[i])
      for (let a = 0; a < 3; a++) {
        data.pos[i * 3 + a] += data.vel[i * 3 + a] * d
        data.vel[i * 3 + a] *= 0.965
        data.colr[i * 3 + a] = data.base[i * 3 + a] * k
      }
    }
    if (geom.current) {
      geom.current.getAttribute('position').needsUpdate = true
      geom.current.getAttribute('color').needsUpdate = true
    }
  })

  return (
    <points frustumCulled={false}>
      <bufferGeometry ref={geom}>
        <bufferAttribute attach="attributes-position" args={[data.pos, 3]} />
        <bufferAttribute attach="attributes-color" args={[data.colr, 3]} />
      </bufferGeometry>
      <pointsMaterial size={0.045} vertexColors transparent depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} sizeAttenuation />
    </points>
  )
}

const BURST = 1200

/** The channel shatters outward once, when the attack result lands. */
function CollapseBurst({ collapseKey }: { collapseKey: number }) {
  const points = useRef<THREE.Points>(null)
  const mat = useRef<THREE.PointsMaterial>(null)
  const sample = useCollapse(collapseKey)
  const { origin, velocity, positions } = useMemo(() => {
    const origin = new Float32Array(BURST * 3)
    const velocity = new Float32Array(BURST * 3)
    for (let i = 0; i < BURST; i++) {
      const x = i < BURST * 0.5 ? TAP + (Math.random() - 0.5) * 0.4 : START + Math.random() * (END - START)
      origin.set([x, 0, 0], i * 3)
      const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize()
      const speed = 0.8 + Math.random() * 3.2
      velocity.set([dir.x * speed * 0.5, dir.y * speed, dir.z * speed], i * 3)
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
      <pointsMaterial ref={mat} color={col(RED, 2.2)} size={0.05} transparent depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} sizeAttenuation />
    </points>
  )
}
