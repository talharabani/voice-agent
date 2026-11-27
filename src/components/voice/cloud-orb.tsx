'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';
import { cn } from '@/lib/utils';

export type CloudOrbPhase =
  | 'idle'
  | 'connecting'
  | 'ringing'
  | 'listening'
  | 'customer-speaking'
  | 'thinking'
  | 'speaking';

const VERT_SRC = /* glsl */ `
  attribute vec2 aPos;
  varying vec2 vUv;
  void main() {
    vUv = aPos * 0.5 + 0.5;
    gl_Position = vec4(aPos, 0.0, 1.0);
  }
`;

const FRAG_SRC = /* glsl */ `
  precision highp float;
  varying vec2 vUv;

  uniform float uTime;
  uniform float uEnergy;      // 0..1 combined voice energy
  uniform float uAgent;       // 0..1 agent speaking presence
  uniform float uCaller;      // 0..1 caller speaking presence
  uniform float uConnect;     // 0..1 connecting/ringing pulse

  float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }

  float fbm(vec2 p) {
    float v = 0.0;
    float amp = 0.52;
    mat2 rot = mat2(0.82, -0.57, 0.57, 0.82);
    for (int i = 0; i < 5; i++) {
      v += amp * noise(p);
      p = rot * p * 2.02 + vec2(1.7, 9.2);
      amp *= 0.5;
    }
    return v;
  }

  void main() {
    vec2 uv = vUv;
    vec2 centered = uv - 0.5;
    float r = length(centered);

    // Diagonal wind-swept coordinate frame matching the serene sage-cloud mockup
    float angle = -0.58;
    mat2 windRot = mat2(cos(angle), -sin(angle), sin(angle), cos(angle));
    vec2 p = windRot * (centered * 2.45);
    p.x *= 0.72; // Elongate wisps diagonally like soft cirrus clouds

    float drift = uTime;
    vec2 flow = vec2(drift * 0.14, drift * 0.05);

    // Two-stage domain-warped FBM for organic billowing cloud wisps
    vec2 q = vec2(
      fbm(p + flow + vec2(0.0, 0.0)),
      fbm(p - flow * 0.65 + vec2(5.2, 1.3))
    );

    float warpStrength = 0.85 + uEnergy * 0.55 + uAgent * 0.35;
    vec2 w = vec2(
      fbm(p + warpStrength * q + vec2(1.7, 9.2) + vec2(drift * 0.08, -drift * 0.04)),
      fbm(p + warpStrength * q + vec2(8.3, 2.8) - vec2(drift * 0.06, drift * 0.05))
    );

    float cloud = fbm(p + (0.95 + uEnergy * 0.45) * w);

    // Soft sky-to-cloud directional gradient: deeper botanical sage upper-right, luminous cream clouds lower-left
    float skyGrad = smoothstep(-0.55, 0.65, centered.x * 0.65 + centered.y * 0.85);
    float wispMask = smoothstep(0.32, 0.82, cloud + (1.0 - skyGrad) * 0.22 + uEnergy * 0.14);
    float brightWisp = smoothstep(0.56, 0.92, cloud + (1.0 - skyGrad) * 0.18 + uAgent * 0.12 + uEnergy * 0.12);

    // Palette directly matched to the mockup's sage green & warm cream clouds
    vec3 deepSage   = vec3(0.325, 0.435, 0.365); // #536F5D
    vec3 midSage    = vec3(0.525, 0.625, 0.530); // #869F87
    vec3 softMist   = vec3(0.755, 0.795, 0.695); // #C1CBB1
    vec3 warmCream  = vec3(0.945, 0.922, 0.855); // #F1EBDA
    vec3 callerTint = vec3(0.450, 0.690, 0.585); // Subtle fresh sage-mint bloom when caller speaks

    vec3 sky = mix(midSage, deepSage, skyGrad);
    sky = mix(sky, callerTint, uCaller * 0.24);

    vec3 col = mix(sky, softMist, smoothstep(0.18, 0.65, wispMask));
    col = mix(col, warmCream, brightWisp * (0.86 + uEnergy * 0.14));

    // Gentle luminous pulse when agent speaks or while connecting
    float centerGlow = exp(-r * r * 5.2);
    col += warmCream * centerGlow * (uAgent * (0.08 + uEnergy * 0.16) + uConnect * 0.08);

    // Very subtle soft spherical vignette so the circle feels plush and dimensional
    float edgeSoft = smoothstep(0.52, 0.32, r);
    col = mix(col * 0.94, col, edgeSoft);

    gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
  }
`;

