'use client'

import { useEffect, useRef, useState, type RefObject } from 'react'
import * as THREE from 'three'
import { AudioLines } from 'lucide-react'

export type OrbPhase =
  | 'idle'
  | 'connecting'
  | 'ringing'
  | 'listening'
  | 'customer-speaking'
  | 'thinking'
  | 'buffering'
  | 'speaking'
  | 'ended'

const ORB_VERTEX = /* glsl */ `
  uniform float uTime;
  uniform float uIntensity;
  varying vec3 vNormal;
  varying vec3 vWorldPos;
  varying float vDisp;

  void main() {
    float wave =
      sin(position.x * 3.1 + uTime * 2.1) *
      cos(position.y * 2.9 - uTime * 1.7) *
      sin(position.z * 3.1 + uTime * 1.4);
    float disp = wave * (0.05 + uIntensity * 0.21);
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
  uniform vec3 uPrimary;
  uniform vec3 uSecondary;
  varying vec3 vNormal;
  varying vec3 vWorldPos;
  varying float vDisp;

  void main() {
    vec3 viewDir = normalize(cameraPosition - vWorldPos);
    float fresnel = pow(1.0 - max(dot(normalize(vNormal), viewDir), 0.0), 2.1);
    vec3 cream = vec3(0.955, 0.935, 0.885);

    float mixFactor = smoothstep(-0.15, 0.18, vDisp);
    vec3 base = mix(uSecondary, uPrimary, mixFactor * 0.75 + 0.2);

    vec3 lightDir = normalize(vec3(-0.4, 0.8, 0.6));
    float diff = max(dot(normalize(vNormal), lightDir), 0.0);
    vec3 color = base * (0.62 + diff * 0.48) + cream * fresnel * (0.52 + uIntensity * 0.45);

    gl_FragColor = vec4(color, 1.0);
  }
`

// Distinct visual palettes for each conversational state
const PALETTE = {
  idle: { primary: new THREE.Color(0.76, 0.82, 0.72), secondary: new THREE.Color(0.50, 0.60, 0.47) },
  ringing: { primary: new THREE.Color(0.91, 0.78, 0.54), secondary: new THREE.Color(0.68, 0.58, 0.36) },
  customer: { primary: new THREE.Color(0.45, 0.82, 0.68), secondary: new THREE.Color(0.18, 0.56, 0.45) },
  agent: { primary: new THREE.Color(0.83, 0.88, 0.70), secondary: new THREE.Color(0.42, 0.64, 0.48) },
  thinking: { primary: new THREE.Color(0.74, 0.79, 0.76), secondary: new THREE.Color(0.45, 0.54, 0.52) },
  muted: { primary: new THREE.Color(0.65, 0.66, 0.61), secondary: new THREE.Color(0.46, 0.47, 0.43) },
}

