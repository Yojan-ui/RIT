import { useSyncExternalStore } from 'react'

/** Photon spacings between Alice's aperture and Bob's analyzer (≈ photons in flight). */
export const TRAVEL = 7
/** Photons emitted per second at 1× speed. */
export const RATE = 2.2

export interface PlaybackState {
  playing: boolean
  /** Last photon to reach Bob's detectors (-1 = none yet). */
  focus: number
  speed: number
}

/**
 * Shared transmission clock. The 3D scene reads `s` every frame; the HUD
 * subscribes to the coarse state (playing / focus / speed).
 *
 * `s` is measured in photons: photon i leaves Alice at s = i and is
 * detected by Bob at s = i + TRAVEL.
 */
class Playback {
  s = 0
  target: number | null = null
  n = 0
  private state: PlaybackState = { playing: true, focus: -1, speed: 1 }
  private listeners = new Set<() => void>()

  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }
  get = () => this.state

  private set(patch: Partial<PlaybackState>) {
    this.state = { ...this.state, ...patch }
    this.listeners.forEach((fn) => fn())
  }

  get end() {
    return this.n - 1 + TRAVEL
  }

  play() {
    this.target = null
    if (this.s >= this.end) this.s = 0
    this.set({ playing: true })
  }
  pause() {
    this.set({ playing: false })
  }
  toggle() {
    if (this.state.playing) this.pause()
    else this.play()
  }
  /** Advance until exactly one more photon has reached Bob. */
  step() {
    this.pause()
    const from = this.target ?? this.s
    if (from >= this.end - 1e-6) {
      this.s = TRAVEL - 1
      this.target = TRAVEL
      return
    }
    this.target = Math.min(this.end, Math.floor(from + 1e-6) + 1)
  }
  /** Jump so photon k has just been detected. */
  seek(k: number) {
    this.pause()
    this.target = null
    this.s = Math.max(0, Math.min(this.end, k + TRAVEL))
    this.setFocus(k)
  }
  restart() {
    this.target = null
    this.s = 0
    this.setFocus(-1)
    this.set({ playing: true })
  }
  load(n: number) {
    this.n = n
    this.restart()
  }
  setSpeed(speed: number) {
    this.set({ speed })
  }
  setFocus(k: number) {
    if (k !== this.state.focus) this.set({ focus: k })
  }

  /** Called once per frame from inside the Canvas. */
  tick(dt: number) {
    if (this.n === 0) return
    if (this.state.playing) {
      this.s += dt * RATE * this.state.speed
      if (this.s > this.end + 2.5) this.s = 0 // loop the transmission
    } else if (this.target !== null) {
      this.s += (this.target - this.s) * (1 - Math.exp(-dt * 9))
      if (Math.abs(this.target - this.s) < 0.002) {
        this.s = this.target
        this.target = null
      }
    }
    const focus = Math.min(this.n - 1, Math.floor(this.s - TRAVEL + 1e-4))
    this.setFocus(Math.max(-1, focus))
  }
}

export const playback = new Playback()

export const usePlayback = () => useSyncExternalStore(playback.subscribe, playback.get)
