// Volumetric data flow along the client ↔ server link: small faceted particles stream through a thin
// tube around a CatmullRom path, clustered into packets that pulse in bursts. Colour carries state:
// pale slate over the classical link, icy teal once the post-quantum patch is in, mint once the
// rescan has verified it. Weight carries the threat level: higher NIST levels mean larger lattice keys, so each
// packet fills with more and fatter particles, the stream widens, and it moves slightly slower under the load.
// One InstancedMesh, one draw call.
import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { Story } from './anchor'
import { THREAT_LEVELS } from './necessity'

const PACKETS = 14 // particle clusters in flight
const PER_BASE = 26 // particles per cluster lit by a Level 1 payload
const PER = PER_BASE * 2 // capacity: Level 5 lights every slot
const N = PACKETS * PER

const CLASSICAL = new THREE.Color('#a1a1aa')
const SECURED = new THREE.Color('#e4e4e7')
const VERIFIED = new THREE.Color('#059669')

const vertexShader = /* glsl */ `
  attribute float aEnergy;
  varying float vEnergy;
  varying vec3 vView;
  void main() {
    vEnergy = aEnergy;
    vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
    vView = mv.xyz;
    gl_Position = projectionMatrix * mv;
  }
`

// Flat facet shading from screen-space derivatives: crisp crystalline particles with no normals attribute.
// Energy drives both opacity and HDR gain, so only burst heads cross the bloom threshold.
const fragmentShader = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uGain;
  varying float vEnergy;
  varying vec3 vView;
  void main() {
    vec3 n = normalize(cross(dFdx(vView), dFdy(vView)));
    float facet = 0.45 + 0.55 * abs(n.z);
    float gain = mix(0.6, uGain, vEnergy * vEnergy);
    gl_FragColor = vec4(uColor * facet * gain, vEnergy * uOpacity);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

export function DataFlow({ path, radius, story }: { path: THREE.Curve<THREE.Vector3>; radius: number; story: Story }) {
  const mesh = useRef<THREE.InstancedMesh>(null)
  const curve = useMemo(() => new THREE.CatmullRomCurve3(path.getPoints(12), false, 'centripetal'), [path])
  const energy = useMemo(() => new THREE.InstancedBufferAttribute(new Float32Array(N), 1), [])
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader,
        uniforms: { uColor: { value: CLASSICAL.clone() }, uOpacity: { value: 0 }, uGain: { value: 1.2 } },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    [],
  )
  // per-cluster and per-particle constants
  const sim = useMemo(() => {
    const rnd = (a: number, b: number) => a + Math.random() * (b - a)
    return {
      u: Float32Array.from({ length: PACKETS }, (_, g) => g / PACKETS),
      speed: Float32Array.from({ length: PACKETS }, () => rnd(0.85, 1.15)),
      dir: Int8Array.from({ length: PACKETS }, (_, g) => (g % 3 === 2 ? -1 : 1)), // every third cluster is return traffic
      spread: Float32Array.from({ length: N }, () => rnd(-1, 1)),
      angle: Float32Array.from({ length: N }, () => rnd(0, Math.PI * 2)),
      r: Float32Array.from({ length: N }, () => Math.sqrt(Math.random())),
      size: Float32Array.from({ length: N }, () => rnd(0.6, 1.3)),
      e: new Float32Array(N), // eased energy
      opacity: 0,
      color: new THREE.Color().copy(CLASSICAL),
      w: { ...THREAT_LEVELS.enterprise.flow }, // eased payload weight
    }
  }, [])
  const tmp = useMemo(() => ({ p: new THREE.Vector3(), t: new THREE.Vector3(), n: new THREE.Vector3(), b: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0), o: new THREE.Object3D() }), [])

  useFrame(({ clock }, dtRaw) => {
    const m = mesh.current
    if (!m) return
    const dt = Math.min(dtRaw, 0.05)
    const t = clock.elapsedTime
    const { active, scanning, patched, stage, rescan, necessity } = story

    // fade in with the link; colour eases to the link's security state
    sim.opacity += ((active ? 1 : 0) - sim.opacity) * (1 - Math.exp(-dt * 4))
    material.uniforms.uOpacity.value = sim.opacity
    m.visible = sim.opacity > 0.01
    if (!m.visible) return
    const target = stage === 5 && rescan === 'done' ? VERIFIED : patched ? SECURED : CLASSICAL
    sim.color.lerp(target, 1 - Math.exp(-dt * 3))
    material.uniforms.uColor.value.copy(sim.color)
    material.uniforms.uGain.value = patched ? 2.8 : 1.3 // only secured traffic blooms
    // payload weight eases to the chosen level so switching never pops
    const goalW = THREAT_LEVELS[necessity].flow
    const kw = 1 - Math.exp(-dt * 2.5)
    sim.w.density += (goalW.density - sim.w.density) * kw
    sim.w.thickness += (goalW.thickness - sim.w.thickness) * kw
    sim.w.speed += (goalW.speed - sim.w.speed) * kw
    const w = sim.w

    // Burst transmission: a slow carrier with sharp crests. Crests speed every cluster up, stretch it
    // along the path and fill it with more particles; between crests the link idles at a trickle.
    const crest = Math.pow(0.5 + 0.5 * Math.sin(t * 1.25), 6)
    const pace = (scanning ? 0.2 : 0.11) * (1 + 2.4 * crest) * w.speed
    const density = 0.3 + 0.7 * crest

    for (let g = 0; g < PACKETS; g++) {
      sim.u[g] = (sim.u[g] + dt * pace * sim.speed[g] + 1) % 1
      // each cluster also has its own burst phase, so the link never pulses in lockstep
      const own = Math.pow(Math.max(0, Math.sin(t * 0.9 + g * 1.7)), 3)
      const lit = Math.min(1, density * (0.55 + 0.45 * own) * 1.25)
      const len = 0.022 * (1 + 1.5 * crest) * (0.75 + 0.25 * w.density) // heavier packets stretch longer
      const count = PER_BASE * w.density
      for (let j = 0; j < PER; j++) {
        const i = g * PER + j
        let u = sim.u[g] + sim.spread[i] * len
        u = ((u % 1) + 1) % 1
        if (sim.dir[g] < 0) u = 1 - u
        // density: the first `lit` fraction of a cluster's particles are on; fade near both endpoints
        const on = j < lit * count ? 1 : 0
        const ends = smooth(0, 0.06, u) * smooth(0, 0.06, 1 - u)
        const head = 1 - Math.abs(sim.spread[i]) // brightest at the cluster centre
        const goal = on * ends * (0.35 + 0.65 * head)
        sim.e[i] += (goal - sim.e[i]) * (1 - Math.exp(-dt * 10))
        energy.setX(i, sim.e[i])

        // position: on the curve, offset inside the tube on a slow helix (volume, not a line)
        curve.getPointAt(u, tmp.p)
        curve.getTangentAt(u, tmp.t)
        tmp.n.crossVectors(tmp.t, tmp.up).normalize()
        tmp.b.crossVectors(tmp.t, tmp.n)
        const a = sim.angle[i] + u * 9 + t * 0.6 * sim.dir[g]
        const rr = radius * sim.r[i] * w.thickness
        tmp.o.position.copy(tmp.p).addScaledVector(tmp.n, Math.cos(a) * rr).addScaledVector(tmp.b, Math.sin(a) * rr)
        tmp.o.rotation.set(t * 2 + i, t * 1.3 + j, 0)
        tmp.o.scale.setScalar(sim.size[i] * (0.35 + 0.65 * sim.e[i]) * (0.5 + 0.5 * w.thickness)) // heavier levels: fatter particles too
        tmp.o.updateMatrix()
        m.setMatrixAt(i, tmp.o.matrix)
      }
    }
    m.instanceMatrix.needsUpdate = true
    energy.needsUpdate = true
  })

  return (
    <instancedMesh ref={mesh} args={[undefined, material, N]} frustumCulled={false} visible={false}>
      <octahedronGeometry args={[radius * 0.32, 0]}>
        <primitive object={energy} attach="attributes-aEnergy" />
      </octahedronGeometry>
    </instancedMesh>
  )
}
