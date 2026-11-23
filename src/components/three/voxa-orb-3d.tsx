'use client'

import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { AudioLines } from 'lucide-react'

type OrbPhase = 'idle' | 'connecting' | 'listening' | 'thinking' | 'buffering' | 'speaking' | 'ended'

const ORB_VERTEX = /* glsl */ `
  uniform float uTime;
  uniform float uIntensity;
  varying vec3 vNormal;
  varying vec3 vWorldPos;
  varying float vDisp;

  void main() {
    float wave =
      sin(position.x * 3.2 + uTime * 2.2) *
      cos(position.y * 3.0 - uTime * 1.8) *
      sin(position.z * 3.2 + uTime * 1.5);
    float disp = wave * (0.06 + uIntensity * 0.22);
    vec3 displaced = position + normal * disp;
    vDisp = disp;
    vNormal = normalize(normalMatrix * normal);
    vec4 worldPos = modelMatrix * vec4(displaced, 1.0);
    vWorldPos = worldPos.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`

const ORB_FRAGMENT = /* glsl */ `
  uniform float uIntensity;
  varying vec3 vNormal;
  varying vec3 vWorldPos;
  varying float vDisp;

  void main() {
    vec3 viewDir = normalize(cameraPosition - vWorldPos);
    float fresnel = pow(1.0 - max(dot(normalize(vNormal), viewDir), 0.0), 2.2);

    vec3 sageLight = vec3(0.769, 0.827, 0.722);
    vec3 sageDeep = vec3(0.494, 0.608, 0.463);
    vec3 cream = vec3(0.949, 0.929, 0.878);

    float mixFactor = smoothstep(-0.15, 0.18, vDisp);
    vec3 base = mix(sageDeep, sageLight, mixFactor * 0.75 + 0.2);

    vec3 lightDir = normalize(vec3(-0.4, 0.8, 0.6));
    float diff = max(dot(normalize(vNormal), lightDir), 0.0);
    vec3 color = base * (0.62 + diff * 0.48) + cream * fresnel * (0.55 + uIntensity * 0.45);

    gl_FragColor = vec4(color, 1.0);
  }
`

export function VoxaOrb3D({
  phase,
  muted,
  previewAudible,
}: {
  phase: OrbPhase
  muted?: boolean
  previewAudible?: boolean
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const phaseRef = useRef(phase)
  const mutedRef = useRef(Boolean(muted))
  const previewRef = useRef(Boolean(previewAudible))
  const [fallback, setFallback] = useState(false)

  phaseRef.current = phase
  mutedRef.current = Boolean(muted)
  previewRef.current = Boolean(previewAudible)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    } catch {
      setFallback(true)
      return
    }

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(host.clientWidth || 256, host.clientHeight || 256)
    renderer.domElement.style.width = '100%'
    renderer.domElement.style.height = '100%'
    renderer.domElement.style.display = 'block'
    host.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 50)
    camera.position.set(0, 0, 4.2)

    const orbGeo = new THREE.IcosahedronGeometry(1.05, 36)
    const uniforms = {
      uTime: { value: 0 },
      uIntensity: { value: 0.1 },
    }
    const orbMat = new THREE.ShaderMaterial({
      vertexShader: ORB_VERTEX,
      fragmentShader: ORB_FRAGMENT,
      uniforms,
    })
    const orbMesh = new THREE.Mesh(orbGeo, orbMat)
    scene.add(orbMesh)

    const ringGeo1 = new THREE.TorusGeometry(1.42, 0.014, 12, 96)
    const ringMat1 = new THREE.MeshBasicMaterial({
      color: 0x161613,
      transparent: true,
      opacity: 0.35,
    })
    const ring1 = new THREE.Mesh(ringGeo1, ringMat1)
    ring1.rotation.set(1.1, 0.3, 0)
    scene.add(ring1)

    const ringGeo2 = new THREE.TorusGeometry(1.62, 0.01, 12, 96)
    const ringMat2 = new THREE.MeshBasicMaterial({
      color: 0x7e9b76,
      transparent: true,
      opacity: 0.45,
    })
    const ring2 = new THREE.Mesh(ringGeo2, ringMat2)
    ring2.rotation.set(-0.8, 0.6, 0)
    scene.add(ring2)

    const pointer = new THREE.Vector2(0, 0)
    const onPointerMove = (e: PointerEvent) => {
      const rect = host.getBoundingClientRect()
      if (!rect.width || !rect.height) return
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
      pointer.y = -(((e.clientY - rect.top) / rect.height) * 2 - 1)
    }
    host.addEventListener('pointermove', onPointerMove, { passive: true })

    const clock = new THREE.Clock()
    let smoothIntensity = 0.1
    let rafId = 0

    const animate = () => {
      const elapsed = reducedMotion ? 0 : clock.getElapsedTime()

      // Read --mic-level set by AudioCall's analyser loop on parent orbRef
      const parentWithVar = host.closest('[style*="--mic-level"]') as HTMLElement | null
      const rawMic = parentWithVar
        ? parseFloat(getComputedStyle(parentWithVar).getPropertyValue('--mic-level') || '0')
        : 0
      const micLevel = Number.isFinite(rawMic) ? Math.min(Math.max(rawMic, 0), 1) : 0

      const p = phaseRef.current
      const isSpeaking = p === 'speaking' || previewRef.current
      const isThinking = p === 'thinking' || p === 'connecting' || p === 'buffering'
      const isListening = p === 'listening' && !mutedRef.current

      const targetIntensity = isSpeaking
        ? 0.65 + Math.sin(elapsed * 6) * 0.25
        : isListening
          ? 0.2 + micLevel * 1.4
          : isThinking
            ? 0.42
            : 0.08

      smoothIntensity = THREE.MathUtils.lerp(smoothIntensity, targetIntensity, 0.12)
      uniforms.uTime.value = elapsed * (isSpeaking ? 1.8 : isThinking ? 1.4 : 0.8)
      uniforms.uIntensity.value = smoothIntensity

      const scale = 1 + smoothIntensity * 0.1
      orbMesh.scale.setScalar(scale)
      orbMesh.rotation.y = elapsed * 0.25 + pointer.x * 0.6
      orbMesh.rotation.x = pointer.y * 0.45

      const ringSpeed = isThinking ? 0.03 : isSpeaking ? 0.02 : 0.007
      if (!reducedMotion) {
        ring1.rotation.z += ringSpeed
        ring1.rotation.x += ringSpeed * 0.5
        ring2.rotation.z -= ringSpeed * 0.8
        ring2.rotation.y += ringSpeed * 0.6
      }

      renderer.render(scene, camera)
      if (!reducedMotion) {
        rafId = requestAnimationFrame(animate)
      }
    }

    animate()

    return () => {
      cancelAnimationFrame(rafId)
      host.removeEventListener('pointermove', onPointerMove)
      orbGeo.dispose()
      orbMat.dispose()
      ringGeo1.dispose()
      ringMat1.dispose()
      ringGeo2.dispose()
      ringMat2.dispose()
      renderer.dispose()
      if (renderer.domElement.parentNode === host) {
        host.removeChild(renderer.domElement)
      }
    }
  }, [])

  if (fallback) {
    return (
      <div className="voice-orb">
        <AudioLines className={`relative z-10 size-16 stroke-[1] text-brand-text/65 ${phase === 'thinking' ? 'animate-pulse' : ''}`} />
      </div>
    )
  }

  return (
    <div ref={hostRef} className="relative z-10 size-60 cursor-grab active:cursor-grabbing" />
  )
}
