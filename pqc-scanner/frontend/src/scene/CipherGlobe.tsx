import { useEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { Bloom, EffectComposer } from '@react-three/postprocessing'
import * as THREE from 'three'
import type { Tone } from '../api'

export type Phase = 'idle' | 'scanning' | 'result'

const PALETTE: Record<'idle' | 'scanning' | Tone, string> = {
  idle: '#38bdf8',
  scanning: '#67e8f9',
  emerald: '#34d399',
  amber: '#fbbf24',
  crimson: '#f43f5e',
}

const R = 1.6
const WHITE = new THREE.Color('#ffffff')
const RAYS = 18
const SWARM = 520

/** Shared animated colour + scan intensity, read by every part of the globe each frame. */
interface Drive {
  color: THREE.Color
  target: THREE.Color
  scan: number // 0 → 1 while scanning
  burstAt: number // clock time of the last result shockwave
}

let glowTexture: THREE.Texture | null = null
function glowMap() {
  if (glowTexture) return glowTexture
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const g = c.getContext('2d')!
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64)
  grad.addColorStop(0, 'rgba(255,255,255,1)')
  grad.addColorStop(0.25, 'rgba(255,255,255,0.45)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, 128, 128)
  glowTexture = new THREE.CanvasTexture(c)
  return glowTexture
}

export function CipherGlobe({ phase, tone }: { phase: Phase; tone: Tone | null }) {
  const drive = useMemo<Drive>(() => ({ color: new THREE.Color(PALETTE.idle), target: new THREE.Color(PALETTE.idle), scan: 0, burstAt: -10 }), [])
  const key = phase === 'result' && tone ? tone : phase === 'scanning' ? 'scanning' : 'idle'
  useEffect(() => {
    drive.target.set(PALETTE[key])
  }, [key, drive])

  return (
    <Canvas camera={{ position: [0, 0.3, 6.2], fov: 42 }} dpr={[1, 2]} gl={{ antialias: true, alpha: true }}>
      <Driver drive={drive} phase={phase} />
      <Globe drive={drive} />
      <Rays drive={drive} />
      <Swarm drive={drive} />
      <Shockwave drive={drive} />
      <OrbitControls enableZoom={false} enablePan={false} rotateSpeed={0.5} />
      <EffectComposer multisampling={4}>
        <Bloom mipmapBlur luminanceThreshold={0.35} intensity={1.25} radius={0.7} />
      </EffectComposer>
    </Canvas>
  )
}

function Driver({ drive, phase }: { drive: Drive; phase: Phase }) {
  const prev = useRef<Phase>(phase)
  useFrame(({ clock }, dt) => {
    if (prev.current === 'scanning' && phase === 'result') drive.burstAt = clock.elapsedTime
    prev.current = phase
    drive.color.lerp(drive.target, 1 - Math.exp(-dt * 3.5))
    drive.scan = THREE.MathUtils.damp(drive.scan, phase === 'scanning' ? 1 : 0, phase === 'scanning' ? 4 : 2, dt)
  })
  return null
}

function Globe({ drive }: { drive: Drive }) {
  const spin = useRef<THREE.Group>(null)
  const ringA = useRef<THREE.Group>(null)
  const ringB = useRef<THREE.Group>(null)
  const mats = useRef<{ edges?: THREE.LineBasicMaterial; lat?: THREE.MeshBasicMaterial; nodes?: THREE.PointsMaterial; core?: THREE.MeshBasicMaterial; glow?: THREE.SpriteMaterial; ringA?: THREE.MeshBasicMaterial; ringB?: THREE.MeshBasicMaterial }>({})
  const edges = useMemo(() => new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(R, 2)), [])
  const vertices = useMemo(() => {
    const g = new THREE.IcosahedronGeometry(R, 1)
    const seen = new Set<string>()
    const pts: number[] = []
    const pos = g.getAttribute('position')
    for (let i = 0; i < pos.count; i++) {
      const k = `${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`
      if (seen.has(k)) continue
      seen.add(k)
      pts.push(pos.getX(i), pos.getY(i), pos.getZ(i))
    }
    return new Float32Array(pts)
  }, [])
  const map = useMemo(glowMap, [])
  const tmp = useMemo(() => new THREE.Color(), [])

  useFrame(({ clock }, dt) => {
    const t = clock.elapsedTime
    const speed = 0.12 + drive.scan * 0.9
    if (spin.current) {
      spin.current.rotation.y += dt * speed
      spin.current.rotation.x = Math.sin(t * 0.2) * 0.12
    }
    if (ringA.current) ringA.current.rotation.z += dt * (0.25 + drive.scan)
    if (ringB.current) ringB.current.rotation.x += dt * (0.18 + drive.scan * 0.8)
    const c = drive.color
    const pulse = 1 + Math.sin(t * (2 + drive.scan * 8)) * (0.08 + drive.scan * 0.12)
    const m = mats.current
    m.edges?.color.copy(c).multiplyScalar(0.9)
    m.lat?.color.copy(c)
    m.nodes?.color.copy(c).multiplyScalar(1.6)
    m.core?.color.copy(tmp.copy(c).lerp(WHITE, 0.25)).multiplyScalar(1.4 * pulse)
    if (m.glow) {
      m.glow.color.copy(c)
      m.glow.opacity = 0.55 + drive.scan * 0.35
    }
    m.ringA?.color.copy(c).multiplyScalar(1.2)
    m.ringB?.color.copy(c).multiplyScalar(0.8)
  })

  return (
    <group>
      <group ref={spin}>
        <lineSegments geometry={edges}>
          <lineBasicMaterial ref={(el) => { mats.current.edges = el ?? undefined }} transparent opacity={0.55} toneMapped={false} />
        </lineSegments>
        <mesh>
          <sphereGeometry args={[R * 1.004, 36, 18]} />
          <meshBasicMaterial ref={(el) => { mats.current.lat = el ?? undefined }} wireframe transparent opacity={0.07} />
        </mesh>
        <points>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[vertices, 3]} />
          </bufferGeometry>
          <pointsMaterial ref={(el) => { mats.current.nodes = el ?? undefined }} size={0.07} sizeAttenuation toneMapped={false} />
        </points>
      </group>
      <mesh>
        <icosahedronGeometry args={[0.42, 1]} />
        <meshBasicMaterial ref={(el) => { mats.current.core = el ?? undefined }} toneMapped={false} />
      </mesh>
      <sprite scale={2.6}>
        <spriteMaterial ref={(el) => { mats.current.glow = el ?? undefined }} map={map} transparent depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </sprite>
      <group ref={ringA} rotation={[Math.PI / 2.4, 0, 0]}>
        <mesh>
          <torusGeometry args={[R * 1.32, 0.008, 8, 160]} />
          <meshBasicMaterial ref={(el) => { mats.current.ringA = el ?? undefined }} toneMapped={false} />
        </mesh>
        <mesh position={[R * 1.32, 0, 0]}>
          <sphereGeometry args={[0.045, 12, 12]} />
          <meshBasicMaterial color={new THREE.Color('#ffffff').multiplyScalar(2)} toneMapped={false} />
        </mesh>
      </group>
      <group ref={ringB} rotation={[0, 0, Math.PI / 5]}>
        <mesh>
          <torusGeometry args={[R * 1.55, 0.005, 8, 160]} />
          <meshBasicMaterial ref={(el) => { mats.current.ringB = el ?? undefined }} transparent opacity={0.6} toneMapped={false} />
        </mesh>
      </group>
    </group>
  )
}

