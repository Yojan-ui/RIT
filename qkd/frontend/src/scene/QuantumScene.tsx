import { useEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Float, Html, OrbitControls, Sparkles, Stars } from '@react-three/drei'
import * as THREE from 'three'
import type { Qubit } from '../api'
import { useCollapse } from './collapse'

const L = 4.5 // Alice at -L, Bob at +L, Eve at 0
const SLOTS = 16 // photons in flight at once
const PERIOD = 8 // seconds for one photon to cross the channel

const C = {
  cyan: new THREE.Color('#22d3ee'),
  violet: new THREE.Color('#a78bfa'),
  red: new THREE.Color('#f43f5e'),
  amber: new THREE.Color('#fbbf24'),
  green: new THREE.Color('#34d399'),
}

interface SceneProps {
  qubits: Qubit[]
  attack: boolean
  collapseKey: number
}

export function QuantumScene({ qubits, attack, collapseKey }: SceneProps) {
  return (
    <Canvas camera={{ position: [0, 3.6, 14.5], fov: 45 }} dpr={[1, 2]} gl={{ antialias: true }}>
      <color attach="background" args={['#05060d']} />
      <fog attach="fog" args={['#05060d', 16, 34]} />
      <ambientLight intensity={0.35} />
      <pointLight position={[-L, 3, 3]} color="#22d3ee" intensity={40} />
      <pointLight position={[L, 3, 3]} color="#a78bfa" intensity={40} />
      <Stars radius={70} depth={40} count={2600} factor={3} fade speed={0.5} />
      <Sparkles count={60} scale={[16, 5, 6]} size={1.6} speed={0.25} color="#7dd3fc" opacity={0.5} />

      <Station position={[-L, 0, 0]} color="#22d3ee" label="ALICE" sub="photon source" />
      <Station position={[L, 0, 0]} color="#a78bfa" label="BOB" sub="detector" />
      <ChannelBeam attack={attack} collapseKey={collapseKey} />
      {attack && <EveNode collapseKey={collapseKey} />}
      {qubits.length > 0 && <PhotonStream qubits={qubits} collapseKey={collapseKey} />}
      <CollapseBurst collapseKey={collapseKey} />

      <CameraFit />
      <gridHelper args={[40, 40, '#1e2a4a', '#0e1428']} position={[0, -2.2, 0]} />
      <OrbitControls
        enablePan={false}
        minDistance={7}
        maxDistance={34}
        maxPolarAngle={Math.PI * 0.62}
      />
    </Canvas>
  )
}

/** Pull the camera back on narrow screens so Alice and Bob both stay in frame. */
function CameraFit() {
  const { camera, size } = useThree()
  useEffect(() => {
    const aspect = size.width / size.height
    const halfWidth = L + 1.5
    const fovTan = Math.tan(THREE.MathUtils.degToRad(45 / 2))
    camera.position.setLength(Math.max(15, halfWidth / (fovTan * aspect)))
  }, [camera, size])
  return null
}

