import { useMemo, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { Color, type Group } from 'three'
import type { AttackPath, Grade } from '@/api/types'
import { EXPOSURE_TONE, GRADE_TONE, HEX } from '@/lib/tone'

const RADIUS = 2.1
const IDLE = '#2a323d'

function usePrefersReducedMotion() {
  return useMemo(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches, [])
}

function Field({ paths, grade, spin }: { paths: AttackPath[] | null; grade: Grade | null; spin: boolean }) {
  const group = useRef<Group>(null)
  useFrame((_, delta) => {
    if (spin && group.current) group.current.rotation.y += delta * 0.18
  })

  const core = grade ? HEX[GRADE_TONE[grade]] : IDLE
  // Seven vectors, evenly spaced on a tilted ring around the posture core.
  const nodes = useMemo(() => Array.from({ length: 7 }, (_, i) => {
    const a = (i / 7) * Math.PI * 2
    const path = paths?.[i]
    return {
      key: path?.id ?? String(i),
      position: [Math.cos(a) * RADIUS, Math.sin(a * 2) * 0.35, Math.sin(a) * RADIUS] as [number, number, number],
      color: path ? HEX[EXPOSURE_TONE[path.exposure]] : IDLE,
      open: path?.exposure === 'exposed',
    }
  }), [paths])

  // All seven spokes in one draw call: a segment from the core to each node, coloured per vertex.
  const spokes = useMemo(() => {
    const positions = new Float32Array(nodes.length * 6)
    const colors = new Float32Array(nodes.length * 6)
    nodes.forEach((n, i) => {
      positions.set([0, 0, 0, ...n.position], i * 6)
      const c = new Color(n.color).multiplyScalar(n.open ? 1 : 0.45)
      colors.set([c.r, c.g, c.b, c.r, c.g, c.b], i * 6)
    })
    return { positions, colors }
  }, [nodes])

  return (
    <group ref={group} rotation={[0.35, 0, 0]}>
      <lineSegments>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[spokes.positions, 3]} />
          <bufferAttribute attach="attributes-color" args={[spokes.colors, 3]} />
        </bufferGeometry>
        <lineBasicMaterial vertexColors />
      </lineSegments>
      <mesh>
        <icosahedronGeometry args={[0.72, 1]} />
        <meshBasicMaterial color={core} wireframe transparent opacity={0.85} />
      </mesh>
      {nodes.map((n) => (
        <mesh key={n.key} position={n.position}>
          <octahedronGeometry args={[n.open ? 0.13 : 0.09, 0]} />
          <meshBasicMaterial color={n.color} />
        </mesh>
      ))}
    </group>
  )
}

/** The seven attack vectors orbiting the domain's posture core, coloured by exposure. */
export default function PostureField({ paths, grade }: { paths: AttackPath[] | null; grade: Grade | null }) {
  const reduced = usePrefersReducedMotion()
  return (
    <Canvas
      // flat: no tone mapping, so the theme's hex values render exactly (no washed-out phosphor).
      flat
      dpr={[1, 2]}
      camera={{ position: [0, 1.8, 6.6], fov: 42 }}
      frameloop={reduced ? 'demand' : 'always'}
      gl={{ antialias: true, alpha: true }}
      aria-label={grade ? `Posture view: grade ${grade}` : 'Posture view: no scan yet'}
    >
      <Field paths={paths} grade={grade} spin={!reduced} />
    </Canvas>
  )
}
