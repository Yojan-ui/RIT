import { useEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { GlitchPass } from 'three/examples/jsm/postprocessing/GlitchPass.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { hudAnchor, nodeAngles, type HoloNode, type HudMode, type Story } from './anchor'
import { StoryLayer, fade } from './Story'
import { CommandDeck, DataStreams, DustMotes, LatticeCore } from './Core'
import { SpatialLayer, spatial } from './spatial'
import { XR_SCALE, setXR, useXR, xrState } from './xr'

const R = 1.5
const CARBON = '#080a0f'
const STEEL = new THREE.Color('#577c95')
const TITANIUM = new THREE.Color('#4b5563')
const ICE = new THREE.Color('#67e8f9')
const OK_CYAN = new THREE.Color('#06b6d4')
const NODE_COLOR = { warn: new THREE.Color('#f97316'), crit: new THREE.Color('#ef4444'), ok: new THREE.Color('#10b981') }

const SPEED: Record<HudMode, number> = { idle: 0.05, scanning: 0.22, alert: 0.06, critical: 0.06, upgrading: 0.3, secure: 0.04 }
const SCAN_RATE: Record<HudMode, number> = { idle: 0.25, scanning: 0.9, alert: 0.35, critical: 0.35, upgrading: 1.1, secure: 0.2 }

const toVec = (az: number, el: number, r: number) => {
  const a = THREE.MathUtils.degToRad(az)
  const e = THREE.MathUtils.degToRad(el)
  return new THREE.Vector3(Math.cos(e) * Math.cos(a) * r, Math.sin(e) * r, Math.cos(e) * Math.sin(a) * r)
}

function circle(radius: number, from = 0, to = Math.PI * 2, seg = 256) {
  const pts: THREE.Vector3[] = []
  for (let i = 0; i <= seg; i++) {
    const a = from + ((to - from) * i) / seg
    pts.push(new THREE.Vector3(Math.cos(a) * radius, 0, Math.sin(a) * radius))
  }
  return pts
}

function segments(pairs: number[]) {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pairs, 3))
  return g
}

/** Latitude / longitude lines. */
function useGraticule() {
  return useMemo(() => {
    const p: number[] = []
    const seg = 128
    for (let lat = -75; lat <= 75; lat += 15) {
      const y = Math.sin(THREE.MathUtils.degToRad(lat)) * R
      const rr = Math.cos(THREE.MathUtils.degToRad(lat)) * R
      for (let s = 0; s < seg; s++) {
        const a0 = (s / seg) * Math.PI * 2
        const a1 = ((s + 1) / seg) * Math.PI * 2
        p.push(Math.cos(a0) * rr, y, Math.sin(a0) * rr, Math.cos(a1) * rr, y, Math.sin(a1) * rr)
      }
    }
    for (let lon = 0; lon < 360; lon += 15) {
      for (let s = 0; s < seg; s++) {
        const a = toVec(lon, -90 + (180 * s) / seg, R)
        const b = toVec(lon, -90 + (180 * (s + 1)) / seg, R)
        p.push(a.x, a.y, a.z, b.x, b.y, b.z)
      }
    }
    return segments(p)
  }, [])
}

/** Evenly spread point cloud (Fibonacci sphere). */
function usePointCloud(n = 2800) {
  return useMemo(() => {
    const a = new Float32Array(n * 3)
    const golden = Math.PI * (3 - Math.sqrt(5))
    for (let i = 0; i < n; i++) {
      const y = 1 - (i / (n - 1)) * 2
      const r = Math.sqrt(1 - y * y)
      const t = golden * i
      a.set([Math.cos(t) * r * R, y * R, Math.sin(t) * r * R], i * 3)
    }
    return a
  }, [n])
}

