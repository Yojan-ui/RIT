// Cryptographic data sonification: every cue is synthesised with the Web Audio API (no samples)
// and fired by real pipeline events, never by a timer on its own.
//
//   DETECT  Geiger-counter clicks; the rate rises with each Shor-vulnerable algorithm parsed
//   DEFEND  sub-bass sweep while the ML-KEM lattice grows, a lattice chime when it locks
//   PROVE   mechanical vault lock when the ledger block snaps into the Merkle chain
//
// Browsers only start audio after a user gesture, so the context is created lazily on the first
// pointer / key press. The mute state is a per-viewer preference kept in localStorage.

type Listener = () => void

const KEY = 'ql.sfx'
let ctx: AudioContext | null = null
let master: GainNode | null = null
let wet: GainNode | null = null
let noise: AudioBuffer | null = null
let enabled = (() => {
  try {
    return localStorage.getItem(KEY) !== 'off'
  } catch {
    return true
  }
})()
const listeners = new Set<Listener>()

/** Synthetic room: exponentially decaying stereo noise used as a convolution impulse response. */
function impulse(c: AudioContext, seconds: number, decay: number) {
  const n = Math.floor(c.sampleRate * seconds)
  const buf = c.createBuffer(2, n, c.sampleRate)
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch)
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n) ** decay
  }
  return buf
}

function init() {
  if (ctx) return ctx
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AC) return null
  ctx = new AC()
  const comp = ctx.createDynamicsCompressor()
  comp.threshold.value = -16
  comp.ratio.value = 4
  master = ctx.createGain()
  master.gain.value = enabled ? 0.7 : 0
  master.connect(comp).connect(ctx.destination)
  const verb = ctx.createConvolver()
  verb.buffer = impulse(ctx, 2.8, 2.6)
  wet = ctx.createGain()
  wet.gain.value = 0.35
  wet.connect(verb).connect(master)
  noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate)
  const d = noise.getChannelData(0)
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
  return ctx
}

if (typeof window !== 'undefined') {
  const unlock = () => {
    init()?.resume()
  }
  addEventListener('pointerdown', unlock, { capture: true })
  addEventListener('keydown', unlock, { capture: true })
}

/** A running, unmuted context, or null (no gesture yet, muted, or no Web Audio). */
function live() {
  if (!enabled || !ctx || ctx.state !== 'running') return null
  return ctx
}

/** Output bus: dry into the master, plus an optional send into the reverb. */
function bus(c: AudioContext, send = 0) {
  const g = c.createGain()
  g.connect(master!)
  if (send > 0) {
    const s = c.createGain()
    s.gain.value = send
    g.connect(s).connect(wet!)
  }
  return g
}

function env(g: GainNode, t: number, peak: number, attack: number, release: number) {
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(peak, t + attack)
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + release)
}

function noiseBurst(c: AudioContext, out: AudioNode, t: number, dur: number, type: BiquadFilterType, freq: number, q: number, peak: number) {
  const src = c.createBufferSource()
  src.buffer = noise
  src.playbackRate.value = 0.8 + Math.random() * 0.4
  const f = c.createBiquadFilter()
  f.type = type
  f.frequency.value = freq
  f.Q.value = q
  const g = c.createGain()
  env(g, t, peak, 0.001, dur)
  src.connect(f).connect(g).connect(out)
  src.start(t, Math.random() * 0.5, dur + 0.05)
}

function tone(c: AudioContext, out: AudioNode, t: number, type: OscillatorType, f0: number, f1: number, glide: number, peak: number, attack: number, release: number) {
  const o = c.createOscillator()
  o.type = type
  o.frequency.setValueAtTime(f0, t)
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + glide)
  const g = c.createGain()
  env(g, t, peak, attack, release)
  o.connect(g).connect(out)
  o.start(t)
  o.stop(t + attack + release + 0.05)
}

