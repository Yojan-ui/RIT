// Immersive spatial UI: the HUD panes are CSS3DRenderer objects floating in the 3D scene.
//
// Each <SpatialSlot> leaves a placeholder in the page grid and portals its content into a CSS3DObject
// on a rig that lazily follows the camera. At rest a pane sits over its placeholder, angled toward the
// hologram (side panes yaw inward, the bottom console pitches back). Hover is a real raycast against
// each pane's plane: the hit pane eases (GSAP) into a small tilt toward the cursor and a slight scale-up,
// its glass sheen and cyan edge follow the hit point, and a light in the WebGL scene moves to it.
// Panes flagged `stream` publish an emitter point on their inner edge for the data streams into the core.
// Off (narrow screens, AR), everything renders flat in place.
import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import gsap from 'gsap'
import { CSS3DObject, CSS3DRenderer } from 'three/examples/jsm/renderers/CSS3DRenderer.js'

interface Slot {
  target: HTMLDivElement // portal target, owned by a CSS3DObject
  holder: HTMLDivElement | null // placeholder in the page grid
  side: -1 | 0 | 1 // left column, bottom console, right column
  fill: boolean // the pane takes the placeholder's height (its content scrolls) instead of setting it
  stream: boolean
  obj?: CSS3DObject
  hover: number // 0..1, eased by GSAP
  hit: THREE.Vector2 // raycast hit in pane pixels, centred
}

export const spatial = {
  slots: new Map<string, Slot>(),
  mount: null as HTMLDivElement | null,
  on: false,
  ndc: new THREE.Vector2(-9, -9), // cursor in normalised device coordinates
  mouse: new THREE.Vector2(), // cursor, -1..1 across the window (y down), for parallax
  hovered: null as string | null,
  hoverAmt: 0,
  hoverPoint: new THREE.Vector3(), // world-space raycast hit on the hovered pane
  emitters: new Map<string, THREE.Vector3>(), // world-space stream origins on the panes' inner edges
  pulse: {} as Record<string, number>, // recent activity per pane, speeds its stream
  bump(id: string, k = 1) {
    this.pulse[id] = Math.min(3, (this.pulse[id] ?? 0) + k)
  },
}

if (typeof window !== 'undefined') {
  addEventListener(
    'pointermove',
    (e) => {
      spatial.mouse.set((e.clientX / innerWidth) * 2 - 1, (e.clientY / innerHeight) * 2 - 1)
      spatial.ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1)
    },
    { passive: true },
  )
  document.documentElement.addEventListener('pointerleave', () => spatial.ndc.set(-9, -9))
}

const REDUCED = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches
const YAW = 0.12 // inward angle of the side panes (rad)
const PITCH = 0.1 // backward lean of the bottom console (rad)
const DEPTH = 6 // pane depth in front of the camera, world units (the core sits at ~7.4)
const FIT = 0.93 // angled edges come nearer and grow; this and INSET keep panes inside their cells
const INSET = 14 // px the panes sit in from their cell, toward the hologram
const HOVER_SCALE = 0.025
const HOVER_TILT = 0.055 // rad at the pane's edge (~3°), small enough to keep text crisp

