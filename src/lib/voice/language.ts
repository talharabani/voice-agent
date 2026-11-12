export type CallLanguage = 'en' | 'ur' | 'pa' | 'hi';
export const languageLocales: Record<CallLanguage, string> = { en: 'en-US', ur: 'ur-PK', pa: 'pa-PK', hi: 'hi-IN' };
export function detectCallLanguage(text: string, hint: CallLanguage = 'en'): CallLanguage {
  if (/\b(?:speak|reply|respond)\b.{0,20}\burdu\b/i.test(text)) return 'ur';
  if (/\b(?:speak|reply|respond)\b.{0,20}\bpunjabi\b/i.test(text)) return 'pa';
  if (/\b(?:speak|reply|respond)\b.{0,20}\benglish\b/i.test(text)) return 'en';
  if (/[\u0a00-\u0a7f]/u.test(text)) return 'pa';
  if (/[\u0900-\u097f]/u.test(text)) return 'hi';
  if (/[\u0600-\u06ff]/u.test(text)) return /تسی|تُسی|تہاڈ|تھواڈ|مینوں|نوں|کیہڑا|کیہڑی|وچ|دسّ|ہوندا/u.test(text) ? 'pa' : 'ur';
  if (/\b(tusi|tussi|tuhad[aei]|twad[aei]|menu|mainu|keh?ra|das[so]+|vich)\b/i.test(text)) return 'pa';
  if (/\b(mujhe|mujhy|mjy|mera|meri|aap|apke|kitne|kitny|kaun|konsa|chahiye|chaiye|dard|batao|bataein|hai|hain)\b/i.test(text)) return 'ur';
  if (text.trim().split(/\s+/).length < 3 && !/\b(hello|thanks|yes|no|english)\b/i.test(text)) return hint;
  return 'en';
}
export function localized(language: CallLanguage, english: string, urdu: string, punjabi: string, hindi: string) {
  return ({ en: english, ur: urdu, pa: punjabi, hi: hindi })[language];
}
export function greetingFor(name: string, language: CallLanguage) {
  return localized(language, `Hello, welcome to ${name}. How can I help?`, `السلام علیکم، ${name} میں خوش آمدید۔ میں آپ کی کیا مدد کر سکتی ہوں؟`, `سلام، ${name} وچ جی آیاں نوں۔ میں تہاڈی کی مدد کراں؟`, `नमस्ते, ${name} में आपका स्वागत है। मैं आपकी क्या मदद करूँ?`);
}