/** Orbit ring: dashed track with a gauge gap, fine ticks and a moving marker. */
function OrbitRing({ radius, tilt, speed, color, opacity, markerSpeed }: { radius: number; tilt: [number, number, number]; speed: number; color: THREE.Color; opacity: number; markerSpeed: number }) {
  const spin = useRef<THREE.Group>(null)
  const marker = useRef<THREE.Mesh>(null)
  const line = useMemo(() => {
    const g = new THREE.BufferGeometry().setFromPoints(circle(radius, 0.35, Math.PI * 2 - 0.1))
    const l = new THREE.Line(g, new THREE.LineDashedMaterial({ color, dashSize: 0.06, gapSize: 0.035, transparent: true, opacity, depthWrite: false }))
    l.computeLineDistances()
    return l
  }, [radius, color, opacity])
  const ticks = useMemo(() => {
    const p: number[] = []
    for (let d = 0; d < 360; d += 5) {
      const a = THREE.MathUtils.degToRad(d)
      const len = d % 30 === 0 ? 0.09 : 0.04
      p.push(Math.cos(a) * radius, 0, Math.sin(a) * radius, Math.cos(a) * (radius + len), 0, Math.sin(a) * (radius + len))
    }
    return segments(p)
  }, [radius])
  useFrame(({ clock }, dt) => {
    if (spin.current) spin.current.rotation.y += dt * speed
    if (marker.current) {
      const a = clock.elapsedTime * markerSpeed
      marker.current.position.set(Math.cos(a) * radius, 0, Math.sin(a) * radius)
      marker.current.rotation.y = -a
    }
  })
  return (
    <group rotation={tilt}>
      <group ref={spin}>
        <primitive object={line} />
        <lineSegments geometry={ticks}>
          <lineBasicMaterial color={color} transparent opacity={opacity * 0.9} depthWrite={false} />
        </lineSegments>
      </group>
      <mesh ref={marker}>
        <coneGeometry args={[0.025, 0.07, 3]} />
        <meshBasicMaterial color="#ffffff" />
      </mesh>
    </group>
  )
}

