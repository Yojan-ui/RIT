import { useMemo, useRef } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Bloom, EffectComposer } from '@react-three/postprocessing'
import * as THREE from 'three'
import { hudAnchor, type HudMode } from './anchor'

const R = 1.55

const PALETTE: Record<HudMode, { main: string; accent: string; jitter: number; speed: number }> = {
  idle: { main: '#22e6ff', accent: '#2f7bff', jitter: 0, speed: 0.12 },
  scanning: { main: '#22e6ff', accent: '#7fd7ff', jitter: 0, speed: 0.55 },
  alert: { main: '#ffb020', accent: '#22e6ff', jitter: 0.004, speed: 0.18 },
  critical: { main: '#ffb020', accent: '#ff6a2b', jitter: 0.012, speed: 0.22 },
  upgrading: { main: '#22e6ff', accent: '#34f5c5', jitter: 0, speed: 0.9 },
  secure: { main: '#34f5c5', accent: '#22e6ff', jitter: 0, speed: 0.1 },
}

interface Live {
  main: THREE.Color
  accent: THREE.Color
  jitter: number
  speed: number
}

/** Latitude / longitude line loops, like a holographic navigation globe. */
function useGraticule(radius: number, lats = 11, lons = 18, seg = 96) {
  return useMemo(() => {
    const pts: number[] = []
    for (let i = 1; i < lats; i++) {
      const phi = (i / lats) * Math.PI
      const y = Math.cos(phi) * radius
      const rr = Math.sin(phi) * radius
      for (let s = 0; s < seg; s++) {
        const a0 = (s / seg) * Math.PI * 2
        const a1 = ((s + 1) / seg) * Math.PI * 2
        pts.push(Math.cos(a0) * rr, y, Math.sin(a0) * rr, Math.cos(a1) * rr, y, Math.sin(a1) * rr)
      }
    }
    for (let j = 0; j < lons; j++) {
      const th = (j / lons) * Math.PI * 2
      for (let s = 0; s < seg; s++) {
        const p0 = (s / seg) * Math.PI
        const p1 = ((s + 1) / seg) * Math.PI
        pts.push(
          Math.sin(p0) * Math.cos(th) * radius, Math.cos(p0) * radius, Math.sin(p0) * Math.sin(th) * radius,
          Math.sin(p1) * Math.cos(th) * radius, Math.cos(p1) * radius, Math.sin(p1) * Math.sin(th) * radius,
        )
      }
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
    return g
  }, [radius, lats, lons, seg])
}

const sweepVertex = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`
// Radar sweep on the equatorial plane: a bright leading edge fading behind it, plus range rings.
const sweepFragment = /* glsl */ `
  uniform float uTime; uniform vec3 uColor; uniform float uSpeed;
  varying vec2 vUv;
  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    float r = length(p);
    if (r > 1.0 || r < 0.34) discard;
    float a = atan(p.y, p.x);
    float sweep = mod(uTime * (0.8 + uSpeed * 2.0), 6.2831853);
    float d = mod(sweep - a, 6.2831853);
    float trail = exp(-d * 3.2) * 0.55;
    float rings = smoothstep(0.012, 0.0, abs(fract(r * 6.0) - 0.5) - 0.48) * 0.18;
    float edge = smoothstep(0.02, 0.0, abs(r - 1.0)) * 0.35;
    float alpha = (trail + rings + edge) * smoothstep(1.0, 0.85, r) * 0.45;
    gl_FragColor = vec4(uColor * 1.2, alpha);
  }
