'use client'

import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'

const VERTEX_SHADER = /* glsl */ `
  uniform float uTime;
  uniform float uPulse;
  uniform vec2 uPointer;
  varying vec3 vNormal;
  varying vec3 vWorldPos;
  varying float vDisplacement;

  // Compact 3D trigonometric wave field for smooth organic acoustic ripples
  float waveField(vec3 p, float t) {
    float n1 = sin(p.x * 2.4 + t * 1.1) * cos(p.y * 2.2 - t * 0.9) * sin(p.z * 2.4 + t * 0.7);
    float n2 = sin(p.x * 4.8 - t * 1.7 + p.z * 3.1) * cos(p.y * 4.3 + t * 1.3) * 0.45;
    return n1 + n2;
  }

  void main() {
    float field = waveField(position, uTime);
    float pointerInfluence = 0.08 * (uPointer.x * position.x + uPointer.y * position.y);
    float pulseWave = sin(length(position) * 5.0 - uTime * 8.0) * uPulse * 0.22;
    float disp = field * 0.16 + pointerInfluence + pulseWave;

    vec3 displaced = position + normal * disp;
    vDisplacement = disp;
    vNormal = normalize(normalMatrix * normal);

    vec4 worldPosition = modelMatrix * vec4(displaced, 1.0);
    vWorldPos = worldPosition.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`

const FRAGMENT_SHADER = /* glsl */ `
  uniform float uTime;
  uniform float uPulse;
  varying vec3 vNormal;
  varying vec3 vWorldPos;
  varying float vDisplacement;

  void main() {
    vec3 viewDir = normalize(cameraPosition - vWorldPos);
    float fresnel = pow(1.0 - max(dot(normalize(vNormal), viewDir), 0.0), 2.4);

    // VOXA "Game Day" palette: ink black, sage green, warm cream highlights
    vec3 ink = vec3(0.08, 0.08, 0.075);
    vec3 sage = vec3(0.55, 0.68, 0.52);
    vec3 cream = vec3(0.949, 0.929, 0.878);

    float band = smoothstep(-0.18, 0.22, vDisplacement);
    vec3 base = mix(ink, sage, band * 0.75 + 0.15);

    // Studio rim light
    vec3 lightDir = normalize(vec3(0.6, 0.8, 0.5));
    float diff = max(dot(normalize(vNormal), lightDir), 0.0);
    vec3 color = base * (0.55 + diff * 0.55) + cream * fresnel * (0.7 + uPulse * 0.5);

    gl_FragColor = vec4(color, 0.94);
  }
`