function Scene({ mode, nodes, story, xr }: { mode: HudMode; nodes: HoloNode[]; story: Story; xr: boolean }) {
  const root = useRef<THREE.Group>(null)
  const globe = useRef<THREE.Group>(null)
  const scan = useRef<THREE.Group>(null)
  const scanRing = useRef<THREE.LineLoop>(null)
  const scanDisc = useRef<THREE.MeshBasicMaterial>(null)
  const eqMat = useRef<THREE.LineBasicMaterial>(null)
  const nodeMat = useRef<THREE.PointsMaterial>(null)
  const orbits = useRef<THREE.Group>(null)
  const graticule = useGraticule()
  const cloud = usePointCloud()
  const phase = useRef(0)
  const rot = useRef(0)
  const { camera, size } = useThree()
  const hoverLight = useRef<THREE.PointLight>(null)
  const tmp = useMemo(() => ({ v: new THREE.Vector3(), n: new THREE.Vector3(), c: new THREE.Vector3(), q: new THREE.Vector3(), e: new THREE.Vector3() }), [])
  const unitCircle = useMemo(() => new THREE.BufferGeometry().setFromPoints(circle(1, 0, Math.PI * 2, 192)), [])
  const equator = useMemo(() => new THREE.BufferGeometry().setFromPoints(circle(R * 1.001, 0, Math.PI * 2, 256)), [])

  // floor + back-wall Cartesian grids (minor 0.25, major 1.0)
  const floor = useMemo(() => {
    const minor: number[] = []
    const major: number[] = []
    const s = 16 // a vast deck: the grid runs out into the fog
    for (let i = -64; i <= 64; i++) {
      const v = i * 0.25
      const tgt = i % 4 === 0 ? major : minor
      tgt.push(-s, 0, v, s, 0, v, v, 0, -s, v, 0, s)
    }
    return { minor: segments(minor), major: segments(major) }
  }, [])
  const wall = useMemo(() => {
    const p: number[] = []
    for (let i = -12; i <= 12; i++) {
      const v = i * 0.5
      p.push(-16, v + 0.5, 0, 16, v + 0.5, 0, v, -2.5, 0, v, 6.5, 0)
    }
    return segments(p)
  }, [])

  const nodeData = useMemo(() => nodes.map((n) => ({ ...n, ...nodeAngles(n.id) })), [nodes])
  const stems = useMemo(() => {
    const p: number[] = []
    nodeData.forEach((n) => {
      const a = toVec(n.az, n.el, R)
      const b = toVec(n.az, n.el, R * 1.14)
      p.push(a.x, a.y, a.z, b.x, b.y, b.z)
    })
    return segments(p)
  }, [nodeData])
  const nodePoints = useMemo(() => {
    const pos = new Float32Array(nodeData.length * 3)
    const col = new Float32Array(nodeData.length * 3)
    nodeData.forEach((n, i) => {
      const v = toVec(n.az, n.el, R * 1.005)
      pos.set([v.x, v.y, v.z], i * 3)
      const c = NODE_COLOR[n.state]
      col.set([c.r, c.g, c.b], i * 3)
    })
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    g.setAttribute('color', new THREE.BufferAttribute(col, 3))
    return g
  }, [nodeData])

  useFrame(({ clock }, dt) => {
    const W = size.width
    const H = size.height
    // AR: the hologram stands where the viewer tapped, at tabletop scale, facing them
    if (root.current && xrState.presenting) {
      const r0 = root.current
      r0.visible = xrState.placed
      r0.position.copy(xrState.position).add(tmp.e.set(0, 1.5 * R * XR_SCALE, 0))
      r0.quaternion.copy(xrState.quaternion)
      r0.scale.setScalar(XR_SCALE)
    } else if (root.current) {
      root.current.visible = true
      root.current.quaternion.identity()
    }
    // fit the hologram into the free core zone between the floating panes (pixels → world)
    if (root.current && !xrState.presenting) {
      const z = hudAnchor.zoneEl?.getBoundingClientRect()
      const cx = z ? z.left + z.width / 2 : W / 2
      // sits a little high in the zone: the vault and link hang below the globe, the caption sits under them
      const cy = z ? z.top + z.height * (story.active ? 0.42 : 0.5) : H / 2
      const k0 = story.active ? 0.17 : 0.28
      const rpx = (z ? Math.min(z.width, z.height) : Math.min(W, H)) * k0
      // world units per pixel at the base camera distance (fixed, so camera moves don't refit the scene)
      const px = (2 * Math.tan(THREE.MathUtils.degToRad(19)) * Math.hypot(0.9, 7.4)) / H
      const k = 1 - Math.exp(-dt * 4)
      root.current.position.x += ((cx - W / 2) * px - root.current.position.x) * k
      root.current.position.y += (-(cy - H / 2) * px - root.current.position.y) * k
      const s = (rpx * px) / R
      root.current.scale.setScalar(root.current.scale.x + (s - root.current.scale.x) * k)
    }
    rot.current += dt * SPEED[mode]
    if (globe.current) globe.current.rotation.y = rot.current
    hudAnchor.rotationDeg = ((THREE.MathUtils.radToDeg(rot.current) % 360) + 360) % 360

    // vertical sweep of the horizontal scan plane
    phase.current += dt * SCAN_RATE[mode]
    const y = Math.sin(phase.current) * R * 0.98
    const rr = Math.sqrt(Math.max(0, R * R - y * y))
    if (scan.current) scan.current.position.y = y
    if (scanRing.current) scanRing.current.scale.setScalar(Math.max(0.001, rr * 1.002))
    const accent = mode === 'secure' ? OK_CYAN : ICE
    scanDisc.current?.color.copy(accent)
    eqMat.current?.color.copy(accent)
    ;(scanRing.current?.material as THREE.LineBasicMaterial | undefined)?.color.copy(accent)
    // the radar sweep replaces the scan plane on the Rescan stage; orbits step back while the story runs
    fade(scan.current, story.active && !story.scanning && story.stage >= 4 ? 0 : 1, dt)
    fade(orbits.current, story.active ? 0.35 : 1, dt, 3)
    if (nodeMat.current) {
      const pulse = story.stage === 5 && story.rescan === 'done'
      nodeMat.current.size = pulse ? 5 + 3 * (0.5 + 0.5 * Math.sin(clock.elapsedTime * 3.9)) : 5
    }

    if (hoverLight.current) {
      const l = hoverLight.current
      l.position.lerp(spatial.hoverPoint, 1 - Math.exp(-dt * 10))
      l.intensity += (spatial.hoverAmt * 3.5 - l.intensity) * (1 - Math.exp(-dt * 6))
    }

    // publish screen-space anchor + node positions for the DOM overlays (not drawn in AR)
    if (root.current && globe.current && !xrState.presenting) {
      root.current.updateMatrixWorld()
      root.current.getWorldPosition(tmp.c)
      const scale = root.current.scale.x
      tmp.v.copy(tmp.c).project(camera)
      tmp.q.copy(tmp.c).add(tmp.e.set(R * scale, 0, 0)).project(camera)
      hudAnchor.x = (tmp.v.x * 0.5 + 0.5) * W
      hudAnchor.y = (-tmp.v.y * 0.5 + 0.5) * H
      hudAnchor.r = Math.abs((tmp.q.x - tmp.v.x) * 0.5 * W)
      hudAnchor.ready = true
      const camDir = tmp.n.copy(camera.position).sub(tmp.c).normalize()
      hudAnchor.nodes = nodeData.map((n) => {
        const world = toVec(n.az, n.el, R * 1.14).applyMatrix4(globe.current!.matrixWorld)
        const normal = world.clone().sub(tmp.c).normalize()
        const p = world.project(camera)
        return { id: n.id, x: (p.x * 0.5 + 0.5) * W, y: (-p.y * 0.5 + 0.5) * H, visible: normal.dot(camDir) > 0.05, az: (n.az + hudAnchor.rotationDeg) % 360, el: n.el }
      })
    }
  })

  return (
    <>
      {/* AR shows the camera feed behind the hologram: no backdrop, fog or room grids */}
      {!xr && <color attach="background" args={[CARBON]} />}
      {!xr && <fog attach="fog" args={[CARBON, 6.2, 10.5]} />}
      <Environment />
      <ambientLight intensity={0.18} />
      <hemisphereLight args={['#9fb4c7', '#080a0f', 0.35]} />
      <directionalLight position={[3, 5, 4]} intensity={1.4} color="#dbe7f2" />
      <directionalLight position={[-4, 1.5, -3]} intensity={0.5} color="#577c95" />
      <group ref={root}>
        <group ref={globe} rotation={[0.28, 0, 0]}>
          <points>
            <bufferGeometry>
              <bufferAttribute attach="attributes-position" args={[cloud, 3]} />
            </bufferGeometry>
            <pointsMaterial color={STEEL.clone().lerp(ICE, 0.35)} size={1.35} sizeAttenuation={false} transparent opacity={0.55} depthWrite={false} />
          </points>
          <lineSegments geometry={graticule}>
            <lineBasicMaterial color={STEEL} transparent opacity={0.14} depthWrite={false} />
          </lineSegments>
          <lineLoop geometry={equator}>
            <lineBasicMaterial ref={eqMat} color={ICE} transparent opacity={0.4} depthWrite={false} />
          </lineLoop>
          {nodeData.length > 0 && (
            <>
              <lineSegments geometry={stems}>
                <lineBasicMaterial color="#ffffff" transparent opacity={0.55} depthWrite={false} />
              </lineSegments>
              <points geometry={nodePoints}>
                <pointsMaterial ref={nodeMat} size={5} sizeAttenuation={false} vertexColors depthWrite={false} />
              </points>
            </>
          )}
        </group>

        {/* horizontal scan plane travelling vertically */}
        <group ref={scan}>
          <mesh rotation={[-Math.PI / 2, 0, 0]}>
            <circleGeometry args={[R * 1.6, 96]} />
            <meshBasicMaterial ref={scanDisc} color={ICE} transparent opacity={0.035} depthWrite={false} side={THREE.DoubleSide} />
          </mesh>
          <lineLoop ref={scanRing} geometry={unitCircle}>
            <lineBasicMaterial color={ICE} transparent opacity={0.85} depthWrite={false} />
          </lineLoop>
          <lineLoop geometry={unitCircle} scale={R * 1.6}>
            <lineBasicMaterial color={ICE} transparent opacity={0.12} depthWrite={false} />
          </lineLoop>
        </group>

        <group ref={orbits}>
        <OrbitRing radius={R * 1.24} tilt={[1.25, 0.1, 0.05]} speed={0.12} color={STEEL} opacity={0.6} markerSpeed={0.5} />
        <OrbitRing radius={R * 1.4} tilt={[1.05, -0.4, 0.25]} speed={-0.08} color={TITANIUM} opacity={0.7} markerSpeed={-0.35} />
        <OrbitRing radius={R * 1.56} tilt={[1.45, 0.55, -0.2]} speed={0.05} color={ICE} opacity={0.22} markerSpeed={0.22} />
        </group>

        <StoryLayer story={story} />
        <LatticeCore story={story} />
        <DustMotes />
        {!xr && <CommandDeck floorY={-R * 2.35} />}

        <group visible={!xr}>
          <lineSegments geometry={floor.minor} position={[0, -R * 2.35, 0]}>
            <lineBasicMaterial color={TITANIUM} transparent opacity={0.1} depthWrite={false} />
          </lineSegments>
          <lineSegments geometry={floor.major} position={[0, -R * 2.35, 0]}>
            <lineBasicMaterial color={STEEL} transparent opacity={0.18} depthWrite={false} />
          </lineSegments>
          <lineSegments geometry={wall} position={[0, -R * 2.35, -R * 2.4]}>
            <lineBasicMaterial color={TITANIUM} transparent opacity={0.07} depthWrite={false} />
          </lineSegments>
        </group>
      </group>
      {/* a pane under the cursor casts cyan light into the room */}
      <pointLight ref={hoverLight} color={ICE} intensity={0} distance={7} decay={1.6} />
      <DataStreams core={root} />
    </>
  )
}

