import type { PublicDoctor } from '@/types/database';
import { localized, type CallLanguage } from './language';

type Turn = { speaker: 'agent' | 'caller'; text: string };
type Field = 'name' | 'phone' | 'concern' | 'doctor' | 'time' | 'consent';
function cancellation(text: string) {
  return /\bcancel\b.{0,30}\b(appointment|booking|request|visit)\b|(?:اپائنٹمنٹ|درخواست|بکنگ).{0,20}(?:منسوخ|کینسل)|اپوائنٹمنٹ.*کینسل|अपॉइंटमेंट.*रद्द/i.test(text);
}
const questions: Record<Field, [string, string, string, string]> = {
  name: ['May I have the patient’s full name?', 'مریض کا پورا نام بتا دیں؟', 'مریض دا پورا ناں دس دیو؟', 'मरीज़ का पूरा नाम बताएँ?'],
  phone: ['What is the patient’s WhatsApp number, including the country code and plus sign?', 'ملک کے کوڈ اور پلس نشان کے ساتھ مریض کا واٹس ایپ نمبر بتائیں؟', 'ملک دے کوڈ تے پلس نشان نال مریض دا واٹس ایپ نمبر دسو؟', 'देश के कोड और प्लस चिह्न के साथ मरीज़ का व्हाट्सऐप नंबर बताएँ?'],
  concern: ['What would you like the doctor to help with? Please describe it in your own words.', 'آپ کس مسئلے کے لیے ڈاکٹر سے ملنا چاہتے ہیں؟ اپنی زبان میں بتائیں۔', 'تسی کیہڑے مسئلے لئی ڈاکٹر نوں ملنا چاہندے او؟ اپنے لفظاں وچ دسو۔', 'आप किस परेशानी के लिए डॉक्टर से मिलना चाहते हैं? अपने शब्दों में बताएँ।'],
  doctor: ['Do you have a preferred doctor, or should reception help choose?', 'کیا آپ کسی خاص ڈاکٹر سے ملنا چاہتے ہیں، یا استقبالیہ ڈاکٹر منتخب کرنے میں مدد کرے؟', 'تسی کسے خاص ڈاکٹر نوں ملنا چاہندے او، یا استقبالیہ مدد کرے؟', 'क्या आप किसी विशेष डॉक्टर से मिलना चाहते हैं, या रिसेप्शन चुनने में मदद करे?'],
  time: ['Which date and time would you prefer? The clinic will check availability.', 'آپ کون سی تاریخ اور وقت چاہتے ہیں؟ کلینک دستیابی کی تصدیق کرے گا۔', 'تسی کیہڑی تاریخ تے وقت چاہندے او؟ کلینک دستیابی دی تصدیق کرے گا۔', 'आप कौन सी तारीख और समय चाहेंगे? क्लिनिक उपलब्धता की पुष्टि करेगा।'],
  consent: ['May the clinic send your appointment confirmation and clinic details to that number on WhatsApp?', 'کیا کلینک اس نمبر پر واٹس ایپ کے ذریعے اپائنٹمنٹ کی تصدیق اور کلینک کی معلومات بھیج سکتا ہے؟', 'کی کلینک ایس نمبر اُتے واٹس ایپ راہیں اپائنٹمنٹ دی تصدیق تے کلینک دی معلومات بھیج سکدا اے؟', 'क्या क्लिनिक इस नंबर पर व्हाट्सऐप से अपॉइंटमेंट की पुष्टि और क्लिनिक की जानकारी भेज सकता है?'],
};

