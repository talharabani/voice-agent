const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers/load-ts.cjs');

function nativeApi({ language = 'ur-PK', fail = false } = {}) {
  let spoken = 0, cancelled = 0;
  const synth = {
    getVoices: () => [{ voiceURI: 'native', name: 'Test voice', lang: language }],
    cancel() { cancelled++; }, resume() {}, addEventListener() {}, removeEventListener() {},
    speak(utterance) { spoken++; queueMicrotask(() => { if (fail) utterance.onerror?.({ error: 'synthesis-failed' }); else { utterance.onstart?.(); utterance.onend?.(); } }); },
  };
  const api = load('src/lib/voice/browser-playback.ts', {}, { window: { speechSynthesis: synth }, DOMException, SpeechSynthesisUtterance: class { constructor(text) { this.text = text; } } });
  return { api, counters: () => ({ spoken, cancelled }) };
}
test('a missing Urdu device voice is an explicit error, never silent success', async () => {
  const { api, counters } = nativeApi({ language: 'en-US' });
  await assert.rejects(api.playBrowserSpeech({ text: 'السلام علیکم', language: 'ur', preset: 'warm-female', signal: new AbortController().signal }), /no Urdu speaker voice/);
  assert.equal(counters().spoken, 0);
});
test('browser synthesis failures propagate to the call instead of resolving successfully', async () => {
  const { api } = nativeApi({ fail: true });
  await assert.rejects(api.playBrowserSpeech({ text: 'السلام علیکم', language: 'ur', preset: 'warm-female', signal: new AbortController().signal }), /could not play/);
});
test('browser speech only reports playback start after the real start event', async () => {
  const { api } = nativeApi(); let started = false;
  await api.playBrowserSpeech({ text: 'السلام علیکم', language: 'ur', preset: 'warm-female', signal: new AbortController().signal, onStart() { started = true; } });
  assert.equal(started, true);
});
test('aborted browser speech cannot restart playback', async () => {
  const { api, counters } = nativeApi(); const controller = new AbortController(); controller.abort();
  await assert.rejects(api.playBrowserSpeech({ text: 'السلام علیکم', language: 'ur', preset: 'warm-female', signal: controller.signal }), { name: 'AbortError' });
  assert.equal(counters().spoken, 0);
});

test('online playback starts real audio and revokes its temporary blob after playback', async () => {
  let revoked = false, started = false, paused = false;
  const audio = { duration: 1, pause() { paused = true; }, removeAttribute() {}, load() {}, play() { queueMicrotask(() => { this.onplaying?.(); this.onended?.(); }); return Promise.resolve(); } };
  const api = load('src/lib/voice/online-playback.ts', {}, { DOMException, URL: { createObjectURL: () => 'blob:test', revokeObjectURL() { revoked = true; } }, fetch: async () => new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'audio/mpeg' } }) });
  await api.playOnlineSpeech({ audio, text: 'Hello', language: 'en', style: 'gentle', token: 'test', signal: new AbortController().signal, onStart() { started = true; } });
  assert.equal(started, true); assert.equal(revoked, true); assert.equal(paused, true);
});
test('online speech refuses HTML/error pages rather than treating them as audio', async () => {
  const api = load('src/lib/voice/online-playback.ts', {}, { DOMException, fetch: async () => new Response('<html>ngrok warning</html>', { headers: { 'Content-Type': 'text/html' } }) });
  await assert.rejects(api.prepareSpeechAudio({ text: 'Hello', language: 'en', style: 'gentle', signal: new AbortController().signal }), /did not return audio/);
});