function Station({ position, color, label, sub }: { position: [number, number, number]; color: string; label: string; sub: string }) {
  const ring = useRef<THREE.Group>(null)
  useFrame((_, dt) => {
    if (ring.current) {
      ring.current.rotation.x += dt * 0.6
      ring.current.rotation.y += dt * 0.35
    }
  })
  return (
    <group position={position}>
      <Float speed={1.4} rotationIntensity={0.3} floatIntensity={0.4}>
        <mesh>
          <icosahedronGeometry args={[0.72, 1]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.5} wireframe />
        </mesh>
        <mesh>
          <sphereGeometry args={[0.36, 32, 32]} />
          <meshBasicMaterial color={color} />
        </mesh>
        <mesh>
          <sphereGeometry args={[0.95, 32, 32]} />
          <meshBasicMaterial color={color} transparent opacity={0.07} depthWrite={false} blending={THREE.AdditiveBlending} />
        </mesh>
        <group ref={ring}>
          <mesh>
            <torusGeometry args={[1.15, 0.012, 8, 96]} />
            <meshBasicMaterial color={color} transparent opacity={0.6} />
          </mesh>
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[1.3, 0.008, 8, 96]} />
            <meshBasicMaterial color={color} transparent opacity={0.35} />
          </mesh>
        </group>
      </Float>
      <Html position={[0, -1.65, 0]} center zIndexRange={[1, 0]} style={{ pointerEvents: 'none' }}>
        <div className="text-center whitespace-nowrap select-none">
          <div className="text-sm font-extrabold tracking-[0.3em]" style={{ color, textShadow: `0 0 12px ${color}` }}>
            {label}
          </div>
          <div className="label mt-0.5">{sub}</div>
        </div>
      </Html>
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

// Energy stripes flowing Alice → Bob. uGlitch tears the beam into displaced
// slices and flickers it; uAttack slowly bleeds the colour toward red.
const beamFragment = /* glsl */ `
  uniform float uTime;
  uniform float uGlitch;
  uniform float uAttack;
  uniform float uAlpha;
  varying vec2 vUv;

  float hash(float n) { return fract(sin(n) * 43758.5453); }

  void main() {
    float v = vUv.y;
    float slice = floor(v * 48.0);
    float tear = uGlitch * step(0.55, hash(slice + floor(uTime * 26.0)));
    v += tear * (hash(slice * 3.7 + floor(uTime * 26.0)) - 0.5) * 0.25;

    float stripes = smoothstep(0.72, 1.0, sin(v * 34.0 - uTime * 5.0) * 0.5 + 0.5);
    vec3 cyan = vec3(0.13, 0.83, 0.93);
    vec3 violet = vec3(0.65, 0.55, 0.98);
    vec3 red = vec3(0.96, 0.25, 0.37);
    vec3 col = mix(cyan, violet, vUv.y);
    // Past Eve (centre of the beam) the channel is tainted during an attack.
    float tainted = uAttack * smoothstep(0.48, 0.56, vUv.y) * 0.55;
    col = mix(col, red, clamp(tainted + uGlitch, 0.0, 1.0));

    float flicker = 1.0 - uGlitch * 0.7 * hash(floor(uTime * 32.0));
    float alpha = (0.16 + stripes * 0.55) * flicker * (1.0 + tear * 3.0);
    gl_FragColor = vec4(col * (1.0 + stripes * 0.8), alpha * uAlpha);
  }
`

function ChannelBeam({ attack, collapseKey }: { attack: boolean; collapseKey: number }) {
  const sample = useCollapse(collapseKey)
  // Core and halo share the animated uniforms but not the alpha.
  const uniforms = useMemo(() => ({ uTime: { value: 0 }, uGlitch: { value: 0 }, uAttack: { value: 0 }, uAlpha: { value: 1 } }), [])
  const halo = useMemo(() => ({ ...uniforms, uAlpha: { value: 0.35 } }), [uniforms])
  useFrame(({ clock }, dt) => {
    const t = clock.elapsedTime
    uniforms.uTime.value = t
    uniforms.uGlitch.value = sample(t).g
    uniforms.uAttack.value = THREE.MathUtils.damp(uniforms.uAttack.value, attack ? 1 : 0, 2, dt)
  })
  const length = 2 * L - 1.8
  return (
    <group rotation={[0, 0, -Math.PI / 2]}>
      <mesh>
        <cylinderGeometry args={[0.035, 0.035, length, 12, 1, true]} />
        <shaderMaterial
          vertexShader={beamVertex}
          fragmentShader={beamFragment}
          uniforms={uniforms}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
      <mesh>
        <cylinderGeometry args={[0.2, 0.2, length, 24, 1, true]} />
        <shaderMaterial
          vertexShader={beamVertex}
          fragmentShader={beamFragment}
          uniforms={halo}
          transparent
          depthWrite={false}
          side={THREE.DoubleSide}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
    </group>
  )
}

function EveNode({ collapseKey }: { collapseKey: number }) {
  const body = useRef<THREE.Mesh>(null)
  const light = useRef<THREE.PointLight>(null)
  const sample = useCollapse(collapseKey)
  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    const { g } = sample(t)
    if (body.current) {
      body.current.rotation.y = t * 1.3
      body.current.rotation.z = t * 0.7
      const jitter = 0.03 + g * 0.25
      body.current.position.set((Math.random() - 0.5) * jitter, 1.6 + (Math.random() - 0.5) * jitter, 0)
    }
    if (light.current) light.current.intensity = 12 + g * 120 + Math.sin(t * 9) * 3
  })
  return (
    <group>
      <mesh ref={body} position={[0, 1.6, 0]}>
        <octahedronGeometry args={[0.45, 0]} />
        <meshStandardMaterial color="#f43f5e" emissive="#f43f5e" emissiveIntensity={1.2} wireframe />
      </mesh>
      {/* Eve's tap on the fibre */}
      <mesh position={[0, 0.8, 0]}>
        <cylinderGeometry args={[0.012, 0.012, 1.4, 6]} />
        <meshBasicMaterial color="#f43f5e" transparent opacity={0.7} />
      </mesh>
      <mesh rotation={[0, Math.PI / 2, 0]}>
        <torusGeometry args={[0.32, 0.015, 8, 48]} />
        <meshBasicMaterial color="#f43f5e" />
      </mesh>
      <pointLight ref={light} position={[0, 1.2, 0.5]} color="#f43f5e" intensity={12} distance={8} />
      <Html position={[0, 2.5, 0]} center zIndexRange={[1, 0]} style={{ pointerEvents: 'none' }}>
        <div className="text-center whitespace-nowrap select-none">
          <div className="text-sm font-extrabold tracking-[0.3em] text-q-red" style={{ textShadow: '0 0 12px #f43f5e' }}>
            EVE
          </div>
          <div className="label mt-0.5 text-q-red/70!">intercept · resend</div>
        </div>
      </Html>
    </group>
  )
}

