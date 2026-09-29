// Screen-space data published every frame by the WebGL hologram and read by the DOM
// overlays (rings, node labels, tracking lines) so they stay registered to the 3D scene.

export interface NodeScreen {
  id: string
  x: number
  y: number
  visible: boolean // on the camera-facing hemisphere
  az: number // hologram azimuth, degrees
  el: number // hologram elevation, degrees
}

export const hudAnchor = {
  x: 0,
  y: 0,
  r: 0,
  ready: false,
  rotationDeg: 0, // current globe rotation, drives the bearing readout
  nodes: [] as NodeScreen[],
  // named story anchors (client, server, tap, vault, …) projected to screen pixels
  points: {} as Record<string, { x: number; y: number; on: boolean }>,
}

/** What the 3D narrative shows: derived from the real pipeline state. */
export interface Story {
  active: boolean // a target is being scanned or has results
  scanning: boolean
  stage: number // 1-5, the stage on screen
  vulnerable: boolean // a Shor-breakable handshake was observed
  patching: boolean
  patched: boolean
  anchored: boolean
  chainIndex: number
  rescan: 'idle' | 'running' | 'done'
}

export type HudMode = 'idle' | 'scanning' | 'alert' | 'critical' | 'upgrading' | 'secure'

/** A data node on the hologram: one per detected algorithm of interest. */
export interface HoloNode {
  id: string
  label: string
  state: 'warn' | 'crit' | 'ok'
}

/** Stable pseudo-position for a node on the sphere, derived from its id. */
export function nodeAngles(id: string): { az: number; el: number } {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  const u = ((h >>> 0) % 10000) / 10000
  const v = (((h >>> 0) / 10000) % 10000) / 10000
  return { az: u * 360, el: -35 + v * 70 }
}

/** Horizontal centre of the free column between the HUD's side panels (matches the hologram fit). */
export function columnCenter(W: number) {
  return W >= 1024 ? (Math.min(560, W * 0.4) + W - 350) / 2 : W / 2
}
