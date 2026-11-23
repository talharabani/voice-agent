'use client'

import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'

export function VoxaStatementScene() {
  const containerRef = useRef<HTMLDivElement>(null)
  const [webglFailed, setWebglFailed] = useState(false)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    } catch {
      setWebglFailed(true)
      return
    }

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(container.clientWidth, container.clientHeight)
    renderer.domElement.style.width = '100%'
    renderer.domElement.style.height = '100%'
    renderer.domElement.style.display = 'block'
    container.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(
      48,
      container.clientWidth / Math.max(container.clientHeight, 1),
      0.1,
      100
    )
    camera.position.set(0, 2.2, 5.8)
    camera.lookAt(0, 0, 0)

    const cols = 42
    const rows = 24
    const count = cols * rows
    const positions = new Float32Array(count * 3)
    const baseXZ = new Float32Array(count * 2)

    let idx = 0
    for (let ix = 0; ix < cols; ix++) {
      for (let iz = 0; iz < rows; iz++) {
        const x = (ix - cols / 2) * 0.34
        const z = (iz - rows / 2) * 0.34
        positions[idx * 3] = x
        positions[idx * 3 + 1] = 0
        positions[idx * 3 + 2] = z
        baseXZ[idx * 2] = x
        baseXZ[idx * 2 + 1] = z
        idx++
      }
    }

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    const material = new THREE.PointsMaterial({
      color: 0x141414,
      size: 0.045,
      transparent: true,
      opacity: 0.35,
    })

    const wavePoints = new THREE.Points(geometry, material)
    wavePoints.position.set(1.6, -0.4, 0)
    wavePoints.rotation.y = -0.35
    scene.add(wavePoints)

    const pointer = new THREE.Vector2(0, 0)
    const onPointerMove = (e: PointerEvent) => {
      const rect = container.getBoundingClientRect()
      if (!rect.width || !rect.height) return
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
      pointer.y = -(((e.clientY - rect.top) / rect.height) * 2 - 1)
    }
    window.addEventListener('pointermove', onPointerMove, { passive: true })

    const resizeObserver = new ResizeObserver(() => {
      if (!container) return
      const w = container.clientWidth
      const h = Math.max(container.clientHeight, 1)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      renderer.setSize(w, h)
    })
    resizeObserver.observe(container)

    const clock = new THREE.Clock()
    let rafId = 0

    const animate = () => {
      const t = reducedMotion ? 0 : clock.getElapsedTime()
      const posAttr = geometry.getAttribute('position') as THREE.BufferAttribute
      for (let i = 0; i < count; i++) {
        const x = baseXZ[i * 2]
        const z = baseXZ[i * 2 + 1]
        const y =
          Math.sin(x * 0.75 + t * 1.4) * 0.28 +
          Math.cos(z * 0.85 + t * 1.1) * 0.22
        posAttr.setY(i, y)
      }
      posAttr.needsUpdate = true

      camera.position.x = THREE.MathUtils.lerp(camera.position.x, pointer.x * 0.5, 0.04)
      camera.position.y = THREE.MathUtils.lerp(camera.position.y, 2.2 + pointer.y * 0.3, 0.04)
      camera.lookAt(0.8, -0.2, 0)

      renderer.render(scene, camera)
      if (!reducedMotion) {
        rafId = requestAnimationFrame(animate)
      }
    }

    animate()

    return () => {
      cancelAnimationFrame(rafId)
      resizeObserver.disconnect()
      window.removeEventListener('pointermove', onPointerMove)
      geometry.dispose()
      material.dispose()
      renderer.dispose()
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement)
      }
    }
  }, [])

  if (webglFailed) return null

  return (
    <div
      ref={containerRef}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-0 opacity-75"
    />
  )
}