/** Bloch coordinates (x, y, z) → scene space: Bloch z is up, Bloch x points toward Bob. */
const toScene = (b: [number, number, number], out: THREE.Vector3) => out.set(b[0], b[2], b[1])

const UP = new THREE.Vector3(0, 1, 0)

function PhotonStream({ qubits, collapseKey }: { qubits: Qubit[]; collapseKey: number }) {
  const groups = useRef<(THREE.Group | null)[]>([])
  const arrows = useRef<(THREE.Group | null)[]>([])
  const shells = useRef<(THREE.MeshBasicMaterial | null)[]>([])
  const arrowMats = useRef<(THREE.MeshBasicMaterial | null)[]>([])
  const glows = useRef<(THREE.MeshBasicMaterial | null)[]>([])
  const sample = useCollapse(collapseKey)
  const tmp = useMemo(() => ({ v: new THREE.Vector3(), q: new THREE.Quaternion(), c: new THREE.Color() }), [])

  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    const { g } = sample(t)
    const n = qubits.length

    for (let k = 0; k < SLOTS; k++) {
      const group = groups.current[k]
      const arrow = arrows.current[k]
      if (!group || !arrow) continue

      const phase = t / PERIOD + k / SLOTS
      const cycle = Math.floor(phase)
      const p = phase - cycle
      const q = qubits[(cycle * SLOTS + k) % n]
      const x = -L + 1 + p * (2 * L - 2)
      const pastEve = x > 0 && q.intercepted

      // State: Alice's until Eve, Eve's re-prepared state after her.
      const bloch = pastEve && q.eve_bloch ? q.eve_bloch : q.alice_bloch
      const basis = pastEve && q.eve_basis ? q.eve_basis : q.alice_basis
      tmp.c.copy(basis === '+' ? C.cyan : C.violet)
      if (pastEve) tmp.c.lerp(q.state_disturbed ? C.red : C.amber, q.state_disturbed ? 0.9 : 0.6)
      if (g > 0) tmp.c.lerp(C.red, g)

      // Disturbed photons shake; everything shakes during the collapse.
      const jitter = (pastEve && q.state_disturbed ? 0.06 : 0) + g * 0.5
      group.position.set(
        x + (Math.random() - 0.5) * jitter,
        Math.sin(t * 2 + k) * 0.12 + (Math.random() - 0.5) * jitter,
        Math.cos(t * 1.3 + k) * 0.06 + (Math.random() - 0.5) * jitter,
      )
      const fade = Math.min(1, p / 0.06, (1 - p) / 0.06)
      group.scale.setScalar(Math.max(0.001, fade) * (1 + g * 0.6))

      toScene(bloch, tmp.v).normalize()
      tmp.q.setFromUnitVectors(UP, tmp.v)
      arrow.quaternion.slerp(tmp.q, 0.35)

      shells.current[k]?.color.copy(tmp.c)
      arrowMats.current[k]?.color.copy(tmp.c)
      const glow = glows.current[k]
      if (glow) {
        glow.color.copy(tmp.c)
        glow.opacity = 0.18 + g * 0.3
      }
    }
  })

  return (
    <group>
      {Array.from({ length: SLOTS }, (_, k) => (
        <group key={k} ref={(el) => { groups.current[k] = el }}>
          {/* Mini Bloch sphere: shell, equator, state vector */}
          <mesh>
            <sphereGeometry args={[0.3, 20, 14]} />
            <meshBasicMaterial ref={(el) => { shells.current[k] = el }} wireframe transparent opacity={0.28} />
          </mesh>
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.3, 0.006, 6, 40]} />
            <meshBasicMaterial color="#dbe4ff" transparent opacity={0.35} />
          </mesh>
          <mesh>
            <sphereGeometry args={[0.46, 16, 12]} />
            <meshBasicMaterial
              ref={(el) => { glows.current[k] = el }}
              transparent
              opacity={0.18}
              depthWrite={false}
              blending={THREE.AdditiveBlending}
            />
          </mesh>
          <group ref={(el) => { arrows.current[k] = el }}>
            <mesh position={[0, 0.14, 0]}>
              <cylinderGeometry args={[0.018, 0.018, 0.28, 8]} />
              <meshBasicMaterial ref={(el) => { arrowMats.current[k] = el }} />
            </mesh>
            <mesh position={[0, 0.32, 0]}>
              <coneGeometry args={[0.055, 0.1, 12]} />
              <meshBasicMaterial color="#ffffff" />
            </mesh>
          </group>
        </group>
      ))}
    </group>
  )
}

