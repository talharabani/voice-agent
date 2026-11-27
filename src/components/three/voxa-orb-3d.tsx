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
  varying float vWave;

  void main() {
    // Smooth, subtle liquid silk ripple — keeps a crisp, refined sphere silhouette without lumpy distortion
    float w1 = sin(position.y * 2.4 + uTime * 1.9) * cos(position.x * 2.1 - uTime * 1.4);
    float w2 = sin(position.z * 2.8 - uTime * 1.6) * 0.5;
    float wave = (w1 + w2) * 0.65;
    float disp = wave * (0.012 + uIntensity * 0.068);

    vec3 displaced = position + normal * disp;
    vWave = wave;
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
  uniform vec3 uAccent;
  varying vec3 vNormal;
  varying vec3 vWorldPos;
  varying float vWave;

  void main() {
    vec3 N = normalize(vNormal);
    vec3 V = normalize(cameraPosition - vWorldPos);
    float ndotv = max(dot(N, V), 0.0);
    float fresnel = pow(1.0 - ndotv, 2.4);

    // Dual studio lighting for a soft glass/pearl finish
    vec3 keyLight = normalize(vec3(-0.45, 0.75, 0.8));
    vec3 fillLight = normalize(vec3(0.6, -0.35, 0.5));
    float keyDiff = max(dot(N, keyLight), 0.0);
    float fillDiff = max(dot(N, fillLight), 0.0);

    vec3 halfVec = normalize(keyLight + V);
    float spec = pow(max(dot(N, halfVec), 0.0), 28.0) * 0.32;

    float grad = smoothstep(-0.85, 0.85, vWave) * 0.55 + keyDiff * 0.45;
    vec3 base = mix(uSecondary, uPrimary, clamp(grad, 0.0, 1.0));
    base = mix(base, uAccent, fillDiff * 0.25 + uIntensity * 0.14);

    vec3 rimColor = mix(uAccent, vec3(0.98, 0.97, 0.94), 0.58);
    vec3 color = base * (0.68 + keyDiff * 0.36) + rimColor * fresnel * (0.58 + uIntensity * 0.35) + vec3(1.0) * spec;

    gl_FragColor = vec4(color, 1.0);
  }
`

// Rich, luminous studio palettes tuned for VOXA's warm cream canvas
const PALETTE = {
  idle: {
    primary: new THREE.Color('#6FA07A'),
    secondary: new THREE.Color('#2F5B44'),
    accent: new THREE.Color('#C7DFB8'),
  },
  ringing: {
    primary: new THREE.Color('#E8A648'),
    secondary: new THREE.Color('#9A5B1A'),
    accent: new THREE.Color('#FCE3B4'),
  },
  customer: {
    primary: new THREE.Color('#22B086'),
    secondary: new THREE.Color('#0E5E4B'),
    accent: new THREE.Color('#A7F3D0'),
  },
  agent: {
    primary: new THREE.Color('#7EB87F'),
    secondary: new THREE.Color('#255846'),
    accent: new THREE.Color('#E6F0C2'),
  },
  thinking: {
    primary: new THREE.Color('#5388A6'),
    secondary: new THREE.Color('#234663'),
    accent: new THREE.Color('#C5E4F3'),
  },
  muted: {
    primary: new THREE.Color('#8A8F84'),
    secondary: new THREE.Color('#51564E'),
    accent: new THREE.Color('#C8CCC2'),
  },
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

    const size = Math.min(host.clientWidth || 216, host.clientHeight || 216)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75))
    renderer.setSize(size, size)
    renderer.domElement.style.width = '100%'
    renderer.domElement.style.height = '100%'
    renderer.domElement.style.display = 'block'
    host.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    // Pull camera back comfortably so the sphere NEVER clips at any scale or wave displacement
    const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 50)
    camera.position.set(0, 0, 4.7)

    const orbGeo = new THREE.IcosahedronGeometry(0.96, 20)
    const curPrimary = PALETTE.idle.primary.clone()
    const curSecondary = PALETTE.idle.secondary.clone()
    const curAccent = PALETTE.idle.accent.clone()

    const uniforms = {
      uTime: { value: 0 },
      uIntensity: { value: 0.1 },
      uPrimary: { value: curPrimary },
      uSecondary: { value: curSecondary },
      uAccent: { value: curAccent },
    }
    const orbMat = new THREE.ShaderMaterial({
      vertexShader: ORB_VERTEX,
      fragmentShader: ORB_FRAGMENT,
      uniforms,
    })
    const orbMesh = new THREE.Mesh(orbGeo, orbMat)
    scene.add(orbMesh)

    const pointer = new THREE.Vector2(0, 0)
    const onPointerMove = (e: PointerEvent) => {
      const rect = host.getBoundingClientRect()
      if (!rect.width || !rect.height) return
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
      pointer.y = -(((e.clientY - rect.top) / rect.height) * 2 - 1)
    }
    host.addEventListener('pointermove', onPointerMove, { passive: true })

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

      const targetPalette = isMuted || p === 'ended'
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
      curAccent.lerp(targetPalette.accent, 0.08)

      let targetIntensity = 0.08
      if (isAgentSpeaking) {
        targetIntensity = audioLevel > 0.02
          ? 0.35 + audioLevel * 0.8
          : 0.52 + Math.sin(elapsed * 5.2) * 0.18
      } else if (isCustomerSpeaking) {
        targetIntensity = 0.3 + Math.max(audioLevel, 0.16) * 0.9
      } else if (isRinging) {
        const cycle = (elapsed % 3.85) / 3.85
        targetIntensity = cycle < 0.42 ? 0.3 + Math.sin(elapsed * 7) * 0.12 : 0.08
      } else if (isConnecting) {
        targetIntensity = 0.24 + Math.sin(elapsed * 3.8) * 0.08
      } else if (isThinking) {
        targetIntensity = 0.28 + Math.sin(elapsed * 2.8) * 0.08
      } else if (isListening) {
        targetIntensity = 0.12 + audioLevel * 0.85 + Math.sin(elapsed * 1.6) * 0.025
      } else if (isMuted || p === 'ended') {
        targetIntensity = 0.03
      }

      smoothIntensity = THREE.MathUtils.lerp(smoothIntensity, targetIntensity, 0.13)
      const timeScale = isAgentSpeaking
        ? 1.7
        : isCustomerSpeaking
          ? 1.45
          : isThinking || isConnecting
            ? 1.25
            : isRinging
              ? 1.0
              : 0.65
      uniforms.uTime.value = elapsed * timeScale
      uniforms.uIntensity.value = smoothIntensity

      // Subtle, controlled breathing scale (1.00 - 1.07) so it always stays crisply framed
      const scale = 1 + Math.min(smoothIntensity, 1) * 0.075
      orbMesh.scale.setScalar(scale)
      orbMesh.rotation.y = elapsed * 0.2 + pointer.x * 0.35
      orbMesh.rotation.x = pointer.y * 0.25

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
      renderer.dispose()
      if (renderer.domElement.parentNode === host) {
        host.removeChild(renderer.domElement)
      }
    }
  }, [])

  if (fallback) {
    return (
      <div className="voice-orb">
        <AudioLines className={`relative z-10 size-14 stroke-[1.2] text-white/85 ${phase === 'thinking' ? 'animate-pulse' : ''}`} />
      </div>
    )
  }

  return (
    <div ref={hostRef} className="relative z-10 size-[216px] cursor-grab active:cursor-grabbing" />
  )
}
