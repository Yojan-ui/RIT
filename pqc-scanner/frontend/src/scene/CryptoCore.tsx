import { useEffect, useMemo, useRef, type ReactNode } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Bloom, EffectComposer, Vignette } from '@react-three/postprocessing'
import * as THREE from 'three'

/** What the core is expressing. Each state is a set of targets the scene eases toward. */
export type CoreState = 'idle' | 'scanning' | 'vulnerable' | 'critical' | 'upgrading' | 'secured'

interface Targets {
  color: string // main glow
  accent: string // rim / secondary
  instability: number // 0 calm … 1 violent surface noise + jitter
  order: number // 0 chaotic swarm … 1 structured orbital rings
  pulse: number // throb rate (Hz-ish)
  spin: number
}

const STATES: Record<CoreState, Targets> = {
  idle: { color: '#38bdf8', accent: '#a78bfa', instability: 0.18, order: 0.55, pulse: 0.6, spin: 0.12 },
  scanning: { color: '#60a5fa', accent: '#c4b5fd', instability: 0.4, order: 0.25, pulse: 2.2, spin: 0.5 },
  vulnerable: { color: '#f59e0b', accent: '#f97316', instability: 0.6, order: 0.12, pulse: 1.6, spin: 0.22 },
  critical: { color: '#ef4444', accent: '#f97316', instability: 1, order: 0, pulse: 2.6, spin: 0.3 },
  upgrading: { color: '#22d3ee', accent: '#10b981', instability: 0.35, order: 0.6, pulse: 3, spin: 0.9 },
  secured: { color: '#10b981', accent: '#22d3ee', instability: 0.04, order: 1, pulse: 0.5, spin: 0.14 },
}

interface Live {
  color: THREE.Color
  accent: THREE.Color
  instability: number
  order: number
  pulse: number
  spin: number
  shockAt: number
}

// ── GLSL helpers: Ashima 3D simplex noise ────────────────────────────────────
const NOISE = /* glsl */ `
vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1.0/6.0,1.0/3.0); const vec4 D=vec4(0.0,0.5,1.0,2.0);
  vec3 i=floor(v+dot(v,C.yyy)); vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz); vec3 l=1.0-g; vec3 i1=min(g.xyz,l.zxy); vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx; vec3 x2=x0-i2+C.yyy; vec3 x3=x0-D.yyy;
  i=mod289(i);
  vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
  float n_=0.142857142857; vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.0*floor(p*ns.z*ns.z); vec4 x_=floor(j*ns.z); vec4 y_=floor(j-7.0*x_);
  vec4 x=x_*ns.x+ns.yyyy; vec4 y=y_*ns.x+ns.yyyy; vec4 h=1.0-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy); vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.0+1.0; vec4 s1=floor(b1)*2.0+1.0; vec4 sh=-step(h,vec4(0.0));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy; vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x); vec3 p1=vec3(a0.zw,h.y); vec3 p2=vec3(a1.xy,h.z); vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x; p1*=norm.y; p2*=norm.z; p3*=norm.w;
  vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0); m=m*m;
  return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}`

const coreVertex = /* glsl */ `
uniform float uTime; uniform float uInstability; uniform float uPulse;
varying vec3 vNormal; varying vec3 vView; varying float vNoise;
${NOISE}
void main(){
  float t = uTime;
  float n = snoise(position * (1.4 + uInstability * 1.8) + vec3(0.0, t * (0.25 + uInstability), 0.0));
  float spikes = snoise(position * 5.0 + t * 1.3) * uInstability;
  float throb = sin(t * uPulse * 6.2831) * (0.015 + 0.05 * uInstability);
  float d = n * (0.06 + 0.28 * uInstability) + spikes * 0.12 + throb;
  vec3 p = position * (1.0 + d);
  vNoise = n;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vNormal = normalize(normalMatrix * normal);
  vView = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`

const coreFragment = /* glsl */ `
uniform vec3 uColor; uniform vec3 uAccent; uniform float uInstability; uniform float uTime;
varying vec3 vNormal; varying vec3 vView; varying float vNoise;
void main(){
  float fres = pow(1.0 - max(dot(vNormal, vView), 0.0), 2.2);
  float veins = smoothstep(0.35, 0.95, abs(vNoise)) * (0.4 + uInstability);
  float flicker = 1.0 - uInstability * 0.25 * step(0.92, fract(sin(floor(uTime * 18.0)) * 43758.5453));
  vec3 inner = uColor * 0.25;
  vec3 col = inner + uColor * veins * 1.4 + mix(uColor, uAccent, 0.5) * fres * 2.4;
  gl_FragColor = vec4(col * flicker, 1.0);
}`

