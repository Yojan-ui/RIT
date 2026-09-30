// WebXR "tabletop hologram": an immersive-ar session with hit-testing places the whole hologram
// (globe, lattice shield, Merkle ledger) on a real surface. Outside a session nothing here runs,
// so the browser view is untouched.
import { useSyncExternalStore } from 'react'
import * as THREE from 'three'

/** Hologram scale in AR: one world unit = 7.5 cm, so the globe is ~22 cm across. */
export const XR_SCALE = 0.075

type Listener = () => void
const listeners = new Set<Listener>()
const emit = () => listeners.forEach((l) => l())

export const xrState = {
  gl: null as THREE.WebGLRenderer | null,
  presenting: false,
  placed: false,
  hasHit: false, // the reticle is on a surface
  position: new THREE.Vector3(),
  quaternion: new THREE.Quaternion(),
}

export function subscribeXR(l: Listener) {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

/** Re-render on session start / end and on placement. */
export function useXR() {
  const presenting = useSyncExternalStore(subscribeXR, () => xrState.presenting)
  const placed = useSyncExternalStore(subscribeXR, () => xrState.placed)
  const hasHit = useSyncExternalStore(subscribeXR, () => xrState.hasHit)
  return { presenting, placed, hasHit }
}

export function setXR(patch: Partial<Pick<typeof xrState, 'presenting' | 'placed' | 'hasHit'>>) {
  let changed = false
  for (const k in patch) {
    const key = k as keyof typeof patch
    if (xrState[key] !== patch[key]) {
      xrState[key] = patch[key]!
      changed = true
    }
  }
  if (changed) emit()
}

/** Whether this device can run an immersive AR session (Android Chrome + ARCore today; not iOS Safari). */
export async function arSupported() {
  try {
    return !!(await navigator.xr?.isSessionSupported('immersive-ar'))
  } catch {
    return false
  }
}

/** Must be called from a user gesture. `overlay` stays visible over the camera feed (DOM Overlay API). */
export async function startAR(overlay: HTMLElement) {
  const gl = xrState.gl
  if (!gl || !navigator.xr) throw new Error('WebXR unavailable')
  const session = await navigator.xr.requestSession('immersive-ar', {
    requiredFeatures: ['hit-test'],
    optionalFeatures: ['dom-overlay'],
    domOverlay: { root: overlay },
  })
  gl.xr.setReferenceSpaceType('local')
  session.addEventListener('end', () => setXR({ presenting: false, placed: false, hasHit: false }))
  await gl.xr.setSession(session)
  setXR({ presenting: true, placed: false, hasHit: false })
}

export function endAR() {
  xrState.gl?.xr.getSession()?.end()
}
