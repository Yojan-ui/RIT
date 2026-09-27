import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { Canvas, useFrame, type ThreeEvent } from '@react-three/fiber'
import {
  Color,
  Vector3,
  type BufferGeometry,
  type Group,
  type LineBasicMaterial,
  type Mesh,
  type MeshBasicMaterial,
} from 'three'
import type { AttackPath, Exposure, Grade } from '@/api/types'
import { EXPOSURE_TONE, GRADE_TONE, HEX } from '@/lib/tone'

/*
 * The posture view: the domain's grade as a wireframe core, and its seven attack paths as
 * vectors on a tilted ring. Everything that moves is driven from useFrame through refs, so
 * animation never re-renders React.
 *
 * Motion carries meaning: open vectors pulse and stream packets into the core; partly open
 * vectors stream packets that die halfway; defended vectors are still. With reduced motion
 * the same states show through colour and size alone, and the scene renders only on change.
 */

const RADIUS = 2.1
const IDLE = '#2a323d'
const SCANNING = '#5d6776'
const PACKETS = 3
const EASE = 6 // per second: how quickly colours and sizes settle after a change

export type PostureFieldProps = {
  paths: AttackPath[] | null
  grade: Grade | null
  /** Changes whenever a new result arrives; replays the deploy animation. */
  resultKey: string | null
  scanning: boolean
  hovered: string | null
  onHover: (id: string | null) => void
  onSelect: (id: string) => void
}

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReduced(mq.matches)
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])
  return reduced
}

const easeOutCubic = (x: number) => 1 - Math.pow(1 - Math.min(Math.max(x, 0), 1), 3)

/** Evenly spaced directions on a tilted ring (unit length; scaled by the deploy progress). */
const DIRECTIONS = Array.from({ length: 7 }, (_, i) => {
  const a = (i / 7) * Math.PI * 2
  return new Vector3(Math.cos(a), Math.sin(a * 2) * 0.17, Math.sin(a))
})

type NodeSpec = { id: string; exposure: Exposure | null; color: string }

type VectorProps = {
  spec: NodeSpec
  index: number
  deploy: RefObject<number>
  reduced: boolean
  scanning: boolean
  hovered: boolean
  onHover: (id: string | null) => void
  onSelect: (id: string) => void
}

function Vector({ spec, index, deploy, reduced, scanning, hovered, onHover, onSelect }: VectorProps) {
  const direction = DIRECTIONS[index] as Vector3
  const node = useRef<Mesh>(null)
  const nodeMat = useRef<MeshBasicMaterial>(null)
  const spokeGeo = useRef<BufferGeometry>(null)
  const spokeMat = useRef<LineBasicMaterial>(null)
  const halo = useRef<Mesh>(null)
  const haloMat = useRef<MeshBasicMaterial>(null)
  const hit = useRef<Mesh>(null)
  const packets = useRef<(Mesh | null)[]>([])
  const target = useMemo(() => new Color(scanning ? SCANNING : spec.color), [scanning, spec.color])
  const tip = useMemo(() => new Vector3(), [])
  const open = spec.exposure === 'exposed' && !scanning
  const partial = spec.exposure === 'partial' && !scanning
  const phase = index * 0.9

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime
    const k = reduced ? 1 : 1 - Math.exp(-EASE * delta)
    tip.copy(direction).multiplyScalar(RADIUS * (reduced ? 1 : easeOutCubic(deploy.current)))

    // Node: position, colour and size ease toward their targets.
    if (node.current && nodeMat.current) {
      node.current.position.copy(tip)
      nodeMat.current.color.lerp(target, k)
      const pulse = open && !reduced ? 1 + 0.22 * Math.sin(t * 4 + phase) : 1
      const scanPulse = scanning && !reduced ? 0.8 + 0.2 * Math.sin(t * 6 + phase) : 1
      const size = (open ? 0.13 : 0.09) * pulse * scanPulse * (hovered ? 1.7 : 1)
      node.current.scale.setScalar(node.current.scale.x + (size - node.current.scale.x) * k)
    }
    hit.current?.position.copy(tip)

    // Spoke: follows the node out, brightens when hovered.
    const pos = spokeGeo.current?.attributes.position
    if (pos && spokeMat.current) {
      pos.setXYZ(1, tip.x, tip.y, tip.z)
      pos.needsUpdate = true
      spokeMat.current.color.lerp(target, k)
      const opacity = hovered ? 1 : open ? 0.8 : partial ? 0.55 : 0.3
      spokeMat.current.opacity += (opacity - spokeMat.current.opacity) * k
    }

    // Halo: an expanding, fading shell around open vectors.
    if (halo.current && haloMat.current) {
      const show = open && !reduced
      halo.current.visible = show
      if (show) {
        const cycle = (((t * 0.8 + phase) % 1) + 1) % 1
        halo.current.position.copy(tip)
        halo.current.scale.setScalar(0.12 + cycle * 0.24)
        haloMat.current.opacity = 0.3 * (1 - cycle)
      }
    }

    // Packets: open vectors deliver them into the core; partly open ones die halfway.
    const flowing = (open || partial) && !reduced
    packets.current.forEach((p, i) => {
      if (!p) return
      p.visible = flowing
      if (!flowing) return
      const f = (((t * 0.55 + i / PACKETS + phase) % 1) + 1) % 1
      p.position.copy(tip).multiplyScalar(1 - (partial ? f * 0.5 : f))
      ;(p.material as MeshBasicMaterial).opacity = partial ? 0.9 * (1 - f) : 0.95
    })
  })

  const hover = (e: ThreeEvent<PointerEvent>, on: boolean) => {
    e.stopPropagation()
    document.body.style.cursor = on ? 'pointer' : ''
    onHover(on ? spec.id : null)
  }
  const interactive = spec.exposure !== null && !scanning

  return (
    <group>
      <lineSegments>
        <bufferGeometry ref={spokeGeo}>
          <bufferAttribute attach="attributes-position" args={[new Float32Array(6), 3]} />
        </bufferGeometry>
        <lineBasicMaterial ref={spokeMat} color={IDLE} transparent opacity={0.3} />
      </lineSegments>
      <mesh ref={node} scale={0.09}>
        <octahedronGeometry args={[1, 0]} />
        <meshBasicMaterial ref={nodeMat} color={IDLE} />
      </mesh>
      <mesh ref={halo} visible={false}>
        <sphereGeometry args={[1, 8, 6]} />
        <meshBasicMaterial ref={haloMat} color={HEX.vulnerable} wireframe transparent opacity={0} depthWrite={false} />
      </mesh>
      {Array.from({ length: PACKETS }, (_, i) => (
        <mesh
          key={i}
          ref={(m) => {
            packets.current[i] = m
          }}
          visible={false}
        >
          <boxGeometry args={[0.045, 0.045, 0.045]} />
          <meshBasicMaterial color={spec.color} transparent depthWrite={false} />
        </mesh>
      ))}
      {/* Generous invisible hit target that follows the node, so vectors are easy to point at. */}
      {interactive && (
        <mesh
          ref={hit}
          onPointerOver={(e) => hover(e, true)}
          onPointerOut={(e) => hover(e, false)}
          onClick={(e) => {
            e.stopPropagation()
            onSelect(spec.id)
          }}
        >
          <sphereGeometry args={[0.32, 8, 8]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      )}
    </group>
  )
}

