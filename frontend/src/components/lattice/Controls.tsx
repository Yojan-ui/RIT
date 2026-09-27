import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

const ORIGIN = new THREE.Vector3()
// Where the camera parks relative to a focused node: pushed out past it along
// the core->node axis and raised, so the node fills the frame with its link
// running back to the core behind it.
const FLY_OUT = 2.4
const FLY_UP = 1.1
const FLY_RATE = 3.2 // higher = snappier; exponential, so frame-rate independent

// Half-extents the home view must fit: the orbit plus node labels.
const FIT_HALF_WIDTH = 4.7
const FIT_HALF_HEIGHT = 3.4
const MIN_HOME = 9.5

/** Camera distance that fits the whole lattice in a viewport of this aspect. */
function homeDistance(aspect: number, fovDeg: number): number {
  const vHalf = ((fovDeg * Math.PI) / 180) / 2
  const hHalf = Math.atan(Math.tan(vHalf) * aspect)
  return Math.max(MIN_HOME, FIT_HALF_WIDTH / Math.tan(hHalf), FIT_HALF_HEIGHT / Math.tan(vHalf))
}

/**
 * Damped orbit controls plus a fly-to rig.
 *
 * While `focus` is set, user orbiting is disabled and the camera and target
 * glide toward that node, tracking it as it orbits. When focus clears, they
 * glide back to the home distance and control returns to the user. Zoom is
 * off so the wheel keeps scrolling the page.
 */
export function Controls({
  autoRotate,
  focus,
  positions,
  reducedMotion,
}: {
  autoRotate: boolean
  focus: number | null
  positions: THREE.Vector3[]
  reducedMotion: boolean
}) {
  const camera = useThree((s) => s.camera)
  const gl = useThree((s) => s.gl)
  const size = useThree((s) => s.size)
  const controls = useMemo(() => new OrbitControls(camera, gl.domElement), [camera, gl])
  const fov = camera instanceof THREE.PerspectiveCamera ? camera.fov : 42
  const home = homeDistance(size.width / Math.max(1, size.height), fov)

  const rig = useRef<{ focus: number | null; returning: boolean }>({ focus: null, returning: false })
  const scratch = useMemo(
    () => ({ target: new THREE.Vector3(), cam: new THREE.Vector3(), out: new THREE.Vector3() }),
    [],
  )

  useEffect(() => {
    Object.assign(controls, {
      enableDamping: true,
      dampingFactor: 0.06,
      enablePan: false,
      enableZoom: false,
      rotateSpeed: 0.55,
      autoRotate,
      autoRotateSpeed: 0.35,
      minPolarAngle: 0.35,
      maxPolarAngle: Math.PI - 0.6,
    })
    let idle: number | undefined
    const start = () => {
      window.clearTimeout(idle)
      controls.autoRotate = false
    }
    const end = () => {
      idle = window.setTimeout(() => {
        if (rig.current.focus === null) controls.autoRotate = autoRotate
      }, 2500)
    }
    controls.addEventListener('start', start)
    controls.addEventListener('end', end)
    return () => {
      window.clearTimeout(idle)
      controls.removeEventListener('start', start)
      controls.removeEventListener('end', end)
    }
  }, [controls, autoRotate])

  useEffect(() => () => controls.dispose(), [controls])

  // Re-fit whenever the canvas changes shape (column resize, rotation).
  useEffect(() => {
    if (rig.current.focus !== null) return
    camera.position.setLength(home)
    controls.update()
  }, [camera, controls, home])

  useEffect(() => {
    const wasFocused = rig.current.focus !== null
    rig.current.focus = focus
    if (focus !== null) {
      controls.enabled = false
      controls.autoRotate = false
      rig.current.returning = false
    } else if (wasFocused) {
      rig.current.returning = true
    }
  }, [focus, controls])

  useFrame((_, delta) => {
    const k = reducedMotion ? 1 : 1 - Math.exp(-delta * FLY_RATE)
    const { focus: f, returning } = rig.current
    const node = f !== null ? positions[f] : undefined

    if (node) {
      scratch.out.copy(node).normalize()
      scratch.target.copy(node)
      scratch.cam.copy(node).addScaledVector(scratch.out, FLY_OUT)
      scratch.cam.y += FLY_UP
      controls.target.lerp(scratch.target, k)
      camera.position.lerp(scratch.cam, k)
    } else if (returning) {
      controls.target.lerp(ORIGIN, k)
      const len = camera.position.length()
      camera.position.setLength(len + (home - len) * k)
      if (controls.target.lengthSq() < 1e-4 && Math.abs(len - home) < 0.02) {
        controls.target.copy(ORIGIN)
        rig.current.returning = false
        controls.enabled = true
        controls.autoRotate = autoRotate
      }
    }
    controls.update()
  })

  return null
}