export function VoxaOrb3D({
  phase,
  muted,
  previewAudible,
  audioLevelRef,
}: {
  phase: OrbPhase
  muted?: boolean
  previewAudible?: boolean
  audioLevelRef?: RefObject<number>
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const phaseRef = useRef(phase)
  const mutedRef = useRef(Boolean(muted))
  const previewRef = useRef(Boolean(previewAudible))
  const levelRef = useRef(audioLevelRef)
  const [fallback, setFallback] = useState(false)

  phaseRef.current = phase
  mutedRef.current = Boolean(muted)
  previewRef.current = Boolean(previewAudible)
  levelRef.current = audioLevelRef

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        powerPreference: 'default',
      })
    } catch {
      setFallback(true)
      return
    }

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
    renderer.setSize(host.clientWidth || 240, host.clientHeight || 240)
    renderer.domElement.style.width = '100%'
    renderer.domElement.style.height = '100%'
    renderer.domElement.style.display = 'block'
    host.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 50)
    camera.position.set(0, 0, 4.2)

    // 16 subdivisions (~5k tris) compiles & renders ~5x faster than 36 (~25k tris) with identical visual smoothness
    const orbGeo = new THREE.IcosahedronGeometry(1.05, 16)
    const curPrimary = PALETTE.idle.primary.clone()
    const curSecondary = PALETTE.idle.secondary.clone()

    const uniforms = {
      uTime: { value: 0 },
      uIntensity: { value: 0.1 },
      uPrimary: { value: curPrimary },
      uSecondary: { value: curSecondary },
    }
    const orbMat = new THREE.ShaderMaterial({
      vertexShader: ORB_VERTEX,
      fragmentShader: ORB_FRAGMENT,
      uniforms,
    })
    const orbMesh = new THREE.Mesh(orbGeo, orbMat)
    scene.add(orbMesh)

    const ringGeo1 = new THREE.TorusGeometry(1.42, 0.014, 10, 64)
    const ringMat1 = new THREE.MeshBasicMaterial({
      color: 0x161613,
      transparent: true,
      opacity: 0.32,
    })
    const ring1 = new THREE.Mesh(ringGeo1, ringMat1)
    ring1.rotation.set(1.1, 0.3, 0)
    scene.add(ring1)

    const ringGeo2 = new THREE.TorusGeometry(1.62, 0.01, 10, 64)
    const ringMat2 = new THREE.MeshBasicMaterial({
      color: 0x7e9b76,
      transparent: true,
      opacity: 0.42,
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

    // Cache parent node once if audioLevelRef is not supplied (avoids 60fps DOM traversal)
    const fallbackParent = host.parentElement

    const clock = new THREE.Clock()
    let smoothIntensity = 0.1
    let rafId = 0

    const animate = () => {
      const elapsed = reducedMotion ? 0 : clock.getElapsedTime()

      let audioLevel = 0
      const extRef = levelRef.current
      if (extRef && Number.isFinite(extRef.current)) {
        audioLevel = Math.min(Math.max(extRef.current, 0), 1)
      } else if (fallbackParent) {
        const inlineVal = parseFloat(fallbackParent.style.getPropertyValue('--mic-level') || '0')
        audioLevel = Number.isFinite(inlineVal) ? Math.min(Math.max(inlineVal, 0), 1) : 0
      }

      const p = phaseRef.current
      const isMuted = mutedRef.current
      const isAgentSpeaking = p === 'speaking' || previewRef.current
      const isCustomerSpeaking = p === 'customer-speaking' && !isMuted
      const isRinging = p === 'ringing'
      const isConnecting = p === 'connecting'
      const isThinking = p === 'thinking' || p === 'buffering'
      const isListening = p === 'listening' && !isMuted

      const targetPalette = isMuted
        ? PALETTE.muted
        : isAgentSpeaking
          ? PALETTE.agent
          : isCustomerSpeaking
            ? PALETTE.customer
            : isRinging || isConnecting
              ? PALETTE.ringing
              : isThinking
                ? PALETTE.thinking
                : PALETTE.idle

      curPrimary.lerp(targetPalette.primary, 0.08)
      curSecondary.lerp(targetPalette.secondary, 0.08)

      let targetIntensity = 0.09
      if (isAgentSpeaking) {
        targetIntensity = audioLevel > 0.02
          ? 0.42 + audioLevel * 0.95
          : 0.62 + Math.sin(elapsed * 5.8) * 0.22
      } else if (isCustomerSpeaking) {
        targetIntensity = 0.34 + Math.max(audioLevel, 0.18) * 1.15
      } else if (isRinging) {
        // Rhythmic ringing swell matching ~1.55s on / ~2.3s calm pause
        const cycle = (elapsed % 3.85) / 3.85
        targetIntensity = cycle < 0.42 ? 0.32 + Math.sin(elapsed * 8) * 0.14 : 0.1
      } else if (isConnecting) {
        targetIntensity = 0.28 + Math.sin(elapsed * 4) * 0.1
      } else if (isThinking) {
        targetIntensity = 0.38 + Math.sin(elapsed * 3.2) * 0.08
      } else if (isListening) {
        targetIntensity = 0.14 + audioLevel * 1.1 + Math.sin(elapsed * 1.8) * 0.03
      } else if (isMuted || p === 'ended') {
        targetIntensity = 0.05
      }

      smoothIntensity = THREE.MathUtils.lerp(smoothIntensity, targetIntensity, 0.14)
      const timeScale = isAgentSpeaking
        ? 1.85
        : isCustomerSpeaking
          ? 1.55
          : isThinking || isConnecting
            ? 1.35
            : isRinging
              ? 1.1
              : 0.72
      uniforms.uTime.value = elapsed * timeScale
      uniforms.uIntensity.value = smoothIntensity

      const scale = 1 + smoothIntensity * 0.1
      orbMesh.scale.setScalar(scale)
      orbMesh.rotation.y = elapsed * 0.22 + pointer.x * 0.55
      orbMesh.rotation.x = pointer.y * 0.4

      const ringSpeed = isConnecting || isThinking
        ? 0.028
        : isAgentSpeaking
          ? 0.022
          : isCustomerSpeaking
            ? 0.017
            : isRinging
              ? 0.014
              : 0.006
      if (!reducedMotion) {
        ring1.rotation.z += ringSpeed
        ring1.rotation.x += ringSpeed * 0.45
        ring2.rotation.z -= ringSpeed * 0.78
        ring2.rotation.y += ringSpeed * 0.55
      }

      ringMat2.color.copy(curPrimary)
      ringMat2.opacity = isMuted || p === 'ended' ? 0.18 : isAgentSpeaking || isCustomerSpeaking ? 0.65 : 0.42

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
