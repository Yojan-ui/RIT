import { useMemo, useRef, type RefObject } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Line, OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import type { Vec3 } from '../api'

/** Bloch (x, y, z) → scene: Bloch z is up, Bloch x points at the viewer, Bloch y to the right. */
const toScene = (b: Vec3) => new THREE.Vector3(b[1], b[2], b[0])

const circle = (plane: 'xz' | 'xy' | 'yz', segments = 96) =>
  Array.from({ length: segments + 1 }, (_, i) => {
    const a = (i / segments) * Math.PI * 2
    const c = Math.cos(a)
    const s = Math.sin(a)
    return plane === 'xz' ? new THREE.Vector3(c, 0, s) : plane === 'xy' ? new THREE.Vector3(c, s, 0) : new THREE.Vector3(0, c, s)
  })

const LABELS: { at: Vec3; text: string; strong?: boolean }[] = [
  { at: [0, 0, 1], text: '|0⟩', strong: true },
  { at: [0, 0, -1], text: '|1⟩', strong: true },
  { at: [1, 0, 0], text: '|+⟩', strong: true },
  { at: [-1, 0, 0], text: '|−⟩', strong: true },
  { at: [0, 1, 0], text: '|+i⟩' },
  { at: [0, -1, 0], text: '|−i⟩' },
]

/**
 * Positions plain DOM labels over the canvas each frame. (drei <Html> would
 * mount a React root per label, which React 19 warns about on unmount.)
 */
function LabelProjector({ refs }: { refs: RefObject<(HTMLSpanElement | null)[]> }) {
  const { camera, size } = useThree()
  const v = useMemo(() => new THREE.Vector3(), [])
  useFrame(() => {
    LABELS.forEach((l, i) => {
      const el = refs.current?.[i]
      if (!el) return
      v.copy(toScene(l.at)).multiplyScalar(1.22).project(camera)
      const x = (v.x * 0.5 + 0.5) * size.width
      const y = (-v.y * 0.5 + 0.5) * size.height
      el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`
    })
  })
  return null
}

function StateArrow({ vector, color }: { vector: Vec3; color: string }) {
  const group = useRef<THREE.Group>(null)
  const target = useMemo(() => new THREE.Quaternion(), [])
  const up = useMemo(() => new THREE.Vector3(0, 1, 0), [])
  const c = useMemo(() => new THREE.Color(color).multiplyScalar(1.4), [color])
  useFrame((_, dt) => {
    if (!group.current) return
    target.setFromUnitVectors(up, toScene(vector).normalize())
    group.current.quaternion.slerp(target, 1 - Math.exp(-dt * 8))
  })
  return (
    <group ref={group}>
      <mesh position={[0, 0.44, 0]}>
        <cylinderGeometry args={[0.018, 0.018, 0.88, 16]} />
        <meshBasicMaterial color={c} toneMapped={false} />
      </mesh>
      <mesh position={[0, 0.93, 0]}>
        <coneGeometry args={[0.06, 0.14, 24]} />
        <meshBasicMaterial color={c} toneMapped={false} />
      </mesh>
      <mesh position={[0, 1, 0]}>
        <sphereGeometry args={[0.07, 20, 16]} />
        <meshBasicMaterial color={c} transparent opacity={0.35} toneMapped={false} />
      </mesh>
    </group>
  )
}

export function BlochSphere({ vector, color }: { vector: Vec3; color: string }) {
  const rings = useMemo(() => ({ eq: circle('xz'), m1: circle('xy'), m2: circle('yz') }), [])
  const labelRefs = useRef<(HTMLSpanElement | null)[]>([])
  return (
    <div className="relative h-full w-full overflow-hidden">
      <Canvas camera={{ position: [2.3, 1.5, 2.9], fov: 36 }} dpr={[1, 2]}>
        <ambientLight intensity={0.6} />
        <directionalLight position={[3, 4, 5]} intensity={0.8} />
        <mesh>
          <sphereGeometry args={[1, 64, 48]} />
          <meshStandardMaterial color="#a1a1aa" transparent opacity={0.06} roughness={0.2} depthWrite={false} />
        </mesh>
        <Line points={rings.eq} color="#71717a" lineWidth={1} transparent opacity={0.7} />
        <Line points={rings.m1} color="#3f3f46" lineWidth={1} transparent opacity={0.8} />
        <Line points={rings.m2} color="#3f3f46" lineWidth={1} transparent opacity={0.8} />
        {([[0, 0, 1], [1, 0, 0], [0, 1, 0]] as Vec3[]).map((a, i) => (
          <Line
            key={i}
            points={[toScene(a.map((v) => -v) as Vec3), toScene(a)]}
            color="#52525b"
            lineWidth={1}
            dashed
            dashSize={0.05}
            gapSize={0.04}
          />
        ))}
        <mesh>
          <sphereGeometry args={[0.03, 12, 12]} />
          <meshBasicMaterial color="#a1a1aa" />
        </mesh>
        <StateArrow vector={vector} color={color} />
        <LabelProjector refs={labelRefs} />
        <OrbitControls enablePan={false} enableZoom={false} autoRotate autoRotateSpeed={0.6} />
      </Canvas>
      {LABELS.map((l, i) => (
        <span
          key={l.text}
          ref={(el) => {
            labelRefs.current[i] = el
          }}
          className={`pointer-events-none absolute top-0 left-0 font-mono text-[11px] whitespace-nowrap ${l.strong ? 'text-zinc-200' : 'text-zinc-500'}`}
          style={{ transform: 'translate(-9999px, 0)' }}
        >
          {l.text}
        </span>
      ))}
    </div>
  )
}
