'use client'

import { useRef, useState, type ReactNode } from 'react'

export function TiltCard3D({
  children,
  className = '',
  intensity = 10,
}: {
  children: ReactNode
  className?: string
  intensity?: number
}) {
  const cardRef = useRef<HTMLDivElement>(null)
  const [transform, setTransform] = useState('perspective(1000px) rotateX(0deg) rotateY(0deg) translateZ(0px)')
  const [glare, setGlare] = useState({ x: 50, y: 50, opacity: 0 })

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return
    }
    const el = cardRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    if (!rect.width || !rect.height) return

    const px = (e.clientX - rect.left) / rect.width
    const py = (e.clientY - rect.top) / rect.height
    const rotateY = (px - 0.5) * intensity * 2
    const rotateX = (0.5 - py) * intensity * 2

    setTransform(`perspective(1000px) rotateX(${rotateX.toFixed(2)}deg) rotateY(${rotateY.toFixed(2)}deg) translateZ(8px)`)
    setGlare({ x: px * 100, y: py * 100, opacity: 0.16 })
  }

  function handlePointerLeave() {
    setTransform('perspective(1000px) rotateX(0deg) rotateY(0deg) translateZ(0px)')
    setGlare((prev) => ({ ...prev, opacity: 0 }))
  }

  return (
    <div
      ref={cardRef}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
      style={{ transform, transformStyle: 'preserve-3d', touchAction: 'pan-y' }}
      className={`relative transition-transform duration-200 ease-out will-change-transform ${className}`}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-10 transition-opacity duration-200"
        style={{
          opacity: glare.opacity,
          background: `radial-gradient(circle at ${glare.x}% ${glare.y}%, rgba(255,255,255,0.65), transparent 60%)`,
        }}
      />
      {children}
    </div>
  )
}
