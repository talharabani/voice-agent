'use client';

import dynamic from 'next/dynamic';
import type { RefObject } from 'react';
import type { OrbPhase } from '@/components/three/voxa-orb-3d';

const LazyVoxaOrb3D = dynamic(
  () => import('@/components/three/voxa-orb-3d').then((mod) => mod.VoxaOrb3D),
  {
    ssr: false,
    loading: () => (
      <div
        className="voice-orb relative z-10 animate-pulse"
        aria-hidden="true"
      />
    ),
  }
);

export function CallOrb({
  phase,
  muted,
  previewAudible,
  audioLevelRef,
}: {
  phase: OrbPhase;
  muted?: boolean;
  previewAudible?: boolean;
  audioLevelRef?: RefObject<number>;
}) {
  return (
    <LazyVoxaOrb3D
      phase={phase}
      muted={muted}
      previewAudible={previewAudible}
      audioLevelRef={audioLevelRef}
    />
  );
}