const BURST = 900

/** Particle dispersion: the channel shatters outward when Eve is detected. */
function CollapseBurst({ collapseKey }: { collapseKey: number }) {
  const points = useRef<THREE.Points>(null)
  const mat = useRef<THREE.PointsMaterial>(null)
  const sample = useCollapse(collapseKey)
  const { origin, velocity, positions } = useMemo(() => {
    const origin = new Float32Array(BURST * 3)
    const velocity = new Float32Array(BURST * 3)
    for (let i = 0; i < BURST; i++) {
      // Most particles come off Eve's tap; the rest from along the channel.
      const x = i < BURST * 0.45 ? (Math.random() - 0.5) * 0.6 : (Math.random() - 0.5) * (2 * L - 2)
      origin.set([x, 0, 0], i * 3)
      const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize()
      const speed = 1.5 + Math.random() * 4.5
      velocity.set([dir.x * speed * 0.6, dir.y * speed, dir.z * speed], i * 3)
    }
    return { origin, velocity, positions: new Float32Array(origin) }
  }, [])

  useFrame(({ clock }) => {
    const { g, d } = sample(clock.elapsedTime)
    if (!points.current || !mat.current) return
    points.current.visible = g > 0
    if (g <= 0) return
    const travel = 1 - Math.exp(-d * 2.2) // fast out, then drift
    for (let i = 0; i < BURST * 3; i++) positions[i] = origin[i] + velocity[i] * travel
    const attr = points.current.geometry.getAttribute('position') as THREE.BufferAttribute
    attr.needsUpdate = true
    mat.current.opacity = g
    mat.current.size = 0.05 + g * 0.07
  })

  return (
    <points ref={points} visible={false} frustumCulled={false}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial
        ref={mat}
        color="#f43f5e"
        size={0.1}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        sizeAttenuation
      />
    </points>
  )
}