/**
 * HDR post-processing: scene → UnrealBloomPass → OutputPass (tone mapping + sRGB).
 * Only HDR-bright materials (lattice, shields, packets, siphon, locked block) exceed the threshold and bleed light.
 * Rendered at ≤1.5× DPR into a 4× MSAA half-float target so 1-px lines stay crisp; bloom runs at half resolution.
 */
function Effects({ glitch }: { glitch: boolean }) {
  const { gl, scene, camera, size } = useThree()
  const fx = useMemo(() => {
    const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 })
    const composer = new EffectComposer(gl, rt)
    composer.addPass(new RenderPass(scene, camera))
    const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.6, 0.42, 0.8)
    composer.addPass(bloom)
    // digital tearing while the post-quantum patch deploys, and never otherwise
    const glitchPass = new GlitchPass()
    glitchPass.enabled = false
    composer.addPass(glitchPass)
    composer.addPass(new OutputPass())
    return { composer, bloom, glitchPass }
  }, [gl, scene, camera])
  useEffect(() => {
    fx.glitchPass.enabled = glitch
    fx.glitchPass.curF = 0 // start the deploy on a hard tear
  }, [fx, glitch])
  useEffect(() => {
    fx.composer.setPixelRatio(Math.min(gl.getPixelRatio(), 1.5))
    fx.composer.setSize(size.width, size.height)
    fx.bloom.resolution.set(size.width / 2, size.height / 2)
  }, [fx, gl, size])
  useEffect(() => () => fx.composer.dispose(), [fx])
  // priority 1: R3F hands rendering over to the composer. An XR session renders straight into the
  // headset / phone framebuffer (the composer can't target it); HDR colours are still tone-mapped there.
  useFrame((_, dt) => {
    gl.info.reset() // count every pass of the frame, not just the last one
    // GlitchPass alone tears once every 2-4 s, longer than the deploy: burst it for the whole deployment
    if (fx.glitchPass.enabled) fx.glitchPass.goWild = Math.random() < 0.28
    if (gl.xr.isPresenting) gl.render(scene, camera)
    else fx.composer.render(dt)
  }, 1)
  useEffect(() => {
    gl.info.autoReset = false
    return () => {
      gl.info.autoReset = true
    }
  }, [gl])
  return null
}

