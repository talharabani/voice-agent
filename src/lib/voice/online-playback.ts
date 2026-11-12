import type { CallLanguage } from './language';

const silence = 'data:audio/wav;base64,UklGRiYAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQIAAAAAAA==';
export async function primeSpeaker(audio: HTMLAudioElement) {
  audio.src = silence; audio.muted = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { await Promise.race([audio.play().catch(() => {}), new Promise<void>(resolve => { timer = setTimeout(resolve, 400); })]); }
  finally { clearTimeout(timer); }
  audio.pause(); audio.muted = false;
}

type SpeechRequest = { text: string; language: CallLanguage; style: string; token?: string; agentId?: string; signal: AbortSignal };
export async function prepareSpeechAudio({ text, language, style, token, agentId, signal }: SpeechRequest) {
  const response = await fetch('/api/voice/speech', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, language, style, ...(token ? { token } : { agent_id: agentId }) }),
    signal: AbortSignal.any([signal, AbortSignal.timeout(14000)]),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.error || 'Urdu speaker service is unavailable. Keep the laptop voice helper running.');
  }
  if (!response.headers.get('content-type')?.includes('audio/')) throw new Error('The speech service did not return audio.');
  const blob = await response.blob();
  if (!blob.size || blob.size > 2_000_000) throw new Error('The generated speech audio was empty or too large.');
  if (signal.aborted) throw new DOMException('Speech interrupted', 'AbortError');
  return blob;
}

export async function playOnlineSpeech({ audio, text, language, style, token, agentId, signal, onStart, prepared }: SpeechRequest & {
  audio: HTMLAudioElement; onStart?: () => void; prepared?: Promise<Blob>;
}) {
  const blob = await (prepared || prepareSpeechAudio({ text, language, style, token, agentId, signal }));
  if (signal.aborted) throw new DOMException('Speech interrupted', 'AbortError');
  const url = URL.createObjectURL(blob);
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    let finishTimer: ReturnType<typeof setTimeout> | undefined;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true; clearTimeout(startTimer); clearTimeout(finishTimer);
      signal.removeEventListener('abort', abort);
      audio.onplaying = null; audio.onended = null; audio.onerror = null;
      audio.pause(); audio.removeAttribute('src'); audio.load(); URL.revokeObjectURL(url);
      if (error) reject(error); else resolve();
    };
    const abort = () => finish(new DOMException('Speech interrupted', 'AbortError'));
    const startTimer = setTimeout(() => finish(new Error('Speaker audio did not start. Tap Enable audio / replay.')), 4500);
    signal.addEventListener('abort', abort, { once: true });
    audio.onplaying = () => {
      clearTimeout(startTimer); onStart?.();
      finishTimer = setTimeout(() => finish(new Error('Audio playback stalled. Please replay the reply.')), Math.min(90000, Math.max(10000, (audio.duration || text.length / 10) * 1000 + 5000)));
    };
    audio.onended = () => finish();
    audio.onerror = () => finish(new Error('Audio decoding failed. Please replay the reply.'));
    audio.src = url; audio.muted = false;
    audio.play().catch(() => finish(new Error('Speaker playback was blocked. Tap Enable audio / replay.')));
  });
}
