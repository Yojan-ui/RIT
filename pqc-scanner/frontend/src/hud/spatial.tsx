// Spatial UI: glass panels that live in the 3D scene (CSS3DRenderer), visionOS style.
//
// Each <SpatialSlot> leaves a same-sized placeholder in the HUD grid and portals its content into a
// CSS3DObject. The panels hang on a rig that lazily follows the camera, sit in the placeholder's
// screen position at rest, and angle inward like a wraparound display. Moving the cursor tilts the
// rig about the hologram's depth, so the panels shift perspective against the globe behind them.
// Off (narrow screens, AR, no slot), everything renders flat in place as before.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { CSS3DObject, CSS3DRenderer } from 'three/examples/jsm/renderers/CSS3DRenderer.js'

interface Slot {
  target: HTMLDivElement // portal target, owned by a CSS3DObject
  holder: HTMLDivElement | null // placeholder in the HUD grid
  side: -1 | 1 // left or right of the hologram
  obj?: CSS3DObject
}

export const spatial = {
  slots: new Map<string, Slot>(),
  mount: null as HTMLDivElement | null,
  mouse: new THREE.Vector2(), // cursor, -1..1 across the window
}

if (typeof window !== 'undefined') {
  addEventListener('pointermove', (e) => spatial.mouse.set((e.clientX / innerWidth) * 2 - 1, (e.clientY / innerHeight) * 2 - 1), { passive: true })
}

const REDUCED = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches
const YAW = 0.13 // inward angle of the side panels (rad), the "curve" of the wraparound
const DEPTH = 6 // panel depth in front of the camera, world units (the globe sits at ~7.4)
const FIT = 0.92 // the angled outer edge comes nearer and grows; this (and INSET) keeps it inside the column
const INSET = 16 // px the panels sit in from their column, toward the hologram

/** Content that floats in 3D when `on`, and renders inline otherwise. */
export function SpatialSlot({ id, side, on, children }: { id: string; side: -1 | 1; on: boolean; children: ReactNode }) {
  const [target] = useState(() => {
    const d = document.createElement('div')
    d.className = 'spatial-panel'
    return d
  })
  const holder = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    if (!on) return
    const slot: Slot = { target, holder: holder.current, side }
    spatial.slots.set(id, slot)
    const h = holder.current
    // the placeholder keeps the panel's height in the grid; the panel takes the column's width
    const ro = new ResizeObserver(() => {
      if (h) {
        h.style.height = `${target.offsetHeight}px`
        target.style.width = `${h.clientWidth}px`
      }
    })
    ro.observe(target)
    if (h) ro.observe(h)
    return () => {
      ro.disconnect()
      slot.obj?.removeFromParent()
      spatial.slots.delete(id)
    }
  }, [on, id, side, target])

  if (!on) return <>{children}</>
  return (
    <>
      <div ref={holder} aria-hidden className="spatial-holder" />
      {createPortal(children, target)}
    </>
  )
}

/** Canvas child: renders every registered slot with CSS3DRenderer, registered to the WebGL camera. */
export function SpatialLayer({ on }: { on: boolean }) {
  const { camera, size } = useThree()
  const css = useMemo(() => {
    const r = new CSS3DRenderer()
    r.domElement.className = 'spatial-layer'
    return r
  }, [])
  const scene = useMemo(() => new THREE.Scene(), [])
  const rig = useMemo(() => new THREE.Group(), [])
  const pivot = useMemo(() => {
    const p = new THREE.Group()
    p.position.z = -DEPTH
    return p
  }, [])
  const m = useRef({ x: 0, y: 0, ready: false })

  useEffect(() => {
    scene.add(rig)
    rig.add(pivot)
    return () => {
      css.domElement.remove()
      rig.removeFromParent()
    }
  }, [css, scene, rig, pivot])
  useEffect(() => {
    css.setSize(size.width, size.height)
  }, [css, size])
  useEffect(() => {
    css.domElement.style.display = on ? '' : 'none'
  }, [css, on])

  // after the composer (priority 1), so the panels use this frame's camera
  useFrame((_, dtRaw) => {
    if (!on) return
    if (!css.domElement.isConnected) spatial.mount?.appendChild(css.domElement)
    const dt = Math.min(dtRaw, 0.05)
    const cam = camera as THREE.PerspectiveCamera
    const W = size.width
    const H = size.height
    const k = 1 - Math.exp(-dt * 6)

    // cursor parallax, smoothed; reduced motion keeps the panels still
    const s = m.current
    const tx = REDUCED ? 0 : spatial.mouse.x
    const ty = REDUCED ? 0 : spatial.mouse.y
    s.x += (tx - s.x) * k
    s.y += (ty - s.y) * k

    // lazy follow: the rig trails the camera's orientation, so orbiting swings the panels a little
    rig.position.copy(cam.position)
    if (!s.ready || REDUCED) rig.quaternion.copy(cam.quaternion)
    else rig.quaternion.slerp(cam.quaternion, 1 - Math.exp(-dt * 7))
    s.ready = true
    pivot.rotation.set(s.y * 0.025, s.x * 0.04, 0)

    const wpp = (2 * DEPTH * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2))) / H
    for (const slot of spatial.slots.values()) {
      if (!slot.holder) continue
      if (!slot.obj) {
        slot.obj = new CSS3DObject(slot.target)
        pivot.add(slot.obj)
      }
      const r = slot.holder.getBoundingClientRect()
      const o = slot.obj
      o.visible = r.width > 0
      o.position.set((r.left + r.width / 2 - slot.side * INSET - W / 2) * wpp, -(r.top + r.height / 2 - H / 2) * wpp, 0)
      o.scale.setScalar(wpp * FIT)
      o.rotation.set(s.y * 0.03, -slot.side * YAW + s.x * 0.04, 0)
      // specular sheen follows the cursor across the glass
      slot.target.style.setProperty('--gx', `${(50 + s.x * 40 * -slot.side).toFixed(1)}%`)
      slot.target.style.setProperty('--gy', `${(30 + s.y * 30).toFixed(1)}%`)
    }
    css.render(scene, cam)
  }, 2)
  return null
}
