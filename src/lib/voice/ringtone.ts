'use client';

/**
 * Synthesizes a smooth, pleasant, studio-filtered telephony ringback tone
 * using the Web Audio API (no external audio fetch delay; unlocks immediately
 * inside the user's "Call" click gesture).
 *
 * Uses the classic warm dual-tone ringback pair (440 Hz + 480 Hz) gently
 * rounded with a low-pass filter and soft attack/release envelopes to avoid
 * harshness or audio clicks.
 */

export interface CallRingtone {
  start: () => void;
  stop: (options?: { playChime?: boolean }) => void;
  dispose: () => void;
}

const RING_ON_SECONDS = 1.55;
const RING_CYCLE_MS = 3850; // 1.55s tone + 2.3s calm pause
const BASE_GAIN = 0.065;

export function createCallRingtone(): CallRingtone {
  let ctx: AudioContext | null = null;
  let masterGain: GainNode | null = null;
  let filter: BiquadFilterNode | null = null;
  let activeOscs: OscillatorNode[] = [];
  let timer: ReturnType<typeof setInterval> | null = null;
  let running = false;

  function ensureContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return null;

    if (!ctx || ctx.state === 'closed') {
      ctx = new AudioCtx();
      filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 1150;
      filter.Q.value = 0.55;

      masterGain = ctx.createGain();
      masterGain.gain.value = 1;

      filter.connect(masterGain);
      masterGain.connect(ctx.destination);
    }

    if (ctx.state === 'suspended') {
      void ctx.resume().catch(() => {});
    }
    return ctx;
  }

  function stopActiveOscillators(fadeSeconds = 0.055) {
    const audioCtx = ctx;
    const oscs = activeOscs;
    activeOscs = [];
    if (!audioCtx || !oscs.length) return;

    const now = audioCtx.currentTime;
    for (const osc of oscs) {
      try {
        osc.stop(now + fadeSeconds + 0.02);
      } catch {
        // Already stopped
      }
    }
  }

  function playBurst() {
    if (!running) return;
    const audioCtx = ensureContext();
    if (!audioCtx || !filter) return;

    const now = audioCtx.currentTime;
    const burstGain = audioCtx.createGain();
    burstGain.gain.setValueAtTime(0.0001, now);
    // Soft raised fade-in to eliminate clicks
    burstGain.gain.linearRampToValueAtTime(BASE_GAIN, now + 0.055);
    burstGain.gain.setValueAtTime(BASE_GAIN, now + RING_ON_SECONDS - 0.09);
    // Smooth exponential-like release
    burstGain.gain.linearRampToValueAtTime(0.0001, now + RING_ON_SECONDS);
    burstGain.connect(filter);

    const tones: Array<{ freq: number; gain: number }> = [
      { freq: 440, gain: 0.55 },
      { freq: 480, gain: 0.45 },
      // Subtle harmonic warmth (very quiet) so it sounds plush rather than thin
      { freq: 880, gain: 0.04 },
    ];

    const created: OscillatorNode[] = [];
    for (const tone of tones) {
      const osc = audioCtx.createOscillator();
      const oscGain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(tone.freq, now);
      oscGain.gain.setValueAtTime(tone.gain, now);
      osc.connect(oscGain);
      oscGain.connect(burstGain);
      osc.start(now);
      osc.stop(now + RING_ON_SECONDS + 0.03);
      created.push(osc);
    }

    activeOscs = created;
    created[0].onended = () => {
      try {
        burstGain.disconnect();
      } catch {
        // Ignore cleanup errors
      }
      activeOscs = activeOscs.filter((osc) => !created.includes(osc));
    };
  }

  function playConnectedChime() {
    const audioCtx = ensureContext();
    if (!audioCtx || !masterGain) return;

    const now = audioCtx.currentTime + 0.02;
    const notes = [523.25, 659.25]; // Soft C5 -> E5 ascending pickup cue

    notes.forEach((freq, idx) => {
      const start = now + idx * 0.085;
      const duration = 0.14;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, start);

      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.linearRampToValueAtTime(0.04, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(start);
      osc.stop(start + duration + 0.02);
    });
  }

  return {
    start() {
      if (running) return;
      const audioCtx = ensureContext();
      if (!audioCtx) return;

      running = true;
      if (masterGain) {
        const now = audioCtx.currentTime;
        masterGain.gain.cancelScheduledValues(now);
        masterGain.gain.setValueAtTime(1, now);
      }

      // Start the first ring almost immediately after call click
      playBurst();
      timer = setInterval(() => {
        if (running) playBurst();
      }, RING_CYCLE_MS);
    },

    stop(options) {
      const wasRunning = running;
      running = false;
      if (timer) {
        clearInterval(timer);
        timer = null;
      }

      if (ctx && masterGain && wasRunning) {
        const now = ctx.currentTime;
        masterGain.gain.cancelScheduledValues(now);
        masterGain.gain.setValueAtTime(masterGain.gain.value, now);
        masterGain.gain.linearRampToValueAtTime(0.0001, now + 0.06);
      }
      stopActiveOscillators(0.06);

      if (wasRunning && options?.playChime) {
        playConnectedChime();
      }
    },

    dispose() {
      this.stop();
      if (ctx && ctx.state !== 'closed') {
        void ctx.close().catch(() => {});
      }
      ctx = null;
      masterGain = null;
      filter = null;
    },
  };
}
