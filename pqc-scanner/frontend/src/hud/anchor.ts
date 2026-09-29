// Screen-space position of the holographic globe, written every frame by the WebGL
// scene and read by the DOM overlays (HUD rings, tracking lines) so they stay locked on.
export const hudAnchor = { x: 0, y: 0, r: 0, ready: false }

export type HudMode = 'idle' | 'scanning' | 'alert' | 'critical' | 'upgrading' | 'secure'
