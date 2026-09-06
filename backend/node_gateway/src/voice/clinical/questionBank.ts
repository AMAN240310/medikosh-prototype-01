import type { ComplaintCategory, Priority } from "../types/index.js";

export interface BankQuestion {
  id: string;
  priority: Priority;
  hi: string; // what Sarvam TTS actually speaks
  en: string; // short English gloss, for the dev metrics panel / logs only
}

// Order matters: within the same priority band, earlier entries are asked
// first. P0 > P1 > P2 > P3 always wins regardless of array order (see
// selectNextField in questionEngine.ts) - the array order is only a
// tie-breaker within a priority band.
export const QUESTION_BANKS: Record<ComplaintCategory, BankQuestion[]> = {
  chest_pain: [
    { id: "onset", priority: "P1", hi: "दर्द कब से हो रहा है?", en: "Onset" },
    { id: "location", priority: "P2", hi: "सीने में दर्द ठीक किस जगह है?", en: "Location in chest" },
    { id: "severity", priority: "P1", hi: "दर्द 1 से 10 में कितना तेज़ है?", en: "Severity 1-10" },
    { id: "character", priority: "P1", hi: "दर्द कैसा है—दबाव जैसा, जलन जैसा या चुभने जैसा?", en: "Character" },
    { id: "radiation", priority: "P0", hi: "क्या दर्द बाएं हाथ, कंधे, जबड़े या पीठ तक जा रहा है?", en: "Radiation" },
    { id: "breathlessness", priority: "P0", hi: "क्या सांस लेने में भी परेशानी हो रही है?", en: "Breathlessness" },
    { id: "sweating", priority: "P0", hi: "क्या आपको बहुत पसीना आ रहा है?", en: "Sweating" },
    { id: "nausea", priority: "P2", hi: "क्या जी मिचला रहा है या उल्टी जैसा महसूस हो रहा है?", en: "Nausea" },
    { id: "fainting", priority: "P0", hi: "क्या चक्कर आया या बेहोशी जैसा महसूस हुआ?", en: "Fainting" },
  ],
  breathing_difficulty: [
    { id: "onset", priority: "P1", hi: "सांस की तकलीफ़ कब से है?", en: "Onset" },
    { id: "severity", priority: "P1", hi: "सांस लेने में दिक्कत 1 से 10 में कितनी है?", en: "Severity 1-10" },
    { id: "chest_pain", priority: "P0", hi: "क्या इसके साथ सीने में दर्द भी है?", en: "Assoc. chest pain" },
    { id: "wheezing", priority: "P2", hi: "क्या सांस लेते समय सीटी जैसी आवाज़ आती है?", en: "Wheezing" },
    { id: "worse_lying_down", priority: "P2", hi: "क्या लेटने पर तकलीफ़ बढ़ जाती है?", en: "Worse lying down" },
    { id: "fever", priority: "P2", hi: "क्या बुखार भी है?", en: "Fever" },
    { id: "swelling", priority: "P3", hi: "क्या पैरों में सूजन है?", en: "Leg swelling" },
  ],
  abdominal_pain: [
    { id: "location", priority: "P1", hi: "पेट के किस हिस्से में दर्द है?", en: "Location" },
    { id: "onset", priority: "P1", hi: "दर्द कब से हो रहा है?", en: "Onset/duration" },
    { id: "severity", priority: "P1", hi: "दर्द 1 से 10 में कितना तेज़ है?", en: "Severity 1-10" },
    { id: "vomiting", priority: "P1", hi: "क्या उल्टी भी हो रही है?", en: "Vomiting" },
    { id: "fever", priority: "P2", hi: "क्या बुखार भी है?", en: "Fever" },
    { id: "bowel_changes", priority: "P2", hi: "क्या मल त्याग में कोई बदलाव आया है—दस्त या कब्ज़?", en: "Bowel changes" },
    { id: "urinary_symptoms", priority: "P2", hi: "पेशाब करते समय जलन या कोई दिक्कत तो नहीं?", en: "Urinary symptoms" },
  ],
  headache: [
    { id: "onset", priority: "P1", hi: "सिरदर्द कब से है?", en: "Onset" },
    { id: "severity", priority: "P1", hi: "सिरदर्द 1 से 10 में कितना तेज़ है?", en: "Severity 1-10" },
    { id: "neck_stiffness", priority: "P1", hi: "क्या गर्दन अकड़ी हुई महसूस हो रही है?", en: "Neck stiffness" },
    { id: "vision_changes", priority: "P0", hi: "क्या धुंधला दिखना या नज़र में कोई बदलाव है?", en: "Vision changes" },
    { id: "character", priority: "P2", hi: "दर्द धड़कता हुआ है, दबाव जैसा है या चुभने जैसा?", en: "Character" },
    { id: "location", priority: "P2", hi: "सिर के एक तरफ़ दर्द है या पूरे सिर में?", en: "Location" },
    { id: "vomiting", priority: "P2", hi: "क्या इसके साथ उल्टी या जी मिचलाना है?", en: "Vomiting" },
    { id: "fever", priority: "P2", hi: "क्या बुखार भी है?", en: "Fever" },
  ],
  fever: [
    { id: "onset", priority: "P1", hi: "बुखार कब से है?", en: "Onset" },
    { id: "breathing_difficulty", priority: "P0", hi: "क्या सांस लेने में दिक्कत है?", en: "Assoc. breathing difficulty" },
    { id: "severity", priority: "P1", hi: "बुखार हल्का है, मध्यम है या तेज़ है?", en: "Severity" },
    { id: "chills", priority: "P2", hi: "क्या ठंड लगकर कंपकंपी हो रही है?", en: "Chills" },
    { id: "body_ache", priority: "P2", hi: "क्या शरीर में दर्द भी है?", en: "Body ache" },
    { id: "cough", priority: "P2", hi: "क्या खांसी भी है?", en: "Cough" },
    { id: "rash", priority: "P3", hi: "क्या शरीर पर कोई चकत्ते या दाने हैं?", en: "Rash" },
  ],
};

export const OPENING_QUESTION_HI = "आपको क्या तकलीफ़ है?";

// Used only when the very first utterance doesn't match any of the 5
// supported categories - this is a predefined fallback, not a Gemini call,
// since Gemini's context schema requires a known chief_complaint.
export const CATEGORY_CLARIFY_QUESTION_HI =
  "कृपया बताएं—क्या आपको सीने में दर्द, सांस लेने में तकलीफ़, पेट दर्द, सिरदर्द या बुखार है?";

export const COMPLETION_MESSAGE_HI =
  "ठीक है, फ़िलहाल इतनी जानकारी काफ़ी है। डॉक्टर आपसे जल्द ही बात करेंगे।";

// A safe, generic question used whenever Gemini's confidence is too low to
// trust (spec section 6: "If confidence is below 0.75, use a predefined
// safe question instead of trusting the result").
export const SAFE_FALLBACK_QUESTION: BankQuestion = {
  id: "clarify_general",
  priority: "P2",
  hi: "कृपया थोड़ा और बताएं—ठीक से समझ नहीं आया।",
  en: "General clarification",
};