/** Pulse rays: glowing packets streaming in from all directions while a scan runs. */
function Rays({ drive }: { drive: Drive }) {
  const lineMat = useRef<THREE.LineBasicMaterial>(null)
  const pointMat = useRef<THREE.PointsMaterial>(null)
  const pointGeom = useRef<THREE.BufferGeometry>(null)
  const { dirs, lines, heads, phases } = useMemo(() => {
    const dirs: THREE.Vector3[] = []
    const lines = new Float32Array(RAYS * 6)
    for (let i = 0; i < RAYS; i++) {
      const d = new THREE.Vector3().randomDirection()
      dirs.push(d)
      lines.set([d.x * 5.5, d.y * 5.5, d.z * 5.5, d.x * R, d.y * R, d.z * R], i * 6)
    }
    return { dirs, lines, heads: new Float32Array(RAYS * 3), phases: Array.from({ length: RAYS }, () => Math.random()) }
  }, [])

  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    for (let i = 0; i < RAYS; i++) {
      const p = (t * 0.9 + phases[i]) % 1
      const r = 5.5 - p * (5.5 - R)
      heads.set([dirs[i].x * r, dirs[i].y * r, dirs[i].z * r], i * 3)
    }
    if (pointGeom.current) pointGeom.current.getAttribute('position').needsUpdate = true
    if (lineMat.current) {
      lineMat.current.color.copy(drive.color)
      lineMat.current.opacity = drive.scan * 0.22
    }
    if (pointMat.current) {
      pointMat.current.color.copy(drive.color).multiplyScalar(2.2)
      pointMat.current.opacity = drive.scan
    }
  })

  return (
    <group>
      <lineSegments>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[lines, 3]} />
        </bufferGeometry>
        <lineBasicMaterial ref={lineMat} transparent opacity={0} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </lineSegments>
      <points frustumCulled={false}>
        <bufferGeometry ref={pointGeom}>
          <bufferAttribute attach="attributes-position" args={[heads, 3]} />
        </bufferGeometry>
        <pointsMaterial ref={pointMat} size={0.14} map={glowMap()} transparent opacity={0} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} sizeAttenuation />
      </points>
    </group>
  )
}

