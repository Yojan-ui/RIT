import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'

/**
 * three.js UnrealBloomPass, driven from R3F.
 *
 * Takes over the render loop (useFrame priority 1). The composer renders into
 * a HalfFloat target, so colours pushed above 1.0 survive to the luminosity
 * threshold: only those glow. OutputPass then applies the renderer's colour
 * space conversion for the screen.
 */
export function UnrealBloom({
  strength = 1.1,
  radius = 0.55,
  threshold = 0.8,
}: {
  strength?: number
  radius?: number
  threshold?: number
}) {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const camera = useThree((s) => s.camera)
  const size = useThree((s) => s.size)
  const dpr = useThree((s) => s.viewport.dpr)

  const { composer, bloom } = useMemo(() => {
    const composer = new EffectComposer(gl)
    const render = new RenderPass(scene, camera)
    // Keep the canvas transparent so the glass panel shows through.
    render.clearColor = new THREE.Color(0, 0, 0)
    render.clearAlpha = 0
    const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), strength, radius, threshold)
    composer.addPass(render)
    composer.addPass(bloom)
    composer.addPass(new OutputPass())
    return { composer, bloom }
    // Params are applied live below; rebuild only if the GL context/scene changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gl, scene, camera])

  useEffect(() => {
    bloom.strength = strength
    bloom.radius = radius
    bloom.threshold = threshold
  }, [bloom, strength, radius, threshold])

  useEffect(() => {
    composer.setPixelRatio(dpr)
    composer.setSize(size.width, size.height)
  }, [composer, size.width, size.height, dpr])

  useEffect(() => () => composer.dispose(), [composer])

  useFrame((_, delta) => composer.render(delta), 1)
  return null
}