`

function Scene({ mode }: { mode: HudMode }) {
  const live = useMemo<Live>(() => ({ main: new THREE.Color(PALETTE.idle.main), accent: new THREE.Color(PALETTE.idle.accent), jitter: 0, speed: 0.12 }), [])
  const root = useRef<THREE.Group>(null)
  const globe = useRef<THREE.Group>(null)
  const rings = useRef<(THREE.Group | null)[]>([])
  const pulse = useRef<THREE.Mesh>(null)
  const mats = useRef<{ grat?: THREE.LineBasicMaterial; inner?: THREE.LineBasicMaterial; core?: THREE.MeshBasicMaterial; dots?: THREE.PointsMaterial; grid?: THREE.LineBasicMaterial; pulse?: THREE.MeshBasicMaterial; ring: (THREE.MeshBasicMaterial | null)[] }>({ ring: [] })
  const graticule = useGraticule(R)
  const inner = useGraticule(R * 0.62, 7, 10, 64)
  const tgt = useMemo(() => ({ main: new THREE.Color(), accent: new THREE.Color() }), [])
  const v = useMemo(() => new THREE.Vector3(), [])
  const edge = useMemo(() => new THREE.Vector3(), [])
  const { camera, size, viewport } = useThree()
  const sweepUniforms = useMemo(() => ({ uTime: { value: 0 }, uColor: { value: new THREE.Color('#22e6ff') }, uSpeed: { value: 0.1 } }), [])

  const dots = useMemo(() => {
    const a = new Float32Array(420 * 3)
    const p = new THREE.Vector3()
    for (let i = 0; i < 420; i++) {
      p.randomDirection().multiplyScalar(R * 1.002)
      a.set([p.x, p.y, p.z], i * 3)
    }
    return a
  }, [])
  const grid = useMemo(() => {
    const pts: number[] = []
    const n = 14
    const s = 7
    for (let i = -n; i <= n; i++) {
      pts.push(-s, 0, (i / n) * s, s, 0, (i / n) * s)
      pts.push((i / n) * s, 0, -s, (i / n) * s, 0, s)
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
    return g
  }, [])

  useFrame(({ clock }, dt) => {
    const t = clock.elapsedTime
    const p = PALETTE[mode]
    const k = 1 - Math.exp(-dt * 2.5)
    live.main.lerp(tgt.main.set(p.main), k)
    live.accent.lerp(tgt.accent.set(p.accent), k)
    live.jitter += (p.jitter - live.jitter) * k
    live.speed += (p.speed - live.speed) * k

    // placement: fit the globe into the free space between the HUD columns (in pixels),
    // or above the panels on narrow screens
    if (root.current) {
      const W = size.width
      const H = size.height
      const wide = W >= 1024
      const left = wide ? Math.min(600, W * 0.42) : 0
      const right = wide ? W - (W >= 1280 ? 300 : 20) : W
      const cx = wide ? (left + right) / 2 : W / 2
      const cy = wide ? H * 0.52 : H * 0.24
      const rpx = wide ? Math.min(right - left, H - 180) * 0.3 : Math.min(W, H * 0.5) * 0.3
      const px = viewport.width / W
      const tx = (cx - W / 2) * px
      const ty = -(cy - H / 2) * px
      const s = (rpx * px) / R
      root.current.position.x += (tx - root.current.position.x) * k
      root.current.position.y += (ty - root.current.position.y) * k
      root.current.scale.setScalar(root.current.scale.x + (s - root.current.scale.x) * k)
      const j = live.jitter
      if (globe.current) globe.current.position.set((Math.random() - 0.5) * j * 20, (Math.random() - 0.5) * j * 20, 0)
    }
    if (globe.current) {
      globe.current.rotation.y += dt * live.speed
      globe.current.rotation.x = 0.35 + Math.sin(t * 0.3) * 0.03
    }
    rings.current.forEach((g, i) => {
      if (g) g.rotation.z += dt * (0.15 + i * 0.07) * (i % 2 ? -1 : 1) * (1 + live.speed * 2)
    })
    if (pulse.current && mats.current.pulse) {
      const ph = (t * 0.45) % 1
      pulse.current.scale.setScalar(1 + ph * 1.4)
      mats.current.pulse.opacity = (1 - ph) * 0.45
      mats.current.pulse.color.copy(live.main)
    }
    const m = mats.current
    m.grat?.color.copy(live.main)
    m.inner?.color.copy(live.main)
    m.core?.color.copy(live.main)
    m.dots?.color.copy(live.main).multiplyScalar(1.2)
    if (m.grid) {
      m.grid.color.copy(live.accent)
      m.grid.opacity = 0.1 + Math.sin(t * 1.4) * 0.04
    }
    m.ring.forEach((mm, i) => mm?.color.copy(i === 1 ? live.accent : live.main))
    sweepUniforms.uTime.value = t
    sweepUniforms.uColor.value.copy(live.main)
    sweepUniforms.uSpeed.value = live.speed

    // publish screen-space centre and radius for the DOM overlays
    if (root.current) {
      root.current.getWorldPosition(v)
      edge.copy(v).add(new THREE.Vector3(R * root.current.scale.x, 0, 0))
      v.project(camera)
      edge.project(camera)
      hudAnchor.x = (v.x * 0.5 + 0.5) * size.width
      hudAnchor.y = (-v.y * 0.5 + 0.5) * size.height
      hudAnchor.r = Math.abs((edge.x - v.x) * 0.5 * size.width)
      hudAnchor.ready = true
    }
  })

  const ringSpecs: { r: number; tilt: [number, number, number]; w: number; arc: number }[] = [
    { r: R * 1.22, tilt: [1.2, 0.2, 0], w: 0.006, arc: Math.PI * 2 },
    { r: R * 1.38, tilt: [1.35, -0.35, 0.2], w: 0.012, arc: Math.PI * 1.4 },
    { r: R * 1.55, tilt: [1.1, 0.5, -0.3], w: 0.004, arc: Math.PI * 2 },
  ]

  return (
    <group ref={root}>
      <group ref={globe}>
        <lineSegments geometry={graticule}>
          <lineBasicMaterial ref={(el) => { mats.current.grat = el ?? undefined }} transparent opacity={0.26} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
        </lineSegments>
        <lineSegments geometry={inner}>
          <lineBasicMaterial ref={(el) => { mats.current.inner = el ?? undefined }} transparent opacity={0.14} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
        </lineSegments>
        <points>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[dots, 3]} />
          </bufferGeometry>
          <pointsMaterial ref={(el) => { mats.current.dots = el ?? undefined }} size={0.022} sizeAttenuation transparent opacity={0.7} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
        </points>
        <mesh>
          <sphereGeometry args={[R * 0.985, 48, 32]} />
          <meshBasicMaterial ref={(el) => { mats.current.core = el ?? undefined }} transparent opacity={0.06} depthWrite={false} side={THREE.BackSide} />
        </mesh>
      </group>

      {/* sonar sweep on the equatorial plane */}
      <mesh rotation={[-Math.PI / 2 + 0.35, 0, 0]}>
        <planeGeometry args={[R * 3.1, R * 3.1]} />
        <shaderMaterial vertexShader={sweepVertex} fragmentShader={sweepFragment} uniforms={sweepUniforms} transparent depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} side={THREE.DoubleSide} />
      </mesh>
      <mesh ref={pulse} rotation={[-Math.PI / 2 + 0.35, 0, 0]}>
        <ringGeometry args={[R * 1.02, R * 1.05, 128]} />
        <meshBasicMaterial ref={(el) => { mats.current.pulse = el ?? undefined }} transparent depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} side={THREE.DoubleSide} />
      </mesh>

      {/* orbit rings */}
      {ringSpecs.map((s, i) => (
        <group key={i} rotation={s.tilt}>
          <group ref={(el) => { rings.current[i] = el }}>
            <mesh>
              <torusGeometry args={[s.r, s.w, 6, 256, s.arc]} />
              <meshBasicMaterial ref={(el) => { mats.current.ring[i] = el }} transparent opacity={0.6} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
            </mesh>
            <mesh position={[s.r, 0, 0]}>
              <octahedronGeometry args={[0.045, 0]} />
              <meshBasicMaterial color={new THREE.Color('#ffffff').multiplyScalar(2)} toneMapped={false} />
            </mesh>
          </group>
        </group>
      ))}

      {/* pulsating cyber grid floor */}
      <lineSegments geometry={grid} position={[0, -R * 1.45, 0]}>
        <lineBasicMaterial ref={(el) => { mats.current.grid = el ?? undefined }} transparent opacity={0.12} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </lineSegments>
    </group>
  )
}

export function HudGlobe({ mode }: { mode: HudMode }) {
  return (
    <Canvas camera={{ position: [0, 0.6, 7.2], fov: 40 }} dpr={[1, 2]} gl={{ antialias: true, alpha: true }}>
      <Scene mode={mode} />
      <EffectComposer multisampling={4}>
        <Bloom mipmapBlur luminanceThreshold={0.28} intensity={0.75} radius={0.6} />
      </EffectComposer>
    </Canvas>
  )
}
