import { useEffect } from 'react'
import { motion, useSpring, useTransform } from 'framer-motion'

const MAX = 0.5 // gauge full scale: 50% QBER (pure guessing)
const R = 78
const CX = 100
const CY = 96

const polar = (frac: number, r = R) => {
  const a = Math.PI * (1 - frac)
  return [CX + r * Math.cos(a), CY - r * Math.sin(a)] as const
}
const ARC = `M ${CX - R} ${CY} A ${R} ${R} 0 0 1 ${CX + R} ${CY}`

/** Semicircular QBER dial. A soft spring makes it overshoot, so an attack reads as a spike. */
export function QberGauge({ qber, threshold }: { qber: number; threshold: number }) {
  const frac = Math.min(qber / MAX, 1)
  const danger = qber > threshold
  const spring = useSpring(0, { stiffness: 90, damping: 8, mass: 0.9 })
  useEffect(() => spring.set(frac), [frac, spring])

  // Needle tip follows the spring (allowed to overshoot slightly past full scale).
  const clampF = (f: number) => Math.max(0, Math.min(f, 1.08))
  const tipX = useTransform(spring, (f) => polar(clampF(f), R - 14)[0])
  const tipY = useTransform(spring, (f) => polar(clampF(f), R - 14)[1])
  // Hide the fill at ~0 so the round line caps don't leave dots on the track.
  const fillOpacity = useTransform(spring, (f) => (f > 0.004 ? 1 : 0))
  const pct = useTransform(spring, (f) => `${(Math.max(0, f) * MAX * 100).toFixed(1)}`)
  const [tx1, ty1] = polar(threshold / MAX, R - 12)
  const [tx2, ty2] = polar(threshold / MAX, R + 8)
  const color = danger ? '#f43f5e' : '#22d3ee'

  return (
    <div>
      <svg viewBox="-16 -20 232 126" className="w-full" role="img" aria-label={`QBER ${(qber * 100).toFixed(1)} percent`}>
        <defs>
          <linearGradient id="qber-grad" x1="0" x2="1">
            <stop offset="0%" stopColor="#22d3ee" />
            <stop offset="22%" stopColor="#a78bfa" />
            <stop offset="45%" stopColor="#f43f5e" />
            <stop offset="100%" stopColor="#f43f5e" />
          </linearGradient>
          <filter id="qber-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <path d={ARC} stroke="rgb(125 137 176 / 0.18)" strokeWidth="10" fill="none" strokeLinecap="round" />
        <motion.path
          d={ARC}
          stroke="url(#qber-grad)"
          strokeWidth="10"
          fill="none"
          strokeLinecap="round"
          filter="url(#qber-glow)"
          style={{ pathLength: spring, opacity: fillOpacity }}
        />
        {[0, 0.1, 0.2, 0.3, 0.4, 0.5].map((v) => {
          const [x1, y1] = polar(v / MAX, R + 9)
          const [x2, y2] = polar(v / MAX, R + 14)
          const [lx, ly] = polar(v / MAX, R + 22)
          return (
            <g key={v}>
              <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#7d89b0" strokeWidth="1" />
              <text x={lx} y={ly + 3} fontSize="7" fill="#7d89b0" textAnchor="middle">
                {v * 100}
              </text>
            </g>
          )
        })}
        {/* 11% abort threshold */}
        <line x1={tx1} y1={ty1} x2={tx2} y2={ty2} stroke="#fbbf24" strokeWidth="2" strokeDasharray="2 2" />
        <motion.line x1={CX} y1={CY} x2={tipX} y2={tipY} stroke={color} strokeWidth="2.5" strokeLinecap="round" />
        <circle cx={CX} cy={CY} r="5" fill="#05060d" stroke={color} strokeWidth="2" />
      </svg>
      <div className="-mt-1 flex flex-col items-center">
        <div className="flex items-baseline gap-0.5">
          <motion.span className="text-3xl font-extrabold tabular-nums" style={{ color, textShadow: `0 0 18px ${color}` }}>
            {pct}
          </motion.span>
          <span className="text-sm" style={{ color }}>%</span>
        </div>
      </div>
    </div>
  )
}
