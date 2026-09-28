import { useEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { Tone } from '../api'

export type Phase = 'idle' | 'scanning' | 'result'

// Monochrome wireframe; status only tints one thin orbit line.
const BASE = new THREE.Color('#9aa4b2')
const HINT = new THREE.Color('#7dd3fc') // faint cyan
const STATUS: Record<Tone, THREE.Color> = {
  emerald: new THREE.Color('#10b981'),
  amber: new THREE.Color('#f59e0b'),
  crimson: new THREE.Color('#ef4444'),
}

const R = 1.6
const DUST = 260

interface Drive {
  accent: THREE.Color
  accentTarget: THREE.Color
  scan: number
  sweepAt: number
}

/**
 * Calm backdrop: a slowly turning wireframe sphere with a sparse particle field.
 * `pulseKey` sends a single thin latitude sweep (used on migration / anchoring).
 */
export function CipherGlobe({ phase, tone, pulseKey = 0 }: { phase: Phase; tone: Tone | null; pulseKey?: number }) {
  const drive = useMemo<Drive>(() => ({ accent: HINT.clone(), accentTarget: HINT.clone(), scan: 0, sweepAt: -10 }), [])
  useEffect(() => {
    drive.accentTarget.copy(phase === 'result' && tone ? STATUS[tone] : HINT)
  }, [phase, tone, drive])

  return (
    <Canvas camera={{ position: [0, 0.2, 6.4], fov: 40 }} dpr={[1, 1.75]} gl={{ antialias: true, alpha: true }}>
      <Driver drive={drive} phase={phase} pulseKey={pulseKey} />
      <Sphere drive={drive} />
      <Sweep drive={drive} />
      <Dust drive={drive} />
    </Canvas>
  )
}

function Driver({ drive, phase, pulseKey }: { drive: Drive; phase: Phase; pulseKey: number }) {
  const pulse = useRef(false)
  const prev = useRef(phase)
  useEffect(() => {
    if (pulseKey > 0) pulse.current = true
  }, [pulseKey])
  useFrame(({ clock }, dt) => {
    if (pulse.current || (prev.current === 'scanning' && phase === 'result')) drive.sweepAt = clock.elapsedTime
    pulse.current = false
    prev.current = phase
    drive.accent.lerp(drive.accentTarget, 1 - Math.exp(-dt * 2.5))
    drive.scan = THREE.MathUtils.damp(drive.scan, phase === 'scanning' ? 1 : 0, 3, dt)
  })
  return null
}

function Sphere({ drive }: { drive: Drive }) {
  const spin = useRef<THREE.Group>(null)
  const orbit = useRef<THREE.Group>(null)
  const edgeMat = useRef<THREE.LineBasicMaterial>(null)
  const latMat = useRef<THREE.MeshBasicMaterial>(null)
  const nodeMat = useRef<THREE.PointsMaterial>(null)
  const orbitMat = useRef<THREE.MeshBasicMaterial>(null)
  const edges = useMemo(() => new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(R, 2)), [])
  const nodes = useMemo(() => new THREE.IcosahedronGeometry(R, 2).getAttribute('position').array as Float32Array, [])
  const tint = useMemo(() => BASE.clone().lerp(HINT, 0.12), [])

  useFrame((_, dt) => {
    const s = drive.scan
    if (spin.current) spin.current.rotation.y += dt * (0.05 + s * 0.18)
    if (orbit.current) orbit.current.rotation.z += dt * (0.04 + s * 0.1)
    if (edgeMat.current) edgeMat.current.opacity = 0.16 + s * 0.08
    orbitMat.current?.color.copy(drive.accent)
  })

  return (
    <group rotation={[0.18, 0, 0]}>
      <group ref={spin}>
        <lineSegments geometry={edges}>
          <lineBasicMaterial ref={edgeMat} color={tint} transparent opacity={0.16} depthWrite={false} />
        </lineSegments>
        <mesh>
          <sphereGeometry args={[R * 1.003, 48, 24]} />
          <meshBasicMaterial ref={latMat} color={tint} wireframe transparent opacity={0.035} depthWrite={false} />
        </mesh>
        <points>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[nodes, 3]} />
          </bufferGeometry>
          <pointsMaterial ref={nodeMat} color={tint} size={0.022} sizeAttenuation transparent opacity={0.5} depthWrite={false} />
        </points>
      </group>
      <group ref={orbit} rotation={[Math.PI / 3, 0.35, 0]}>
        <mesh>
          <torusGeometry args={[R * 1.28, 0.0025, 6, 200]} />
          <meshBasicMaterial ref={orbitMat} transparent opacity={0.35} depthWrite={false} />
        </mesh>
      </group>
    </group>
  )
}

/** A single thin latitude ring travelling pole to pole while scanning (and once per pulse). */
function Sweep({ drive }: { drive: Drive }) {
  const ring = useRef<THREE.Mesh>(null)
  const mat = useRef<THREE.MeshBasicMaterial>(null)
  useFrame(({ clock }) => {
    if (!ring.current || !mat.current) return
    const t = clock.elapsedTime
    const sinceSweep = t - drive.sweepAt
    const pulse = sinceSweep >= 0 && sinceSweep < 1.6 ? sinceSweep / 1.6 : -1
    const active = drive.scan > 0.02 || pulse >= 0
    ring.current.visible = active
    if (!active) return
    const p = pulse >= 0 ? pulse : (t * 0.45) % 1
    const y = Math.cos(p * Math.PI) * R
    const r = Math.sqrt(Math.max(0, R * R - y * y))
    ring.current.position.y = y
    ring.current.scale.setScalar(Math.max(0.001, r))
    mat.current.color.copy(pulse >= 0 ? drive.accent : HINT)
    mat.current.opacity = (pulse >= 0 ? 1 - pulse : drive.scan) * 0.5 * Math.sin(p * Math.PI)
  })
  return (
    <group rotation={[0.18, 0, 0]}>
      <mesh ref={ring} rotation={[Math.PI / 2, 0, 0]} visible={false}>
        <torusGeometry args={[1, 0.004, 6, 160]} />
        <meshBasicMaterial ref={mat} transparent depthWrite={false} />
      </mesh>
    </group>
  )
}

/** Sparse, slow dust drifting toward the sphere; a little denser while scanning. */
function Dust({ drive }: { drive: Drive }) {
  const geom = useRef<THREE.BufferGeometry>(null)
  const mat = useRef<THREE.PointsMaterial>(null)
  const { seeds, pos } = useMemo(() => ({
    seeds: Array.from({ length: DUST }, () => ({ dir: new THREE.Vector3().randomDirection(), phase: Math.random(), speed: 0.03 + Math.random() * 0.05 })),
    pos: new Float32Array(DUST * 3),
  }), [])
  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    seeds.forEach((s, i) => {
      const p = (t * s.speed * (1 + drive.scan * 2.5) + s.phase) % 1
      const r = 5 - p * (5 - R * 1.1)
      pos[i * 3] = s.dir.x * r
      pos[i * 3 + 1] = s.dir.y * r
      pos[i * 3 + 2] = s.dir.z * r
    })
    if (geom.current) geom.current.getAttribute('position').needsUpdate = true
    if (mat.current) mat.current.opacity = 0.22 + drive.scan * 0.25
  })
  return (
    <points frustumCulled={false}>
      <bufferGeometry ref={geom}>
        <bufferAttribute attach="attributes-position" args={[pos, 3]} />
      </bufferGeometry>
      <pointsMaterial ref={mat} color="#a1a1aa" size={0.014} sizeAttenuation transparent depthWrite={false} />
    </points>
  )
}
