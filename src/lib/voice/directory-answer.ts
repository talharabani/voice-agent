import type { PublicDoctor } from '@/types/database';
import { localized, type CallLanguage } from './language';

type Clinic = { clinic_name: string; address: string; phone: string; opening_hours: string };
export type DirectoryAnswer = { reply: string; doctorIds: string[]; kind: 'directory' | 'clinic' | 'urgent' };
export function matchesTerm(text: string, term: string) {
  const escaped = term.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return Boolean(escaped) && new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'iu').test(text);
}

export function answerFromDirectory(text: string, doctors: PublicDoctor[], clinic: Clinic | null, language: CallLanguage, available = true): DirectoryAnswer | null {
  const say = (en: string, ur: string, pa: string, hi: string) => localized(language, en, ur, pa, hi);
  const doctorQuestion = /\b(doctors?|physicians?|specialists?|specialt(?:y|ies)|medical team|dr\.?)\b|ڈاکٹر|معالج|ماہر|ڈاکٹراں|डॉक्टर|चिकित्सक/i.test(text);
  const countQuestion = /how many|number of|kitn[ey]|kinne|کتنے|تعداد|کنے|कितने/i.test(text);
  // Keep urgent symptoms out of routine directory matching. This is a limited
  // escalation guard, not a clinical triage or diagnosis system.
  if (/chest pain|can'?t breathe|cannot breathe|severe (?:chest pain|bleeding)|سینے میں درد|سانس نہیں|سینے وچ درد|سینے دا درد|सीने में दर्द|सांस नहीं/i.test(text)) {
    return { kind: 'urgent', doctorIds: [], reply: say('This may need urgent care. Please contact local emergency services or go to the nearest emergency department now; do not wait for a clinic appointment.', 'اس کے لیے فوری طبی مدد ضروری ہو سکتی ہے۔ براہ کرم مقامی ایمرجنسی سروس سے رابطہ کریں یا قریبی ایمرجنسی جائیں؛ کلینک کی اپائنٹمنٹ کا انتظار نہ کریں۔', 'ایہ فوری طبی مدد دا معاملہ ہو سکدا اے۔ مقامی ایمرجنسی سروس نال رابطہ کرو یا نیڑے دی ایمرجنسی جاؤ؛ کلینک دی باری دا انتظار نہ کرو۔', 'इसके लिए तत्काल चिकित्सा सहायता ज़रूरी हो सकती है। स्थानीय आपातकालीन सेवा से संपर्क करें या नज़दीकी इमरजेंसी जाएँ; क्लिनिक की अपॉइंटमेंट का इंतज़ार न करें।') };
  }
  const named = doctors.filter(doctor => matchesTerm(text, doctor.name) || matchesTerm(text, doctor.name.replace(/^dr\.?\s*/i, '')));
  const related = doctors.filter(doctor => doctor.concern_keywords.some(term => matchesTerm(text, term)) || matchesTerm(text, doctor.specialty));
  const booking = /\b(book|appointment|schedule|reserve)\b|اپائنٹمنٹ|بکنگ|وقت لینا|ملاقات|अपॉइंटमेंट|बुक/i.test(text);
  // Booking dialogue needs to collect patient fields, even when a doctor is named.
  if (booking && !/tell me|about|experience|profile|بارے|تجربہ|बारे|अनुभव/i.test(text)) return null;
  if (doctorQuestion && !available) return { kind: 'directory', doctorIds: [], reply: say('The doctor directory is unavailable. Please contact reception for verified details.', 'ڈاکٹروں کی فہرست ابھی دستیاب نہیں۔ درست معلومات کے لیے استقبالیہ سے رابطہ کریں۔', 'ڈاکٹراں دی فہرست ہن دستیاب نہیں۔ درست معلومات لئی استقبالیہ نال رابطہ کرو۔', 'डॉक्टरों की सूची अभी उपलब्ध नहीं है। सही जानकारी के लिए रिसेप्शन से संपर्क करें।') };
  if (doctorQuestion && doctors.length === 0) return { kind: 'directory', doctorIds: [], reply: say('The clinic has not published doctor profiles yet. Reception can help you find the right clinician.', 'کلینک نے ابھی ڈاکٹروں کی تفصیلات شامل نہیں کیں۔ استقبالیہ مناسب ڈاکٹر کی معلومات دے سکتا ہے۔', 'کلینک نے ہجے ڈاکٹراں دیاں تفصیلاں نہیں پایاں۔ استقبالیہ مناسب ڈاکٹر دی معلومات دے سکدا اے۔', 'क्लिनिक ने अभी डॉक्टरों की जानकारी नहीं जोड़ी है। रिसेप्शन उपयुक्त डॉक्टर की जानकारी दे सकता है।') };
  if (doctorQuestion && countQuestion) return { kind: 'directory', doctorIds: doctors.map(d => d.id), reply: say(`Our published directory has ${doctors.length} doctor${doctors.length === 1 ? '' : 's'}. Their specialties and profiles are on your screen.`, `ہماری فہرست میں ${doctors.length} ڈاکٹر ہیں۔ ان کی تخصص اور پروفائل آپ کی اسکرین پر ہیں۔`, `ساڈی فہرست وچ ${doctors.length} ڈاکٹر نیں۔ انہاں دی مہارت تے پروفائل تہاڈی سکرین اُتے نیں۔`, `हमारी सूची में ${doctors.length} डॉक्टर हैं। उनकी विशेषज्ञता और प्रोफाइल आपकी स्क्रीन पर हैं।`) };
  if (named.length || related.length) {
    const selected = named.length ? named : related;
    const doctor = selected[0];
    const reply = named.length ? say(`${doctor.name} practices ${doctor.specialty} and has ${doctor.experience_years} years of experience. Their full profile is on screen.`, `${doctor.name} ${doctor.specialty} کے ڈاکٹر ہیں اور ان کا تجربہ ${doctor.experience_years} سال ہے۔ مکمل پروفائل اسکرین پر ہے۔`, `${doctor.name} ${doctor.specialty} دے ڈاکٹر نیں تے انہاں دا تجربہ ${doctor.experience_years} سال اے۔ پوری پروفائل سکرین اُتے اے۔`, `${doctor.name} की विशेषज्ञता ${doctor.specialty} है और उनका अनुभव ${doctor.experience_years} साल है। पूरी प्रोफाइल स्क्रीन पर है।`) : say('I found clinic profiles related to your concern. Please review them on screen; reception must confirm which doctor is suitable.', 'آپ کی بتائی ہوئی بات سے متعلق کلینک کی پروفائل اسکرین پر ہیں۔ کون سا ڈاکٹر مناسب ہے، اس کی تصدیق استقبالیہ کرے گا۔', 'تہاڈی گل نال متعلق کلینک دیاں پروفائل سکرین اُتے نیں۔ کیہڑا ڈاکٹر مناسب اے، ایہ استقبالیہ تصدیق کرے گا۔', 'आपकी बताई बात से संबंधित क्लिनिक की प्रोफाइल स्क्रीन पर हैं। कौन सा डॉक्टर उपयुक्त है, इसकी पुष्टि रिसेप्शन करेगा।');
    const relatedReply = say(`${doctor.name} (${doctor.specialty}) appears in the clinic's related profiles; reception must confirm suitability. Their details are on screen.`, `${doctor.name} (${doctor.specialty}) کی پروفائل اس مسئلے سے متعلق ہے؛ مناسب ڈاکٹر کی تصدیق استقبالیہ کرے گا۔ تفصیل اسکرین پر ہے۔`, `${doctor.name} (${doctor.specialty}) دی پروفائل ایس مسئلے نال متعلق اے؛ مناسب ڈاکٹر دی تصدیق استقبالیہ کرے گا۔ تفصیل سکرین اُتے اے۔`, `${doctor.name} (${doctor.specialty}) की प्रोफाइल इस परेशानी से संबंधित है; उपयुक्तता की पुष्टि रिसेप्शन करेगा। विवरण स्क्रीन पर है।`);
    return { kind: 'directory', doctorIds: selected.map(d => d.id), reply: named.length ? reply : relatedReply };
  }
  if (doctorQuestion) return { kind: 'directory', doctorIds: doctors.map(d => d.id), reply: say('Here are our published doctor profiles, including specialties and experience. Which doctor would you like to know about?', 'ڈاکٹروں کی تخصص اور تجربے کی تفصیل اسکرین پر ہے۔ آپ کس ڈاکٹر کے بارے میں جاننا چاہتے ہیں؟', 'ڈاکٹراں دی مہارت تے تجربے دی تفصیل سکرین اُتے اے۔ تسی کیہڑے ڈاکٹر بارے جاننا چاہندے او؟', 'डॉक्टरों की विशेषज्ञता और अनुभव स्क्रीन पर हैं। आप किस डॉक्टर के बारे में जानना चाहते हैं?') };
  if (clinic) {
    if (/\b(address|located|location)\b|پتہ|ایڈریس|کہاں|پتا|पता|कहाँ/i.test(text)) return { kind: 'clinic', doctorIds: [], reply: say(`${clinic.clinic_name} is at ${clinic.address}.`, `${clinic.clinic_name} کا پتہ ${clinic.address} ہے۔`, `${clinic.clinic_name} دا پتہ ${clinic.address} اے۔`, `${clinic.clinic_name} का पता ${clinic.address} है।`) };
    if (/\b(hours|opening|timings|open)\b|اوقات|ٹائمنگ|کب کھل|समय|कब खुल/i.test(text)) return { kind: 'clinic', doctorIds: [], reply: say(`Our published opening hours are ${clinic.opening_hours}.`, `کلینک کے اوقات ${clinic.opening_hours} ہیں۔`, `کلینک دے اوقات ${clinic.opening_hours} نیں۔`, `क्लिनिक का समय ${clinic.opening_hours} है।`) };
  }
  if (/\b(pain|hurts?|symptoms?|diagnos\w*|medicine|treatment|bleeding|rash|fever|sick|medical problem|dard|masla|bukhar|dawai|ilaaj)\b|درد|بخار|علامات|علاج|دوا|تکلیف|دانے|مسئلہ|दर्द|बुखार|इलाज|दवा/i.test(text)) {
    return { kind: 'directory', doctorIds: [], reply: say('Reception needs a clinician to assess that concern and confirm the right doctor. Would you like to request a consultation?', 'اس مسئلے کے لیے طبی معائنہ ضروری ہے؛ مناسب ڈاکٹر کی تصدیق کلینک کرے گا۔ کیا آپ مشاورت کی درخواست دینا چاہتے ہیں؟', 'ایس مسئلے لئی طبی معائنہ ضروری اے؛ مناسب ڈاکٹر دی تصدیق کلینک کرے گا۔ کی تسی مشورے دی درخواست دینا چاہندے او؟', 'इस समस्या के लिए चिकित्सकीय मूल्यांकन ज़रूरी है; उपयुक्त डॉक्टर की पुष्टि क्लिनिक करेगा। क्या आप परामर्श का अनुरोध करना चाहेंगे?') };
  }
  return null;
}
