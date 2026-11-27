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

const DEFAULT_BAR_COUNT = 17;

/**
 * Smooth, GPU-accelerated call audio visualizer that adapts cleanly across
 * every call state: connecting, ringing, customer speaking, agent speaking,
 * thinking, silence, and muted.
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
  const barCount = bands?.length || DEFAULT_BAR_COUNT;

  const normalizedBars = useMemo(() => {
    const center = (barCount - 1) / 2;
    return Array.from({ length: barCount }, (_, i) => {
      const dist = Math.abs(i - center) / Math.max(center, 1);
      const arch = 1 - dist * 0.58; // Natural symmetric envelope

      if (bands && bands.length === barCount && (mode === 'customer-speaking' || mode === 'agent-speaking')) {
        const raw = Number.isFinite(bands[i]) ? Math.min(Math.max(bands[i], 0), 1) : 0;
        // Lift subtle speech smoothly while keeping center bars slightly taller
        return Math.min(1, Math.max(0.14, 0.16 + Math.pow(raw, 0.72) * 0.92 * (0.65 + arch * 0.45)));
      }

      if (mode === 'agent-speaking') {
        return Math.min(1, 0.28 + arch * 0.62);
      }
      if (mode === 'customer-speaking') {
        return Math.min(1, 0.24 + arch * 0.58);
      }
      if (mode === 'ringing' || mode === 'connecting') {
        return 0.22 + arch * 0.34;
      }
      if (mode === 'thinking') {
        return 0.2 + arch * 0.26;
      }
      if (mode === 'silence') {
        return 0.14 + arch * 0.12;
      }
      return 0.12;
    });
  }, [bands, barCount, mode]);

  const isLiveReactive =
    Boolean(bands && bands.length === barCount) &&
    (mode === 'customer-speaking' || mode === 'agent-speaking');

  const barColor =
    mode === 'customer-speaking'
      ? 'bg-emerald-600'
      : mode === 'agent-speaking'
        ? 'bg-brand-teal'
        : mode === 'ringing' || mode === 'connecting'
          ? 'bg-amber-600/80'
          : mode === 'thinking'
            ? 'bg-brand-text/55'
            : mode === 'muted' || mode === 'ended' || mode === 'idle'
              ? 'bg-brand-muted/35'
              : 'bg-brand-teal/55';

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

  return (
    <div
      className={cn(
        'flex h-10 items-center justify-center gap-[4px] px-2',
        className
      )}
      aria-hidden="true"
    >
      {normalizedBars.map((scale, i) => (
        <span
          key={i}
          className={cn(
            'w-[3.5px] rounded-full transition-[transform,background-color] duration-100 ease-out will-change-transform',
            barColor,
            animClass
          )}
          style={{
            height: '36px',
            transform: `scaleY(${scale.toFixed(3)})`,
            animationDelay: `${(i * 0.055).toFixed(3)}s`,
          }}
        />
      ))}
    </div>
  );
}