const particleVertex = /* glsl */ `
attribute vec3 aDir; attribute float aRadius; attribute float aSeed; attribute float aRing; attribute float aAngle;
uniform float uTime; uniform float uOrder; uniform float uInstability; uniform float uPixelRatio;
varying float vAlpha;
mat3 rotX(float a){float c=cos(a),s=sin(a);return mat3(1,0,0,0,c,s,0,-s,c);}
mat3 rotZ(float a){float c=cos(a),s=sin(a);return mat3(c,s,0,-s,c,0,0,0,1);}
void main(){
  float t = uTime;
  // chaotic swarm: breathing shell with erratic jitter
  float wob = sin(t * (1.0 + aSeed * 3.0) + aSeed * 40.0);
  vec3 jitter = vec3(sin(t * 7.1 + aSeed * 91.0), sin(t * 6.3 + aSeed * 57.0), sin(t * 8.7 + aSeed * 13.0)) * 0.22 * uInstability;
  vec3 chaos = aDir * (aRadius + wob * (0.1 + 0.35 * uInstability)) + jitter;
  // ordered: five tilted orbital rings
  float ringR = 1.85 + aRing * 0.28;
  float a = aAngle + t * (0.18 + 0.05 * aRing) * (mod(aRing, 2.0) < 1.0 ? 1.0 : -1.0);
  vec3 ring = rotZ(aRing * 0.63) * rotX(1.1 + aRing * 0.32) * vec3(cos(a) * ringR, 0.0, sin(a) * ringR);
  vec3 p = mix(chaos, ring, smoothstep(0.0, 1.0, uOrder));
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = (1.2 + 1.6 * fract(aSeed * 7.0)) * uPixelRatio * (6.0 / -mv.z);
  vAlpha = 0.35 + 0.65 * fract(aSeed * 13.0);
}`

const particleFragment = /* glsl */ `
uniform vec3 uColor; varying float vAlpha;
void main(){
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.0, d) * vAlpha;
  gl_FragColor = vec4(uColor * 1.6 * a, a);
}`

const PARTICLES = 2000

/** `side`: which half of a wide screen the core occupies ('left' leaves the right half for UI). */
export function CryptoCore({ state, shockKey = 0, side = 'right' }: { state: CoreState; shockKey?: number; side?: 'left' | 'right' }) {
  const live = useMemo<Live>(() => {
    const s = STATES.idle
    return { color: new THREE.Color(s.color), accent: new THREE.Color(s.accent), instability: s.instability, order: s.order, pulse: s.pulse, spin: s.spin, shockAt: -10 }
  }, [])
  return (
    <Canvas camera={{ position: [0, 0, 7.5], fov: 42 }} dpr={[1, 2]} gl={{ antialias: true, powerPreference: 'high-performance' }}>
      <color attach="background" args={['#020306']} />
      <Driver live={live} state={state} shockKey={shockKey} />
      <Stars />
      <Placement side={side}>
        <Core live={live} />
        <Shell live={live} />
        <Lattice live={live} />
        <Particles live={live} />
        <Shockwave live={live} />
      </Placement>
      <EffectComposer multisampling={4}>
        <Bloom mipmapBlur luminanceThreshold={0.18} luminanceSmoothing={0.3} intensity={1.35} radius={0.8} />
        <Vignette eskil={false} offset={0.25} darkness={0.85} />
      </EffectComposer>
    </Canvas>
  )
}

function Driver({ live, state, shockKey }: { live: Live; state: CoreState; shockKey: number }) {
  const target = useMemo(() => ({ color: new THREE.Color(), accent: new THREE.Color() }), [])
  const prev = useRef(state)
  const shock = useRef(false)
  useEffect(() => {
    if (shockKey > 0) shock.current = true
  }, [shockKey])
  useFrame(({ clock }, dt) => {
    const s = STATES[state]
    if (prev.current !== state && (state === 'secured' || state === 'critical' || state === 'vulnerable')) shock.current = true
    prev.current = state
    if (shock.current) live.shockAt = clock.elapsedTime
    shock.current = false
    const k = 1 - Math.exp(-dt * (state === 'upgrading' ? 1.6 : 2.4))
    target.color.set(s.color)
    target.accent.set(s.accent)
    live.color.lerp(target.color, k)
    live.accent.lerp(target.accent, k)
    live.instability += (s.instability - live.instability) * k
    live.order += (s.order - live.order) * k
    live.pulse += (s.pulse - live.pulse) * k
    live.spin += (s.spin - live.spin) * k
  })
  return null
}