/** Data particles spiralling into the node while scanning; a faint drift otherwise. */
function Swarm({ drive }: { drive: Drive }) {
  const geom = useRef<THREE.BufferGeometry>(null)
  const mat = useRef<THREE.PointsMaterial>(null)
  const { seeds, pos } = useMemo(() => {
    const seeds = Array.from({ length: SWARM }, () => ({
      dir: new THREE.Vector3().randomDirection(),
      phase: Math.random(),
      speed: 0.25 + Math.random() * 0.35,
      twist: (Math.random() - 0.5) * 3,
    }))
    return { seeds, pos: new Float32Array(SWARM * 3) }
  }, [])
  const axis = useMemo(() => new THREE.Vector3(0, 1, 0), [])
  const v = useMemo(() => new THREE.Vector3(), [])

  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    seeds.forEach((s, i) => {
      const p = (t * s.speed * (0.3 + drive.scan * 1.4) + s.phase) % 1
      const r = 4.2 - p * (4.2 - R * 1.05)
      v.copy(s.dir).applyAxisAngle(axis, p * s.twist).multiplyScalar(r)
      pos.set([v.x, v.y, v.z], i * 3)
    })
    if (geom.current) geom.current.getAttribute('position').needsUpdate = true
    if (mat.current) {
      mat.current.color.copy(drive.color).multiplyScalar(1.4)
      mat.current.opacity = 0.18 + drive.scan * 0.7
    }
  })

  return (
    <points frustumCulled={false}>
      <bufferGeometry ref={geom}>
        <bufferAttribute attach="attributes-position" args={[pos, 3]} />
      </bufferGeometry>
      <pointsMaterial ref={mat} size={0.035} transparent depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} sizeAttenuation />
    </points>
  )
}

/** One expanding ring in the verdict colour when a result lands. */
function Shockwave({ drive }: { drive: Drive }) {
  const ring = useRef<THREE.Mesh>(null)
  const mat = useRef<THREE.MeshBasicMaterial>(null)
  useFrame(({ clock, camera }) => {
    const d = clock.elapsedTime - drive.burstAt
    const on = d >= 0 && d < 1.4
    if (!ring.current || !mat.current) return
    ring.current.visible = on
    if (!on) return
    ring.current.quaternion.copy(camera.quaternion)
    ring.current.scale.setScalar(1 + d * 2.6)
    mat.current.color.copy(drive.target).multiplyScalar(2)
    mat.current.opacity = (1 - d / 1.4) ** 2
  })
  return (
    <mesh ref={ring} visible={false}>
      <ringGeometry args={[R * 1.02, R * 1.08, 96]} />
      <meshBasicMaterial ref={mat} transparent depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} side={THREE.DoubleSide} />
    </mesh>
  )
}