export function normalizeSpokenPhone(value: string) {
  const english = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
  let text = value.toLowerCase().replace(/\bplus\b|پلس|प्लस|ਪਲੱਸ/g, '+');
  english.forEach((word, index) => { text = text.replace(new RegExp(`\\b${word}\\b`, 'g'), String(index)); });
  text = text.replace(/[۰-۹٠-٩०-९]/g, char => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(char) >= 0 ? '۰۱۲۳۴۵۶۷۸۹'.indexOf(char) : '٠١٢٣٤٥٦٧٨٩'.indexOf(char) >= 0 ? '٠١٢٣٤٥٦٧٨٩'.indexOf(char) : '०१२३४५६७८९'.indexOf(char)));
  if (/[^\d+\s().-]/.test(text)) return null;
  const phone = text.replace(/[\s().-]/g, '');
  return /^\+[1-9]\d{7,14}$/.test(phone) ? phone : null;
}
export function bookingIntent(text: string) {
  if (/\b(cancel|don't|do not|not booking)\b|منسوخ|کینسل|نہیں چاہیے|نہیں چاہ|नहीं चाहिए|रद्द/i.test(text)) return false;
  return /\b(book|schedule|reserve)\b.{0,35}\b(appointment|visit|consultation)\b|\b(?:want|need|like|request)\b.{0,40}\bappointment\b|\bbook\b.{0,20}\b(?:with dr|doctor)\b|\b(?:want|like|need|can i)\b.{0,25}\bsee\b.{0,15}\bdr\b|^appointment(?: please)?[.!]?\s*$|ڈاکٹر.{0,80}(?:ملنا|وقت لینا)|اپائنٹمنٹ|بکنگ|وقت لینا|اپوائنٹمنٹ|अपॉइंटमेंट|अपॉइन्टमेंट/i.test(text);
}
export function readBookingDraft(history: Turn[], doctors: PublicDoctor[] = []) {
  const draft = { active: false, cancelled: false, name: null as string | null, phone: null as string | null, concern: null as string | null, doctor: null as string | null, doctorAnswered: false, time: null as string | null, consent: null as boolean | null };
  for (let index = 0; index < history.length; index++) {
    const turn = history[index]; if (turn.speaker !== 'caller') continue;
    if (cancellation(turn.text)) { Object.assign(draft, { active: false, cancelled: true, name: null, phone: null, concern: null, doctor: null, doctorAnswered: false, time: null, consent: null }); continue; }
    if (bookingIntent(turn.text)) { draft.active = true; draft.cancelled = false; }
    if (!draft.active) continue;
    const requested = doctors.find(doctor => turn.text.toLowerCase().includes(doctor.name.toLowerCase()));
    if (requested && bookingIntent(turn.text)) { draft.doctor = requested.name; draft.doctorAnswered = true; }
    const previous = history[index - 1];
    if (previous?.speaker !== 'agent') continue;
    const field = (Object.keys(questions) as Field[]).find(key => questions[key].includes(previous.text.trim()));
    if (!field || !turn.text.trim()) continue;
    const text = turn.text.trim();
    if (/\b(change|correct|update)\b|تبدیل|درست|बदल|सही/i.test(text)) continue;
    // Do not mistake a question or an emergency for a patient field.
    if (/[?؟]$/.test(text) || /^(?:what|how|who|where|tell me)\b/i.test(text)) continue;
    if (field === 'name' && text.length <= 120) draft.name = text;
    if (field === 'phone') {
      const phone = normalizeSpokenPhone(text);
      if (draft.phone && draft.phone !== phone) draft.consent = null;
      draft.phone = phone;
    }
    if (field === 'concern') draft.concern = text.slice(0, 2000);
    if (field === 'doctor') {
      const doctor = doctors.find(item => text.toLowerCase().includes(item.name.toLowerCase()) || text.toLowerCase().includes(item.name.replace(/^dr\.?\s*/i, '').toLowerCase()));
      draft.doctor = /\b(any|no preference|reception|choose for me)\b|کوئی بھی|استقبالیہ|کوئی وی|कोई भी/i.test(text) ? null : doctor?.name ?? text.slice(0, 120); draft.doctorAnswered = true;
    }
    if (field === 'time') draft.time = text.slice(0, 500);
    if (field === 'consent') {
      if (/\b(no|not|nahi|nahin)\b|نہیں|نہ|نئیں|नहीं/i.test(text)) draft.consent = false;
      else if (/^(?:yes|yeah|sure|okay|ok|haan|han|ji|jee|bilkul)\b|^(?:جی|ہاں|بالکل|ٹھیک|हाँ|जी|ਬਿਲਕੁਲ|ਹਾਂ)/iu.test(text)) draft.consent = true;
    }
  }
  return draft;
}

export function answerBookingFlow(history: Turn[], doctors: PublicDoctor[], language: CallLanguage) {
  const draft = readBookingDraft(history, doctors);
  if (draft.cancelled && cancellation(history.at(-1)?.text ?? '')) return { draft, reply: localized(language, 'This call’s new request will not be submitted. To cancel an existing appointment, please contact reception.', 'اس کال کی نئی درخواست جمع نہیں ہوگی۔ پہلے سے موجود اپائنٹمنٹ منسوخ کرنے کے لیے استقبالیہ سے رابطہ کریں۔', 'ایس کال دی نویں درخواست جمع نہیں ہووے گی۔ پہلے دی اپائنٹمنٹ منسوخ کران لئی استقبالیہ نال رابطہ کرو۔', 'इस कॉल का नया अनुरोध जमा नहीं होगा। पहले से मौजूद अपॉइंटमेंट रद्द करने के लिए रिसेप्शन से संपर्क करें।') };
  if (!draft.active) return null;
  const latest = history.at(-1)?.text ?? '';
  if (/\b(change|correct|update)\b|تبدیل|درست|बदल|सही/i.test(latest)) {
    const field: Field | undefined = /phone|number|نمبر|नंबर/i.test(latest) ? 'phone' : /name|نام|ناں|नाम/i.test(latest) ? 'name' : /doctor|ڈاکٹر|डॉक्टर/i.test(latest) ? 'doctor' : /time|date|وقت|تاریخ|समय|तारीख/i.test(latest) ? 'time' : undefined;
    if (field) return { reply: localized(language, ...questions[field]), draft };
  }
  // Let explicit information requests temporarily interrupt the booking flow.
  if (/^(?:how many|tell me|what (?:are|is)|where|who|how much)\b|کتنے|کہاں|بارے میں|تجربہ|कितने|कहाँ|बारे में/i.test(latest) && !bookingIntent(latest)) return null;
  const field: Field | null = !draft.name ? 'name' : !draft.phone ? 'phone' : !draft.concern ? 'concern' : !draft.doctorAnswered ? 'doctor' : !draft.time ? 'time' : draft.consent === null ? 'consent' : null;
  if (field) return { reply: localized(language, ...questions[field]), draft };
  return { draft, reply: localized(language,
    `Thank you. Your request details are ready for reception. End the call to submit them; the clinic will verify the doctor and slot${draft.consent ? ' before a WhatsApp confirmation can be sent' : ''}.`,
    'شکریہ، آپ کی درخواست کی تفصیلات تیار ہیں۔ جمع کروانے کے لیے کال ختم کریں؛ ڈاکٹر اور وقت کی تصدیق کلینک کرے گا۔',
    'شکریہ، تہاڈی درخواست دیاں تفصیلاں تیار نیں۔ جمع کروان لئی کال ختم کرو؛ ڈاکٹر تے وقت دی تصدیق کلینک کرے گا۔',
    'धन्यवाद, आपके अनुरोध का विवरण तैयार है। जमा करने के लिए कॉल समाप्त करें; डॉक्टर और समय की पुष्टि क्लिनिक करेगा।') };
}
