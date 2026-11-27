export type VoiceMode = 'livekit' | 'legacy';

export function normalizeVoiceMode(value?: string | null): VoiceMode {
  const normalized = (value ?? '')
    .trim()
    .replace(/^['"]|['"]$/g, '')
    .toLowerCase();
  return normalized === 'livekit' ? 'livekit' : 'legacy';
}

export function getClientVoiceMode(): VoiceMode {
  return normalizeVoiceMode(process.env.NEXT_PUBLIC_VOICE_MODE);
}

export function getServerVoiceMode(): VoiceMode {
  const key = 'NEXT_PUBLIC_VOICE_MODE';
  const runtimeValue = process.env[key];
  return normalizeVoiceMode(runtimeValue ?? process.env.NEXT_PUBLIC_VOICE_MODE);
}