/** Image-based lighting for the PBR node bodies: a neutral studio room, pre-filtered once. */
function Environment() {
  const { gl, scene } = useThree()
  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl)
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    scene.environment = env
    scene.environmentIntensity = 0.55
    return () => {
      scene.environment = null
      env.dispose()
      pmrem.dispose()
    }
  }, [gl, scene])
  return null
}

/**
 * AR placement: a hit-test reticle tracks real surfaces; a tap (XR "select") stands the hologram there,
 * turned to face the viewer. Tapping again moves it.
 */
function XRPlacement() {
  const { gl, camera } = useThree()
  const reticle = useRef<THREE.Group>(null)
  const source = useRef<XRHitTestSource | null>(null)
  useEffect(() => {
    const select = () => {
      const r = reticle.current
      if (!xrState.hasHit || !r) return
      const p = xrState.position.setFromMatrixPosition(r.matrix)
      xrState.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(camera.position.x - p.x, camera.position.z - p.z))
      setXR({ placed: true })
    }
    const start = async () => {
      const session = gl.xr.getSession()
      if (!session) return
      session.addEventListener('select', select)
      try {
        const viewer = await session.requestReferenceSpace('viewer')
        source.current = (await session.requestHitTestSource?.({ space: viewer })) ?? null
      } catch {
        source.current = null
      }
    }
    const end = () => {
      source.current?.cancel()
      source.current = null
    }
    gl.xr.addEventListener('sessionstart', start)
    gl.xr.addEventListener('sessionend', end)
    return () => {
      gl.xr.removeEventListener('sessionstart', start)
      gl.xr.removeEventListener('sessionend', end)
    }
  }, [gl, camera])
  const ring = useMemo(() => new THREE.RingGeometry(0.06, 0.075, 48).rotateX(-Math.PI / 2), [])
  const dot = useMemo(() => new THREE.CircleGeometry(0.008, 16).rotateX(-Math.PI / 2), [])
  useFrame(({ clock }, _dt, frame?: XRFrame) => {
    const r = reticle.current
    if (!r) return
    const space = gl.xr.getReferenceSpace()
    const pose = frame && source.current && space ? frame.getHitTestResults(source.current)[0]?.getPose(space) : undefined
    if (pose) r.matrix.fromArray(pose.transform.matrix)
    r.visible = !!pose && !xrState.placed
    r.children[0].scale.setScalar(1 + 0.08 * Math.sin(clock.elapsedTime * 4))
    setXR({ hasHit: !!pose })
  })
  return (
    <group ref={reticle} matrixAutoUpdate={false} visible={false}>
      <mesh geometry={ring}>
        <meshBasicMaterial color={ICE} transparent opacity={0.9} toneMapped={false} />
      </mesh>
      <mesh geometry={dot}>
        <meshBasicMaterial color="#ffffff" toneMapped={false} />
      </mesh>
    </group>
  )
}

export function HudGlobe({ mode, nodes, story, spatialOn }: { mode: HudMode; nodes: HoloNode[]; story: Story; spatialOn: boolean }) {
  const { presenting } = useXR()
  return (
    <Canvas
      camera={{ position: [0, 0.9, 7.4], fov: 38 }}
      dpr={[1, 2]}
      gl={{ antialias: false, powerPreference: 'high-performance' }}
      onCreated={({ gl }) => {
        xrState.gl = gl
      }}
    >
      <Effects glitch={story.patching} />
      <Scene mode={mode} nodes={nodes} story={story} xr={presenting} />
      <XRPlacement />
      <SpatialLayer on={spatialOn && !presenting} />
    </Canvas>
  )
}
