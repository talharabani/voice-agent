import { localized, type CallLanguage } from './language';

export function receptionistFallback(language: CallLanguage) {
  return localized(language,
    'I can help with appointments and clinic information. Would you like an appointment or doctor details?',
    'اپائنٹمنٹ اور کلینک کی معلومات کے لیے آپ کی مدد ہو سکتی ہے۔ آپ اپائنٹمنٹ لینا چاہتے ہیں یا ڈاکٹر کی تفصیل جاننا چاہتے ہیں؟',
    'اپائنٹمنٹ تے کلینک دی معلومات لئی مدد مل سکدی اے۔ تسی اپائنٹمنٹ لینا چاہندے او یا ڈاکٹر دی تفصیل؟',
    'अपॉइंटमेंट और क्लिनिक की जानकारी में मदद कर सकते हैं। आप अपॉइंटमेंट लेना चाहते हैं या डॉक्टर की जानकारी चाहिए?');
}

export function isCallerEcho(reply: string, caller: string) {
  const normalize = (value: string) => value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim();
  const answer = normalize(reply), request = normalize(caller);
  if (request.length >= 8 && (answer === request || answer.startsWith(request + ' '))) return true;
  // A receptionist must not adopt the patient's request as their own.
  return /^(?:i (?:want|need) (?:a |an |to )|مجھے.{0,35}(?:کروانا|کرانا|بک کر)|میں.{0,25}(?:مریض ہوں|چیک اپ کروانا)|मुझे.{0,35}(?:करवाना|कराना|बुक करना))/iu.test(reply.trim());
}
