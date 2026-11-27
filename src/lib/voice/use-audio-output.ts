'use client';

import { useCallback, useEffect, useState } from 'react';

export interface AudioOutputDevice {
  deviceId: string;
  label: string;
}

/**
 * Manages audio output routing when supported by the browser and device
 * (setSinkId + multiple audiooutput devices), and gracefully falls back to
 * local agent playback mute/unmute when output routing is unavailable.
 */
export function useAudioOutputControl() {
  const [outputDevices, setOutputDevices] = useState<AudioOutputDevice[]>([]);
  const [activeDeviceId, setActiveDeviceId] = useState<string>('default');
  const [agentAudioMuted, setAgentAudioMuted] = useState(false);

  const supportsSinkId =
    typeof window !== 'undefined' &&
    typeof HTMLMediaElement !== 'undefined' &&
    'setSinkId' in HTMLMediaElement.prototype;

  const refreshOutputs = useCallback(async () => {
    if (!supportsSinkId || !navigator.mediaDevices?.enumerateDevices) {
      setOutputDevices([]);
      return;
    }
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const outputs = devices
        .filter((d) => d.kind === 'audiooutput' && d.deviceId)
        .map((d, idx) => ({
          deviceId: d.deviceId,
          label: d.label || (idx === 0 ? 'Default speaker' : `Speaker ${idx + 1}`),
        }));
      setOutputDevices(outputs);
    } catch {
      setOutputDevices([]);
    }
  }, [supportsSinkId]);

  useEffect(() => {
    void refreshOutputs();
    const mediaDevices = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;
    if (!mediaDevices?.addEventListener) return;
    const onDeviceChange = () => void refreshOutputs();
    mediaDevices.addEventListener('devicechange', onDeviceChange);
    return () => mediaDevices.removeEventListener('devicechange', onDeviceChange);
  }, [refreshOutputs]);

  const canSwitchOutput = supportsSinkId && outputDevices.length > 1;
  const activeOutput =
    outputDevices.find((d) => d.deviceId === activeDeviceId) ?? outputDevices[0] ?? null;

  const handleSpeakerAction = useCallback(
    async (applySinkId?: (deviceId: string) => Promise<void> | void) => {
      if (canSwitchOutput && applySinkId) {
        const currentIdx = outputDevices.findIndex((d) => d.deviceId === activeDeviceId);
        const nextDevice = outputDevices[(currentIdx + 1) % outputDevices.length];
        if (nextDevice) {
          try {
            await applySinkId(nextDevice.deviceId);
            setActiveDeviceId(nextDevice.deviceId);
            return { switchedTo: nextDevice.label, muted: agentAudioMuted };
          } catch {
            // Fall through to local mute toggle if browser rejects setSinkId
          }
        }
      }

      const nextMuted = !agentAudioMuted;
      setAgentAudioMuted(nextMuted);
      return { switchedTo: null, muted: nextMuted };
    },
    [activeDeviceId, agentAudioMuted, canSwitchOutput, outputDevices]
  );

  const ariaLabel = canSwitchOutput
    ? `Switch audio output (current: ${activeOutput?.label ?? 'Default speaker'})`
    : agentAudioMuted
      ? 'Unmute agent audio'
      : 'Mute agent audio';

  return {
    canSwitchOutput,
    activeOutputLabel: activeOutput?.label ?? 'Default speaker',
    agentAudioMuted,
    setAgentAudioMuted,
    refreshOutputs,
    handleSpeakerAction,
    ariaLabel,
  };
}
