import { localized, type CallLanguage } from './language';

export function extractIntroducedName(text: string): string | null {
  const patterns = [
    /\bmy name is\s+(.{1,100}?)(?=\s+(?:and|i want|i need)\b|[,!?۔،؟]|\.(?:\s|$)|$)/iu,
    /\b(?:mera|mara|meray)\s+(?:naam|nam)\s+(.{1,100}?)(?=\s+(?:hai|hay|hy|he)(?:\s|[.!?,]|$)|\s+(?:aur|or|and)\b|[,!?۔،؟]|$)/iu,
    /میرا\s*نام\s+(.{1,100}?)(?=\s+(?:ہے|ھے|ہیں)(?:\s|[۔،؟!]|$)|[۔،؟!]|$)/u,
    /मेरा\s+नाम\s+(.{1,100}?)(?=\s+(?:है|हैं)(?:\s|[।,!?]|$)|[।,!?]|$)/u,
    /ਮੇਰਾ\s+ਨਾਮ\s+(.{1,100}?)(?=\s+(?:ਹੈ|ਏ)(?:\s|[।,!?]|$)|[।,!?]|$)/u,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (!match) continue;
    const name = match[1].trim().replace(/[.۔,،!?؟]+$/, '').trim();
    if (/^(?:not|nahi|nahin)\b|نہیں|नहीं/iu.test(name)) return null;
    if (name.length <= 100 && /^[\p{L}\p{M}][\p{L}\p{M}\s.'’\-]*$/u.test(name)) return name;
  }
  return null;
}

export function acknowledgeName(name: string, language: CallLanguage) {
  return localized(language, `Thank you, I have your name as ${name}.`, `جی، آپ کا نام ${name} ہے۔`, `جی، تہاڈا ناں ${name} اے۔`, `जी, आपका नाम ${name} है।`);
}