function compileShader(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

export function CloudOrb({
  phase,
  muted,
  micLevelRef,
  agentLevelRef,
  className,
}: {
  phase: CloudOrbPhase;
  muted?: boolean;
  micLevelRef?: RefObject<number>;
  agentLevelRef?: RefObject<number>;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const phaseRef = useRef(phase);
  const mutedRef = useRef(Boolean(muted));
  const micRef = useRef(micLevelRef);
  const agentRef = useRef(agentLevelRef);
  const [webglFailed, setWebglFailed] = useState(false);

  phaseRef.current = phase;
  mutedRef.current = Boolean(muted);
  micRef.current = micLevelRef;
  agentRef.current = agentLevelRef;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const gl = canvas.getContext('webgl', {
      alpha: false,
      antialias: true,
      depth: false,
      stencil: false,
      powerPreference: 'default',
    });

    if (!gl) {
      setWebglFailed(true);
      return;
    }

    const vert = compileShader(gl, gl.VERTEX_SHADER, VERT_SRC);
    const frag = compileShader(gl, gl.FRAGMENT_SHADER, FRAG_SRC);
    if (!vert || !frag) {
      setWebglFailed(true);
      return;
    }

    const program = gl.createProgram();
    if (!program) {
      setWebglFailed(true);
      return;
    }
    gl.attachShader(program, vert);
    gl.attachShader(program, frag);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      gl.deleteProgram(program);
      setWebglFailed(true);
      return;
    }

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW
    );

    gl.useProgram(program);
    const posLoc = gl.getAttribLocation(program, 'aPos');
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    const uTime = gl.getUniformLocation(program, 'uTime');
    const uEnergy = gl.getUniformLocation(program, 'uEnergy');
    const uAgent = gl.getUniformLocation(program, 'uAgent');
    const uCaller = gl.getUniformLocation(program, 'uCaller');
    const uConnect = gl.getUniformLocation(program, 'uConnect');

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cssSize = Math.max(canvas.clientWidth || 240, 220);
    const pixelSize = Math.round(cssSize * dpr);
    canvas.width = pixelSize;
    canvas.height = pixelSize;
    gl.viewport(0, 0, pixelSize, pixelSize);

    let rafId = 0;
    let lastTs = performance.now();
    let simTime = 3.2; // Start on a balanced painterly cloud composition
    let smoothEnergy = 0;
    let smoothAgent = 0;
    let smoothCaller = 0;
    let smoothConnect = 0;
    let smoothScale = 1;

    const renderFrame = (now: number) => {
      const dt = Math.min((now - lastTs) / 1000, 0.05);
      lastTs = now;

      const p = phaseRef.current;
      const isMuted = mutedRef.current;
      const rawMic = micRef.current?.current ?? 0;
      const rawAgent = agentRef.current?.current ?? 0;
      const micLvl = Number.isFinite(rawMic) ? Math.min(Math.max(rawMic, 0), 1) : 0;
      const agentLvl = Number.isFinite(rawAgent) ? Math.min(Math.max(rawAgent, 0), 1) : 0;

      const isConnecting = p === 'connecting' || p === 'ringing';
      const isAgentSpeaking = p === 'speaking';
      const isCallerSpeaking = p === 'customer-speaking' && !isMuted;
      const isListening = p === 'listening' && !isMuted;
      const isThinking = p === 'thinking';

      const targetAgent = isAgentSpeaking ? 1 : 0;
      const targetCaller = isCallerSpeaking ? 1 : isListening ? Math.min(micLvl * 2.2, 0.85) : 0;
      const targetConnect = isConnecting ? 0.5 + 0.5 * Math.sin(now * 0.0022) : 0;

      let targetEnergy = 0;
      if (isAgentSpeaking) {
        // Follow real playing audio closely; gently sustain between syllables
        targetEnergy = agentLvl > 0.015
          ? Math.min(1, Math.pow(agentLvl, 0.68) * 1.35)
          : 0.24 + 0.14 * Math.sin(now * 0.006);
      } else if (isCallerSpeaking) {
        targetEnergy = Math.min(1, 0.22 + Math.pow(Math.max(micLvl, 0.08), 0.7) * 1.25);
      } else if (isListening) {
        targetEnergy = Math.min(0.8, Math.pow(micLvl, 0.75) * 1.1);
      } else if (isConnecting) {
        targetEnergy = 0.16 + 0.14 * (0.5 + 0.5 * Math.sin(now * 0.0022));
      } else if (isThinking) {
        targetEnergy = 0.18 + 0.08 * Math.sin(now * 0.003);
      }

      // Smooth interpolation for silky, natural motion
      const attack = targetEnergy > smoothEnergy ? 0.22 : 0.09;
      smoothEnergy += (targetEnergy - smoothEnergy) * attack;
      smoothAgent += (targetAgent - smoothAgent) * 0.1;
      smoothCaller += (targetCaller - smoothCaller) * 0.12;
      smoothConnect += (targetConnect - smoothConnect) * 0.1;

      // Advance cloud flow organically based on call state and voice energy
      const speed = reducedMotion
        ? 0
        : isAgentSpeaking
          ? 1.15 + smoothEnergy * 1.95
          : isCallerSpeaking
            ? 0.95 + smoothEnergy * 1.5
            : isThinking
              ? 0.85
              : isConnecting
                ? 0.65
                : p === 'listening'
                  ? 0.45 + smoothEnergy * 1.1
                  : 0.28;
      simTime += dt * speed;

      // Subtle breathing & voice-synced pulse on the circular orb container
      let targetScale = 1;
      if (!reducedMotion) {
        if (isAgentSpeaking) {
          targetScale = 1 + 0.014 + smoothEnergy * 0.062;
        } else if (isCallerSpeaking) {
          targetScale = 1 + 0.01 + smoothEnergy * 0.05;
        } else if (isConnecting) {
          targetScale = 1 + 0.022 * (0.5 + 0.5 * Math.sin(now * 0.0024));
        } else if (isListening || isThinking) {
          // Calm gentle breathing during quiet moments
          targetScale = 1 + 0.014 * (0.5 + 0.5 * Math.sin(now * 0.0016)) + smoothEnergy * 0.035;
        } else if (p === 'idle') {
          targetScale = 1 + 0.008 * (0.5 + 0.5 * Math.sin(now * 0.0012));
        }
      }
      smoothScale += (targetScale - smoothScale) * 0.14;

      if (shellRef.current) {
        shellRef.current.style.transform = reducedMotion
          ? 'scale(1)'
          : `scale(${smoothScale.toFixed(4)})`;
      }

      gl.uniform1f(uTime, simTime);
      gl.uniform1f(uEnergy, smoothEnergy);
      gl.uniform1f(uAgent, smoothAgent);
      gl.uniform1f(uCaller, smoothCaller);
      gl.uniform1f(uConnect, smoothConnect);
      gl.drawArrays(gl.TRIANGLES, 0, 6);

      if (!reducedMotion) {
        rafId = requestAnimationFrame(renderFrame);
      }
    };

    rafId = requestAnimationFrame(renderFrame);

    return () => {
      cancelAnimationFrame(rafId);
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      gl.deleteShader(vert);
      gl.deleteShader(frag);
    };
  }, []);

  return (
    <div
      ref={shellRef}
      className={cn(
        'relative size-[224px] overflow-hidden rounded-full shadow-[0_18px_48px_rgba(78,104,90,0.16)] will-change-transform sm:size-[252px]',
        className
      )}
      aria-hidden="true"
    >
      {webglFailed ? (
        <div className="cloud-orb-fallback size-full" data-phase={phase} />
      ) : (
        <canvas ref={canvasRef} className="block size-full" />
      )}
    </div>
  );
}