function Field({ paths, grade, resultKey, scanning, hovered, onHover, onSelect, reduced }: PostureFieldProps & { reduced: boolean }) {
  const ring = useRef<Group>(null)
  const core = useRef<Mesh>(null)
  const coreMat = useRef<MeshBasicMaterial>(null)
  const deploy = useRef(1)
  const coreTarget = useMemo(() => new Color(scanning ? SCANNING : grade ? HEX[GRADE_TONE[grade]] : IDLE), [grade, scanning])

  // A new result re-deploys the vectors outward from the core.
  useEffect(() => {
    if (resultKey) deploy.current = 0
  }, [resultKey])

  useFrame((_, delta) => {
    deploy.current = Math.min(1, deploy.current + delta / 0.9)
    coreMat.current?.color.lerp(coreTarget, reduced ? 1 : 1 - Math.exp(-EASE * delta))
    if (reduced) return
    // Spin up while scanning, drift at rest, and hold still while the user points at a vector.
    const speed = scanning ? 1.4 : hovered ? 0 : 0.16
    if (ring.current) ring.current.rotation.y += delta * speed
    if (core.current) core.current.rotation.y -= delta * (scanning ? 1.1 : 0.08)
  })

  const specs: NodeSpec[] = DIRECTIONS.map((_, i) => {
    const p = paths?.[i]
    return p
      ? { id: p.id, exposure: p.exposure, color: HEX[EXPOSURE_TONE[p.exposure]] }
      : { id: `idle-${i}`, exposure: null, color: IDLE }
  })

  return (
    <group ref={ring} rotation={[0.35, 0, 0]}>
      <mesh ref={core}>
        <icosahedronGeometry args={[0.72, 1]} />
        <meshBasicMaterial ref={coreMat} color={IDLE} wireframe transparent opacity={0.85} />
      </mesh>
      {specs.map((spec, i) => (
        <Vector
          key={i}
          spec={spec}
          index={i}
          deploy={deploy}
          reduced={reduced}
          scanning={scanning}
          hovered={hovered === spec.id}
          onHover={onHover}
          onSelect={onSelect}
        />
      ))}
    </group>
  )
}

export default function PostureField(props: PostureFieldProps) {
  const reduced = usePrefersReducedMotion()
  return (
    <Canvas
      // flat: no tone mapping, so the theme's hex values render exactly (no washed-out phosphor).
      flat
      dpr={[1, 2]}
      camera={{ position: [0, 1.8, 6.6], fov: 42 }}
      // Reduced motion: render only when something changes.
      frameloop={reduced ? 'demand' : 'always'}
      gl={{ antialias: true, alpha: true }}
      aria-label={props.grade ? `Posture view: grade ${props.grade}` : 'Posture view: no scan yet'}
      onPointerLeave={() => {
        document.body.style.cursor = ''
        props.onHover(null)
      }}
      onPointerMissed={() => props.onHover(null)}
    >
      <Field {...props} reduced={reduced} />
    </Canvas>
  )
}