export function VoxaHeroScene() {
  const containerRef = useRef<HTMLDivElement>(null)
  const [webglFailed, setWebglFailed] = useState(false)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        powerPreference: 'high-performance',
      })
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
      42,
      container.clientWidth / Math.max(container.clientHeight, 1),
      0.1,
      100
    )
    camera.position.set(0, 0, 6.4)

    // Central 3D Acoustic Core
    const coreGeo = new THREE.IcosahedronGeometry(1.45, 40)
    const coreUniforms = {
      uTime: { value: 0 },
      uPulse: { value: 0 },
      uPointer: { value: new THREE.Vector2(0, 0) },
    }
    const coreMat = new THREE.ShaderMaterial({
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      uniforms: coreUniforms,
      transparent: true,
    })
    const coreMesh = new THREE.Mesh(coreGeo, coreMat)
    scene.add(coreMesh)

    // Subtle wireframe cage around the core for architectural 3D depth
    const cageGeo = new THREE.IcosahedronGeometry(1.78, 2)
    const cageMat = new THREE.MeshBasicMaterial({
      color: 0x141414,
      wireframe: true,
      transparent: true,
      opacity: 0.14,
    })
    const cageMesh = new THREE.Mesh(cageGeo, cageMat)
    scene.add(cageMesh)

    // Orbiting 3D acoustic rings
    const rings: Array<{ mesh: THREE.Mesh; speedX: number; speedY: number; speedZ: number }> = []
    const ringConfigs = [
      { radius: 2.25, tube: 0.014, color: 0x141414, opacity: 0.55, rx: 1.15, ry: 0.35, sx: 0.18, sy: 0.25, sz: 0.1 },
      { radius: 2.65, tube: 0.011, color: 0xf2ede0, opacity: 0.65, rx: -0.75, ry: 0.8, sx: -0.14, sy: 0.19, sz: -0.12 },
      { radius: 3.05, tube: 0.009, color: 0x141414, opacity: 0.28, rx: 0.4, ry: -1.1, sx: 0.09, sy: -0.15, sz: 0.16 },
    ]
    for (const cfg of ringConfigs) {
      const geo = new THREE.TorusGeometry(cfg.radius, cfg.tube, 16, 120)
      const mat = new THREE.MeshBasicMaterial({
        color: cfg.color,
        transparent: true,
        opacity: cfg.opacity,
      })
      const mesh = new THREE.Mesh(geo, mat)
      mesh.rotation.set(cfg.rx, cfg.ry, 0)
      scene.add(mesh)
      rings.push({ mesh, speedX: cfg.sx, speedY: cfg.sy, speedZ: cfg.sz })
    }

    // Floating 3D acoustic particles
    const particleCount = 240
    const positions = new Float32Array(particleCount * 3)
    for (let i = 0; i < particleCount; i++) {
      const r = 2.4 + Math.random() * 2.8
      const theta = Math.random() * Math.PI * 2
      const phi = Math.acos(2 * Math.random() - 1)
      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta)
      positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta) * 0.72
      positions[i * 3 + 2] = r * Math.cos(phi)
    }
    const particleGeo = new THREE.BufferGeometry()
    particleGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    const particleMat = new THREE.PointsMaterial({
      color: 0x141414,
      size: 0.032,
      transparent: true,
      opacity: 0.42,
    })
    const particles = new THREE.Points(particleGeo, particleMat)
    scene.add(particles)

    const targetPointer = new THREE.Vector2(0, 0)
    const currentPointer = new THREE.Vector2(0, 0)
    const dragRotation = new THREE.Vector2(0, 0)
    const dragVelocity = new THREE.Vector2(0, 0)
    let isDragging = false
    let prevPointer = { x: 0, y: 0 }
    let dragDistance = 0
    let pulseTarget = 0
    let scrollFactor = 0

    const onPointerMove = (e: PointerEvent) => {
      const rect = container.getBoundingClientRect()
      if (!rect.width || !rect.height) return
      targetPointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
      targetPointer.y = -(((e.clientY - rect.top) / rect.height) * 2 - 1)

      if (isDragging) {
        const dx = e.clientX - prevPointer.x
        const dy = e.clientY - prevPointer.y
        dragDistance += Math.hypot(dx, dy)
        dragVelocity.y = dx * 0.008
        dragVelocity.x = dy * 0.008
        dragRotation.y += dragVelocity.y
        dragRotation.x += dragVelocity.x
        prevPointer = { x: e.clientX, y: e.clientY }
      }
    }

    const onPointerDown = (e: PointerEvent) => {
      isDragging = true
      dragDistance = 0
      prevPointer = { x: e.clientX, y: e.clientY }
    }

    const onPointerUp = () => {
      if (isDragging && dragDistance < 6) {
        pulseTarget = 1
      }
      isDragging = false
    }

    const onScroll = () => {
      scrollFactor = Math.min(window.scrollY / 600, 1)
    }

    window.addEventListener('pointermove', onPointerMove, { passive: true })
    container.addEventListener('pointerdown', onPointerDown, { passive: true })
    window.addEventListener('pointerup', onPointerUp, { passive: true })
    window.addEventListener('scroll', onScroll, { passive: true })

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
      const elapsed = reducedMotion ? 0.5 : clock.getElapsedTime()

      currentPointer.lerp(targetPointer, 0.06)
      pulseTarget = THREE.MathUtils.lerp(pulseTarget, 0, 0.05)

      if (!isDragging) {
        dragRotation.x += dragVelocity.x
        dragRotation.y += dragVelocity.y
        dragVelocity.multiplyScalar(0.92)
      }

      coreUniforms.uTime.value = elapsed
      coreUniforms.uPulse.value = pulseTarget
      coreUniforms.uPointer.value.copy(currentPointer)

      coreMesh.rotation.y = elapsed * 0.18 + currentPointer.x * 0.45 + dragRotation.y
      coreMesh.rotation.x = currentPointer.y * 0.35 + scrollFactor * 0.5 + dragRotation.x

      cageMesh.rotation.y = -elapsed * 0.12 + currentPointer.x * 0.3 + dragRotation.y * 0.85
      cageMesh.rotation.x = elapsed * 0.08 + currentPointer.y * 0.25 + dragRotation.x * 0.85
      const cageScale = 1 + pulseTarget * 0.12
      cageMesh.scale.setScalar(cageScale)

      for (const r of rings) {
        r.mesh.rotation.x += (reducedMotion ? 0 : r.speedX * 0.008)
        r.mesh.rotation.y += (reducedMotion ? 0 : r.speedY * 0.008)
        r.mesh.rotation.z += (reducedMotion ? 0 : r.speedZ * 0.008)
      }

      particles.rotation.y = elapsed * 0.04 + currentPointer.x * 0.2
      particles.rotation.x = currentPointer.y * 0.15

      camera.position.x = THREE.MathUtils.lerp(camera.position.x, currentPointer.x * 0.55, 0.05)
      camera.position.y = THREE.MathUtils.lerp(camera.position.y, currentPointer.y * 0.35 - scrollFactor * 0.6, 0.05)
      camera.position.z = 6.4 + scrollFactor * 1.4
      camera.lookAt(0, 0, 0)

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
      container.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('scroll', onScroll)
      coreGeo.dispose()
      coreMat.dispose()
      cageGeo.dispose()
      cageMat.dispose()
      for (const r of rings) {
        r.mesh.geometry.dispose()
        ;(r.mesh.material as THREE.Material).dispose()
      }
      particleGeo.dispose()
      particleMat.dispose()
      renderer.dispose()
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement)
      }
    }
  }, [])

  if (webglFailed) {
    return null
  }

  return (
    <div
      ref={containerRef}
      aria-hidden="true"
      className="pointer-events-auto absolute inset-0 z-0 cursor-grab touch-pan-y opacity-90 active:cursor-grabbing"
    />
  )
}