/** Keep the core clear of the UI: in one half on wide screens, above the content on narrow ones. */
function Placement({ children, side }: { children: ReactNode; side: 'left' | 'right' }) {
  const group = useRef<THREE.Group>(null)
  const { viewport } = useThree()
  useFrame((_, dt) => {
    if (!group.current) return
    const wide = viewport.aspect > 1.15
    const tx = !wide ? 0 : side === 'right' ? Math.min(2.6, viewport.width * 0.22) : -viewport.width * 0.25
    const ty = !wide ? viewport.height * 0.2 : side === 'left' ? viewport.height * 0.12 : 0
    const s = !wide ? Math.min(1, viewport.width / 6.2) : side === 'left' ? Math.min(0.85, viewport.width / 16) : 1
    group.current.position.x = THREE.MathUtils.damp(group.current.position.x, tx, 4, dt)
    group.current.position.y = THREE.MathUtils.damp(group.current.position.y, ty, 4, dt)
    group.current.scale.setScalar(THREE.MathUtils.damp(group.current.scale.x, s, 4, dt))
  })
  return <group ref={group}>{children}</group>
}

function Core({ live }: { live: Live }) {
  const mesh = useRef<THREE.Mesh>(null)
  const uniforms = useMemo(
    () => ({ uTime: { value: 0 }, uInstability: { value: 0 }, uPulse: { value: 1 }, uColor: { value: new THREE.Color() }, uAccent: { value: new THREE.Color() } }),
    [],
  )
  useFrame(({ clock }, dt) => {
    uniforms.uTime.value = clock.elapsedTime
    uniforms.uInstability.value = live.instability
    uniforms.uPulse.value = live.pulse
    uniforms.uColor.value.copy(live.color)
    uniforms.uAccent.value.copy(live.accent)
    if (mesh.current) {
      mesh.current.rotation.y += dt * live.spin
      mesh.current.rotation.x += dt * live.spin * 0.3
    }
  })
  return (
    <mesh ref={mesh}>
      <sphereGeometry args={[1, 160, 160]} />
      <shaderMaterial vertexShader={coreVertex} fragmentShader={coreFragment} uniforms={uniforms} toneMapped={false} />
    </mesh>
  )
}

function Shell({ live }: { live: Live }) {
  const group = useRef<THREE.Group>(null)
  const mat = useRef<THREE.LineBasicMaterial>(null)
  const edges = useMemo(() => new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(1.45, 2)), [])
  useFrame(({ clock }, dt) => {
    if (group.current) {
      group.current.rotation.y -= dt * (0.08 + live.spin * 0.4)
      group.current.rotation.z += dt * 0.03
      const shake = live.instability * 0.04
      group.current.position.set((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake, 0)
      group.current.scale.setScalar(1 + Math.sin(clock.elapsedTime * live.pulse * 6.28) * 0.012 * (0.3 + live.instability))
    }
    if (mat.current) {
      mat.current.color.copy(live.accent).multiplyScalar(1.1)
      mat.current.opacity = 0.18 + live.order * 0.14
    }
  })
  return (
    <group ref={group}>
      <lineSegments geometry={edges}>
        <lineBasicMaterial ref={mat} transparent depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </lineSegments>
    </group>
  )
}

