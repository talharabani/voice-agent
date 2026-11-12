import { languageLocales, type CallLanguage } from './language';
import { selectBrowserVoice } from './presets';

export class SpeechPlaybackError extends Error {
  constructor(message: string, public code: string) { super(message); this.name = 'SpeechPlaybackError'; }
}

export async function playBrowserSpeech({ text, language, preset, voiceUri = '', signal, onStart }: {
  text: string; language: CallLanguage; preset: string; voiceUri?: string;
  signal: AbortSignal; onStart?: () => void;
}) {
  const synth = window.speechSynthesis;
  if (!synth) throw new SpeechPlaybackError('This browser does not support speaker audio.', 'unsupported');
  if (signal.aborted) throw new DOMException('Speech interrupted', 'AbortError');
  if (!synth.getVoices().length) {
    await new Promise<void>(resolve => {
      const done = () => { clearTimeout(timer); synth.removeEventListener('voiceschanged', done); signal.removeEventListener('abort', done); resolve(); };
      const timer = setTimeout(done, 1200);
      synth.addEventListener('voiceschanged', done); signal.addEventListener('abort', done, { once: true });
    });
  }
  if (signal.aborted) throw new DOMException('Speech interrupted', 'AbortError');
  const selection = selectBrowserVoice(synth.getVoices(), language, preset, voiceUri);
  if (!selection.voice) throw new SpeechPlaybackError(`This device has no ${language === 'ur' ? 'Urdu' : language === 'pa' ? 'Punjabi' : language === 'hi' ? 'Hindi' : 'English'} speaker voice. The reply was generated, but this browser cannot speak it.`, 'language-unavailable');
  return new Promise<void>((resolve, reject) => {
    synth.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.voice = selection.voice; utterance.lang = languageLocales[language];
    utterance.rate = selection.preset.rate; utterance.pitch = selection.preset.pitch;
    let settled = false;
    let finishTimer: ReturnType<typeof setTimeout> | undefined;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true; clearTimeout(startTimer); clearTimeout(finishTimer);
      signal.removeEventListener('abort', abort);
      utterance.onstart = null; utterance.onend = null; utterance.onerror = null;
      if (error) { synth.cancel(); reject(error); } else resolve();
    };
    const abort = () => finish(new DOMException('Speech interrupted', 'AbortError'));
    const startTimer = setTimeout(() => finish(new SpeechPlaybackError('Speaker audio did not start. Tap Enable audio / replay to try again.', 'start-timeout')), 4500);
    signal.addEventListener('abort', abort, { once: true });
    utterance.onstart = () => {
      clearTimeout(startTimer); onStart?.();
      finishTimer = setTimeout(() => finish(new SpeechPlaybackError('Speaker playback stopped unexpectedly. Please replay the reply.', 'playback-timeout')), Math.min(60000, Math.max(6000, text.length * 160)));
    };
    utterance.onend = () => finish();
    utterance.onerror = event => finish(new SpeechPlaybackError(event.error === 'not-allowed' ? 'Speaker playback was blocked. Tap Enable audio / replay.' : 'The speaker could not play the reply. Tap Enable audio / replay.', event.error || 'synthesis-failed'));
    try { synth.resume(); synth.speak(utterance); } catch { finish(new SpeechPlaybackError('Speaker audio could not start. Tap Enable audio / replay.', 'start-failed')); }
  });
}
