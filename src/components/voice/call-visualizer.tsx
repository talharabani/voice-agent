'use client';

import { useMemo } from 'react';
import { cn } from '@/lib/utils';

export type VisualizerMode =
  | 'idle'
  | 'connecting'
  | 'ringing'
  | 'silence'
  | 'customer-speaking'
  | 'agent-speaking'
  | 'thinking'
  | 'muted'
  | 'ended';

const DEFAULT_BAR_COUNT = 11;

/**
 * Sleek, fluid pill-bar audio visualizer with distinct visual character per state:
 * - Live multiband FFT bars when customer or agent is speaking (with live bands)
 * - Smooth pure-CSS fluid waves for connecting, ringing, thinking, and calm silence
 *   (no inline-transform vs CSS-keyframe fighting!)
 */
export function CallVisualizer({
  mode,
  bands,
  className,
}: {
  mode: VisualizerMode;
  bands?: number[];
  className?: string;
}) {
  const isLiveReactive =
    Boolean(bands && bands.length > 0) &&
    (mode === 'customer-speaking' || mode === 'agent-speaking');

  // Downsample any incoming bands cleanly to 11 balanced bars
  const liveBars = useMemo(() => {
    if (!isLiveReactive || !bands || !bands.length) return null;
    const count = DEFAULT_BAR_COUNT;
    const center = (count - 1) / 2;
    return Array.from({ length: count }, (_, i) => {
      const srcIdx = Math.min(bands.length - 1, Math.floor((i / count) * bands.length));
      const raw = Number.isFinite(bands[srcIdx]) ? Math.min(Math.max(bands[srcIdx], 0), 1) : 0;
      const dist = Math.abs(i - center) / Math.max(center, 1);
      const arch = 1 - dist * 0.42;
      return Math.min(1, Math.max(0.18, 0.2 + Math.pow(raw, 0.7) * 0.85 * (0.65 + arch * 0.4)));
    });
  }, [bands, isLiveReactive]);

  const barColor =
    mode === 'customer-speaking'
      ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.45)]'
      : mode === 'agent-speaking'
        ? 'bg-[#4E8B63] shadow-[0_0_8px_rgba(78,139,99,0.4)]'
        : mode === 'ringing' || mode === 'connecting'
          ? 'bg-amber-500'
          : mode === 'thinking'
            ? 'bg-sky-600/80'
            : mode === 'muted' || mode === 'ended' || mode === 'idle'
              ? 'bg-brand-muted/35'
              : 'bg-brand-teal/70';

  const pillSurface =
    mode === 'customer-speaking'
      ? 'border-emerald-500/30 bg-emerald-500/[0.07]'
      : mode === 'agent-speaking'
        ? 'border-brand-teal/40 bg-brand-teal/[0.1]'
        : mode === 'ringing' || mode === 'connecting'
          ? 'border-amber-500/35 bg-amber-500/[0.08]'
          : mode === 'thinking'
            ? 'border-sky-600/30 bg-sky-500/[0.07]'
            : 'border-brand-border/80 bg-brand-surface-raised/85';

  const animClass = isLiveReactive
    ? ''
    : mode === 'agent-speaking'
      ? 'call-viz-agent'
      : mode === 'customer-speaking'
        ? 'call-viz-customer'
        : mode === 'ringing'
          ? 'call-viz-ringing'
          : mode === 'connecting'
            ? 'call-viz-connecting'
            : mode === 'thinking'
              ? 'call-viz-thinking'
              : mode === 'silence'
                ? 'call-viz-calm'
                : '';

  const center = (DEFAULT_BAR_COUNT - 1) / 2;

  return (
    <div
      className={cn(
        'inline-flex h-10 items-center justify-center gap-[5px] rounded-full border px-4 backdrop-blur-xs transition-colors duration-300',
        pillSurface,
        className
      )}
      aria-hidden="true"
    >
      {Array.from({ length: DEFAULT_BAR_COUNT }, (_, i) => {
        const dist = Math.abs(i - center) / Math.max(center, 1);
        const maxBarPx = Math.round(24 - dist * 8); // Symmetric smooth pill arch (16px..24px)
        const liveScale = liveBars ? liveBars[i] : null;
        const staticScale = mode === 'idle' || mode === 'ended' || mode === 'muted' ? 0.28 : undefined;

        return (
          <span
            key={i}
            className={cn(
              'w-[4px] rounded-full transition-[transform,background-color] duration-100 ease-out will-change-transform',
              barColor,
              animClass
            )}
            style={{
              height: `${maxBarPx}px`,
              ...(liveScale !== null
                ? { transform: `scaleY(${liveScale.toFixed(3)})` }
                : staticScale !== undefined
                  ? { transform: `scaleY(${staticScale})` }
                  : { animationDelay: `${(i * 0.08).toFixed(2)}s` }),
            }}
          />
        );
      })}
    </div>
  );
}