/** Content that floats in 3D when `on`, and renders inline otherwise. */
export function SpatialSlot({ id, side, on, fill = false, stream = false, className = '', children }: { id: string; side: -1 | 0 | 1; on: boolean; fill?: boolean; stream?: boolean; className?: string; children: ReactNode }) {
  const [target] = useState(() => {
    const d = document.createElement('div')
    d.className = 'spatial-panel'
    return d
  })
  const holder = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    if (!on) return
    target.classList.toggle('fill', fill)
    const slot: Slot = { target, holder: holder.current, side, fill, stream, hover: 0, hit: new THREE.Vector2() }
    spatial.slots.set(id, slot)
    const h = holder.current
    const ro = new ResizeObserver(() => {
      if (!h) return
      target.style.width = `${h.clientWidth}px`
      if (fill) target.style.height = `${h.clientHeight}px`
      else h.style.height = `${target.offsetHeight}px`
    })
    ro.observe(target)
    if (h) ro.observe(h)
    return () => {
      ro.disconnect()
      gsap.killTweensOf(slot)
      slot.obj?.removeFromParent()
      spatial.slots.delete(id)
      spatial.emitters.delete(id)
    }
  }, [on, id, side, fill, stream, target])

  if (!on) return <div className={className}>{children}</div>
  return (
    <>
      <div ref={holder} aria-hidden className={`spatial-holder ${className}`} />
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
  const tmp = useMemo(() => ({ ray: new THREE.Raycaster(), plane: new THREE.Plane(), n: new THREE.Vector3(), p: new THREE.Vector3(), hit: new THREE.Vector3(), inv: new THREE.Matrix4(), q: new THREE.Quaternion() }), [])
  const m = useRef({ x: 0, y: 0, ready: false })

  useLayoutEffect(() => {
    scene.add(rig)
    rig.add(pivot)
    return () => {
      css.domElement.remove()
      rig.removeFromParent()
    }
  }, [css, scene, rig, pivot])
  useLayoutEffect(() => {
    css.setSize(size.width, size.height)
  }, [css, size])
  useLayoutEffect(() => {
    spatial.on = on
    css.domElement.style.display = on ? '' : 'none'
    if (!on) {
      spatial.hovered = null
      spatial.hoverAmt = 0
    }
  }, [css, on])

  // after the composer (priority 1), so the panes use this frame's camera
  useFrame((_, dtRaw) => {
    if (!on) return
    if (!css.domElement.isConnected) spatial.mount?.appendChild(css.domElement)
    const dt = Math.min(dtRaw, 0.05)
    const cam = camera as THREE.PerspectiveCamera
    const W = size.width
    const H = size.height
    const k = 1 - Math.exp(-dt * 6)

    // cursor parallax, smoothed; reduced motion keeps the panes still
    const s = m.current
    s.x += ((REDUCED ? 0 : spatial.mouse.x) - s.x) * k
    s.y += ((REDUCED ? 0 : spatial.mouse.y) - s.y) * k

    // lazy follow: the rig trails the camera's orientation, so swoops and orbits swing the panes a little
    rig.position.copy(cam.position)
    if (!s.ready || REDUCED) rig.quaternion.copy(cam.quaternion)
    else rig.quaternion.slerp(cam.quaternion, 1 - Math.exp(-dt * 6))
    s.ready = true
    pivot.rotation.set(s.y * 0.02, s.x * 0.035, 0)

    // lay the panes over their placeholders
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
      const dx = -slot.side * INSET
      const dy = slot.side === 0 ? -INSET * 0.6 : 0
      o.position.set((r.left + r.width / 2 + dx - W / 2) * wpp, -(r.top + r.height / 2 + dy - H / 2) * wpp, 0)
      o.scale.setScalar(wpp * FIT * (1 + HOVER_SCALE * slot.hover))
      // rest pose, plus a tilt toward the raycast hit while hovered (top/bottom edges lean by HOVER_TILT)
      const w2 = Math.max(1, slot.target.offsetWidth / 2)
      const h2 = Math.max(1, slot.target.offsetHeight / 2)
      o.rotation.set((slot.side === 0 ? -PITCH : 0) - (slot.hit.y / h2) * HOVER_TILT * slot.hover, -slot.side * YAW + (slot.hit.x / w2) * HOVER_TILT * slot.hover, 0)
    }
    rig.updateMatrixWorld(true)

    // raycast the cursor against every pane's plane; the nearest hit inside a pane's bounds wins
    tmp.ray.setFromCamera(spatial.ndc, cam)
    let best: string | null = null
    let bestD = Infinity
    for (const [id, slot] of spatial.slots) {
      const o = slot.obj
      if (!o || !o.visible) continue
      o.getWorldQuaternion(tmp.q)
      tmp.n.set(0, 0, 1).applyQuaternion(tmp.q)
      o.getWorldPosition(tmp.p)
      tmp.plane.setFromNormalAndCoplanarPoint(tmp.n, tmp.p)
      if (!tmp.ray.ray.intersectPlane(tmp.plane, tmp.hit)) continue
      const local = tmp.hit.clone().applyMatrix4(tmp.inv.copy(o.matrixWorld).invert()) // pane pixels, centred, y up
      const w2 = slot.target.offsetWidth / 2
      const h2 = slot.target.offsetHeight / 2
      const d = tmp.ray.ray.origin.distanceTo(tmp.hit)
      if (Math.abs(local.x) <= w2 && Math.abs(local.y) <= h2 && d < bestD) {
        bestD = d
        best = id
        slot.hit.set(local.x, local.y)
        spatial.hoverPoint.copy(tmp.hit)
        slot.target.style.setProperty('--gx', `${(50 + (local.x / w2) * 50).toFixed(1)}%`)
        slot.target.style.setProperty('--gy', `${(50 - (local.y / h2) * 50).toFixed(1)}%`)
      }
    }
    if (best !== spatial.hovered) {
      spatial.hovered = best
      for (const [id, slot] of spatial.slots) gsap.to(slot, { hover: id === best ? 1 : 0, duration: id === best ? 0.45 : 0.6, ease: 'power3.out', overwrite: true })
    }
    let amt = 0
    for (const [id, slot] of spatial.slots) {
      amt = Math.max(amt, slot.hover)
      slot.target.style.setProperty('--hover', slot.hover.toFixed(3))
      // stream emitter: the middle of the pane's edge that faces the hologram
      if (slot.stream && slot.obj) {
        const e = spatial.emitters.get(id) ?? new THREE.Vector3()
        const w2 = slot.target.offsetWidth / 2
        spatial.emitters.set(id, e.set(slot.side < 0 ? w2 : -w2, 0, 0).applyMatrix4(slot.obj.matrixWorld))
      }
    }
    spatial.hoverAmt = amt
    css.render(scene, cam)
  }, 2)
  return null
}