export const sfx = {
  get enabled() {
    return enabled
  },
  setEnabled(on: boolean) {
    enabled = on
    try {
      localStorage.setItem(KEY, on ? 'on' : 'off')
    } catch {
      /* private mode: the toggle still works for this page */
    }
    if (on) init()?.resume()
    if (ctx && master) master.gain.setTargetAtTime(on ? 0.7 : 0, ctx.currentTime, 0.05)
    listeners.forEach((l) => l())
  },
  subscribe(l: Listener) {
    listeners.add(l)
    return () => {
      listeners.delete(l)
    }
  },

  /** One Geiger–Müller tube discharge: a 1-3 ms broadband tick, high-passed, random strength. */
  click(strength = 1) {
    const c = live()
    if (!c) return
    const t = c.currentTime
    const out = bus(c)
    noiseBurst(c, out, t, 0.002 + Math.random() * 0.0025, 'highpass', 1800 + Math.random() * 1400, 0.7, 0.05 + 0.1 * strength * Math.random())
    // the tube's faint ring
    tone(c, out, t, 'triangle', 3100 + Math.random() * 500, 3100, 0.01, 0.008 * strength, 0.001, 0.012)
  },

  /** Stage 3 start: sub-bass drop under a filtered swell, timed to the lattice growing along the link. */
  latticeSweep(seconds = 1.8) {
    const c = live()
    if (!c) return
    const t = c.currentTime
    const out = bus(c, 0.4)
    tone(c, out, t, 'sine', 92, 34, seconds + 0.6, 0.55, 0.25, seconds + 0.9)
    tone(c, out, t, 'sine', 184, 68, seconds + 0.6, 0.12, 0.3, seconds + 0.6)
    const saw = c.createOscillator()
    saw.type = 'sawtooth'
    saw.frequency.setValueAtTime(55, t)
    saw.detune.setValueAtTime(-8, t)
    const lp = c.createBiquadFilter()
    lp.type = 'lowpass'
    lp.Q.value = 9
    lp.frequency.setValueAtTime(120, t)
    lp.frequency.exponentialRampToValueAtTime(1400, t + seconds * 0.8)
    lp.frequency.exponentialRampToValueAtTime(90, t + seconds + 0.8)
    const g = c.createGain()
    env(g, t, 0.09, seconds * 0.7, 1.1)
    saw.connect(lp).connect(g).connect(out)
    saw.start(t)
    saw.stop(t + seconds * 0.7 + 1.2)
    noiseBurst(c, out, t, seconds, 'bandpass', 600, 0.6, 0.015)
  },

  /** Stage 3 lock-in: a resonant bell (inharmonic partials) over a low boom. */
  latticeChime() {
    const c = live()
    if (!c) return
    const t = c.currentTime
    const out = bus(c, 0.7)
    tone(c, out, t, 'sine', 70, 42, 0.8, 0.5, 0.005, 1.6)
    const f = 392
    ;[
      [1, 0.14, 3.2],
      [2.76, 0.06, 2.2],
      [5.4, 0.03, 1.4],
      [8.93, 0.012, 0.9],
      [1.5, 0.05, 2.6],
    ].forEach(([k, a, r]) => tone(c, out, t + 0.02, 'sine', f * k, f * k, 0, a, 0.004, r))
  },

  /** Stage 4 snap: bolts throw, a heavy door lands, the vault body rings. */
  vaultLock() {
    const c = live()
    if (!c) return
    const t = c.currentTime
    const out = bus(c, 0.45)
    // three bolts sliding home
    ;[0, 0.07, 0.14].forEach((d, i) => {
      noiseBurst(c, out, t + d, 0.03, 'bandpass', 2400 - i * 300, 6, 0.22)
      tone(c, out, t + d, 'square', 900 - i * 80, 500, 0.02, 0.02, 0.001, 0.03)
    })
    const hit = t + 0.2
    // the thud
    tone(c, out, hit, 'sine', 120, 38, 0.25, 0.9, 0.003, 0.55)
    noiseBurst(c, out, hit, 0.12, 'lowpass', 380, 0.8, 0.5)
    // metal clank and the ringing body
    noiseBurst(c, out, hit, 0.06, 'bandpass', 1800, 9, 0.35)
    ;[
      [310, 0.05, 1.1],
      [838, 0.03, 0.8],
      [1417, 0.02, 0.6],
      [2210, 0.012, 0.4],
    ].forEach(([f, a, r]) => tone(c, out, hit, 'triangle', f, f * 0.995, r, a, 0.002, r))
    // latch settles
    noiseBurst(c, out, hit + 0.32, 0.02, 'highpass', 3000, 1, 0.08)
  },
}

/**
 * Geiger counter: Poisson-distributed clicks at `rate` per second (erratic, like real decay).
 * Returns a setter for the rate; 0 silences it. `stop` tears it down.
 */
export function geiger() {
  let rate = 0
  let timer: ReturnType<typeof setTimeout> | null = null
  const schedule = () => {
    timer = null
    if (rate <= 0) return
    // exponential inter-arrival time, clamped so a burst never floods the audio graph
    const dt = Math.max(0.018, -Math.log(1 - Math.random()) / rate)
    timer = setTimeout(() => {
      sfx.click(Math.min(1, 0.45 + rate / 20))
      schedule()
    }, dt * 1000)
  }
  return {
    set(r: number) {
      const was = rate
      rate = Math.max(0, r)
      // decay is memoryless, so a faster rate can simply redraw the pending wait
      if (rate > 0 && (!timer || rate > was)) {
        if (timer) clearTimeout(timer)
        schedule()
      }
    },
    stop() {
      rate = 0
      if (timer) clearTimeout(timer)
      timer = null
    },
  }
}