/** Structured rings that only appear as the system becomes ordered (secured). */
function Lattice({ live }: { live: Live }) {
  const group = useRef<THREE.Group>(null)
  const mats = useRef<(THREE.MeshBasicMaterial | null)[]>([])
  useFrame((_, dt) => {
    if (group.current) group.current.rotation.y += dt * 0.1
    mats.current.forEach((m) => {
      if (!m) return
      m.color.copy(live.color).multiplyScalar(1.6)
      m.opacity = Math.max(0, live.order - 0.55) * 1.4
    })
  })
  const rings: [number, number, number][] = [
    [Math.PI / 2, 0, 0],
    [0, 0, 0],
    [Math.PI / 2, 0, Math.PI / 2],
  ]
  return (
    <group rotation={[0.42, 0, 0.18]}>
    <group ref={group}>
      {rings.map((rot, i) => (
        <mesh key={i} rotation={rot}>
          <torusGeometry args={[1.62, 0.006, 8, 220]} />
          <meshBasicMaterial ref={(el) => { mats.current[i] = el }} transparent opacity={0} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
        </mesh>
      ))}
    </group>
    </group>
  )
}

function Particles({ live }: { live: Live }) {
  const { gl } = useThree()
  const { geometry, uniforms } = useMemo(() => {
    const g = new THREE.BufferGeometry()
    const dir = new Float32Array(PARTICLES * 3)
    const radius = new Float32Array(PARTICLES)
    const seed = new Float32Array(PARTICLES)
    const ring = new Float32Array(PARTICLES)
    const angle = new Float32Array(PARTICLES)
    const v = new THREE.Vector3()
    for (let i = 0; i < PARTICLES; i++) {
      v.randomDirection()
      dir.set([v.x, v.y, v.z], i * 3)
      radius[i] = 1.6 + Math.random() * 1.8
      seed[i] = Math.random()
      ring[i] = Math.floor(Math.random() * 5)
      angle[i] = Math.random() * Math.PI * 2
    }
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(PARTICLES * 3), 3))
    g.setAttribute('aDir', new THREE.BufferAttribute(dir, 3))
    g.setAttribute('aRadius', new THREE.BufferAttribute(radius, 1))
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1))
    g.setAttribute('aRing', new THREE.BufferAttribute(ring, 1))
    g.setAttribute('aAngle', new THREE.BufferAttribute(angle, 1))
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 6)
    return {
      geometry: g,
      uniforms: { uTime: { value: 0 }, uOrder: { value: 0 }, uInstability: { value: 0 }, uColor: { value: new THREE.Color() }, uPixelRatio: { value: 1 } },
    }
  }, [])
  useFrame(({ clock }) => {
    uniforms.uTime.value = clock.elapsedTime
    uniforms.uOrder.value = live.order
    uniforms.uInstability.value = live.instability
    uniforms.uColor.value.copy(live.accent).lerp(live.color, 0.5)
    uniforms.uPixelRatio.value = gl.getPixelRatio()
  })
  return (
    <points geometry={geometry}>
      <shaderMaterial vertexShader={particleVertex} fragmentShader={particleFragment} uniforms={uniforms} transparent depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
    </points>
  )
}

/** Expanding ring whenever the verdict changes. */
function Shockwave({ live }: { live: Live }) {
  const mesh = useRef<THREE.Mesh>(null)
  const mat = useRef<THREE.MeshBasicMaterial>(null)
  useFrame(({ clock, camera }) => {
    const d = clock.elapsedTime - live.shockAt
    const on = d >= 0 && d < 1.3
    if (!mesh.current || !mat.current) return
    mesh.current.visible = on
    if (!on) return
    mesh.current.quaternion.copy(camera.quaternion)
    mesh.current.scale.setScalar(1.2 + d * 3)
    mat.current.color.copy(live.color).multiplyScalar(2)
    mat.current.opacity = (1 - d / 1.3) ** 2
  })
  return (
    <mesh ref={mesh} visible={false}>
      <ringGeometry args={[1, 1.025, 128]} />
      <meshBasicMaterial ref={mat} transparent depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} side={THREE.DoubleSide} />
    </mesh>
  )
}

/** Static, faint star field for depth. */
function Stars() {
  const positions = useMemo(() => {
    const a = new Float32Array(900 * 3)
    for (let i = 0; i < 900; i++) {
      const v = new THREE.Vector3().randomDirection().multiplyScalar(18 + Math.random() * 20)
      a.set([v.x, v.y, v.z], i * 3)
    }
    return a
  }, [])
  const ref = useRef<THREE.Points>(null)
  useFrame((_, dt) => {
    if (ref.current) ref.current.rotation.y += dt * 0.005
  })
  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial color="#64748b" size={0.05} sizeAttenuation transparent opacity={0.5} depthWrite={false} />
    </points>
  )
}
