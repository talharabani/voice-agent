import type { CallLanguage } from './language';
export const voicePresets = [
  { id: 'warm-female', label: 'Warm female', detail: 'Welcoming and clear', pitch: 1.05, rate: 1, preference: 'female' },
  { id: 'clear-female', label: 'Clear female', detail: 'Bright and composed', pitch: 1.12, rate: 1.03, preference: 'female' },
  { id: 'calm-male', label: 'Calm male', detail: 'Steady and reassuring', pitch: 0.92, rate: 0.96, preference: 'male' },
  { id: 'deep-male', label: 'Deep male', detail: 'Measured and grounded', pitch: 0.8, rate: 0.94, preference: 'male' },
  { id: 'youthful', label: 'Youthful', detail: 'Light and friendly', pitch: 1.3, rate: 1.04, preference: 'female' },
  { id: 'gentle', label: 'Gentle', detail: 'Soft and unhurried', pitch: 1, rate: 0.9, preference: 'any' },
] as const;
export type VoicePresetId = typeof voicePresets[number]['id'];
const female = /female|zira|samantha|susan|hazel|aria|jenny|sonia|natasha|heera|swara|uzma|gul/i;
const male = /\bmale\b|david|mark|daniel|george|guy|ryan|ravi|prabhat|asad/i;
export function selectBrowserVoice(voices: SpeechSynthesisVoice[], language: CallLanguage, presetId: string, preferredUri = '') {
  const preset = voicePresets.find(item => item.id === presetId) ?? voicePresets[0];
  const matching = voices.filter(voice => voice.lang.toLowerCase().split('-')[0] === language);
  const chosen = matching.find(voice => voice.voiceURI === preferredUri);
  const gender = preset.preference === 'female' ? female : preset.preference === 'male' ? male : null;
  const styled = gender ? matching.find(voice => gender.test(voice.name)) : null;
  return { voice: chosen ?? styled ?? matching.find(voice => /natural|neural|online/i.test(voice.name)) ?? matching[0] ?? null, preset, languageAvailable: matching.length > 0, styleAvailable: Boolean(chosen || styled || preset.preference === 'any') };
}
