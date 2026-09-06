import type { ComplaintCategory, KnownInformation } from "../types/index.js";

// This is the "FAST PROCESSOR" box from the architecture diagram. It is a
// keyword/pattern based extractor, deliberately not an LLM call, so it
// stays on the fast path. Coverage is a Phase 1 heuristic set for
// Hindi/Hinglish/English, not a full NLU system - see README for the
// documented limitation and how the confidence signal it produces is
// used to decide when to hand off to Gemini.

export interface ExtractionResult {
  updates: KnownInformation;
  detectedCategory: ComplaintCategory | null;
  matchedFieldCount: number;
  languageHint: "hindi" | "hinglish" | "english" | "unknown";
}

// Every boolean-typed field across all categories + emergency-only fields.
// Used so a bare "haan"/"nahi" answer can resolve whichever field was just
// asked, without re-stating the keyword.
export const BOOLEAN_FIELDS = new Set([
  "breathlessness",
  "severe_breathing_difficulty",
  "sweating",
  "severe_weakness",
  "fainting",
  "facial_weakness",
  "speech_difficulty",
  "one_sided_weakness",
  "unconsciousness",
  "severe_bleeding",
  "nausea",
  "vomiting",
  "fever",
  "chills",
  "body_ache",
  "cough",
  "rash",
  "wheezing",
  "worse_lying_down",
  "swelling",
  "neck_stiffness",
  "vision_changes",
  "chest_pain",
  "breathing_difficulty",
  "bowel_changes",
  "urinary_symptoms",
]);

// Non-boolean fields where free-form prose is itself a valid answer (see
// point 4 in extractFromUtterance below). severity and radiation are
// intentionally excluded - they have their own structured extraction and
// should stay "unresolved" rather than swallow an unparseable reply.
const FREE_TEXT_FALLBACK_FIELDS = new Set(["onset", "location", "character"]);

const AFFIRMATIVE_RE = /^\s*(haan|han|ha|हाँ|हां|ji\s*haan|जी\s*हाँ|yes|yeah|yup|correct|bilkul|बिलकुल)\b/i;
const NEGATIVE_RE = /^\s*(nahi|nahin|nai|नहीं|no|nope|na|na\s*hai)\b/i;

const CATEGORY_PATTERNS: Record<ComplaintCategory, RegExp[]> = {
  chest_pain: [/\bchest\b/i, /सीन[ेा]/, /छाती/, /seene?/i],
  breathing_difficulty: [/breath/i, /साँस|सांस/, /shwas/i, /dum\s*ghut/i, /दम\s*घुट/],
  abdominal_pain: [/\bstomach\b/i, /\babdomen/i, /\bbelly\b/i, /पेट/, /\bpet\b/i],
  headache: [/headache/i, /सिरदर्द/, /सिर\s*(में)?\s*दर्द/, /\bsir\s*dard\b/i, /\bsar\s*dard\b/i],
  fever: [/\bfever\b/i, /बुखार/, /\bbukhar\b/i, /temperature/i],
};

// Field -> patterns that positively indicate the field is TRUE. These are
// checked in addition to the affirmative/negative shortcut above.
const BOOLEAN_FIELD_PATTERNS: Record<string, RegExp[]> = {
  severe_breathing_difficulty: [
    /can'?t breathe/i,
    /gasping/i,
    /severe(ly)? (breathless|breathing)/i,
    /साँस\s*बिल्कुल\s*नहीं/,
    /सांस\s*नहीं\s*आ\s*रही/,
    /saans\s*nahi\s*aa\s*rahi/i,
    /bahut\s*zyada\s*saans/i,
  ],
  breathlessness: [
    /breathless/i,
    /breathing difficult/i,
    /short(ness)? of breath/i,
    /साँस.*(तकलीफ़?|दिक्कत|परेशानी|फूल)/,
    /सांस.*(तकलीफ़?|दिक्कत|परेशानी|फूल)/,
    /saans.*(taklif|dikkat|pareshani|phool)/i,
  ],
  sweating: [/\bsweat/i, /पसीना/, /\bpaseena\b/i],
  severe_weakness: [/severe weakness/i, /बहुत\s*कमज़ोरी/, /बहुत\s*कमजोरी/, /bahut\s*kamzori/i],
  fainting: [/\bfaint/i, /पास\s*आउट/, /बेहोश(ी)?/, /\bbehosh/i, /चक्कर/, /\bchakkar\b/i, /\bdizz/i],
  facial_weakness: [/facial weakness/i, /face.*(droop|weak)/i, /चेहरा.*(टेढ़ा|लटक)/, /chehra.*(tedha|latak)/i],
  speech_difficulty: [/speech difficult/i, /slurred/i, /बोलने\s*में\s*दिक्कत/, /bolne\s*mein\s*dikkat/i, /zaban\s*ladkhadana/i],
  one_sided_weakness: [/one[- ]sided weakness/i, /एक\s*तरफ.{0,6}कमज़ोरी/, /एक\s*तरफ.{0,6}कमजोरी/, /ek\s*taraf.{0,6}kamzori/i],
  unconsciousness: [/unconscious/i, /passed out/i, /बेहोश\s*हो\s*गय/, /behosh\s*ho\s*gay/i],
  severe_bleeding: [/severe bleeding/i, /heavy bleeding/i, /bleeding a lot/i, /बहुत\s*(ज़्यादा|ज्यादा)?\s*खून/, /bahut\s*khoon/i, /खून\s*बह\s*रहा/],
  nausea: [/\bnausea/i, /जी\s*मिचल/, /jee\s*michal/i],
  vomiting: [/\bvomit/i, /उल्टी/, /\bulti\b/i],
  fever: [/\bfever\b/i, /बुखार/, /\bbukhar\b/i],
  chills: [/\bchills\b/i, /ठंड\s*लग/, /कंपकंपी/, /thand\s*lag/i, /kaapkapi/i],
  body_ache: [/body ache/i, /शरीर\s*में\s*दर्द/, /sharir\s*mein\s*dard/i, /badan\s*dard/i, /बदन\s*दर्द/],
  cough: [/\bcough/i, /खांसी/, /\bkhansi\b/i],
  rash: [/\brash\b/i, /चकत्ते/, /दाने/, /dane\s*nikal/i],
  wheezing: [/wheez/i, /सीटी.{0,6}आवाज़/, /seeti.{0,6}awaz/i],
  worse_lying_down: [/worse.*ly(ing)? down/i, /लेटने\s*पर.{0,6}बढ़/, /letne\s*par.{0,6}badh/i],
  swelling: [/swelling/i, /सूजन/, /\bsujan\b/i],
  neck_stiffness: [/neck stiff/i, /गर्दन.{0,6}अकड़/, /gardan.{0,6}akad/i],
  vision_changes: [/blurred? vision/i, /vision change/i, /धुंधला/, /dhundhla/i],
  chest_pain: [/chest pain/i, /सीने\s*में\s*दर्द/, /seene?\s*mein\s*dard/i],
  breathing_difficulty: [/breathing difficult/i, /साँस.*दिक्कत/, /सांस.*दिक्कत/],
  bowel_changes: [/diarrh/i, /constipat/i, /दस्त/, /कब्ज़/, /kabj/i, /dast/i],
  urinary_symptoms: [/urinat/i, /burning.*urin/i, /पेशाब.*(जलन|दिक्कत)/, /peshab.*(jalan|dikkat)/i],
};

const HINDI_NUMBER_WORDS: Record<string, number> = {
  "एक": 1, "दो": 2, "तीन": 3, "चार": 4, "पांच": 5, "पाँच": 5,
  "छह": 6, "छः": 6, "सात": 7, "आठ": 8, "नौ": 9, "दस": 10,
  ek: 1, do: 2, teen: 3, char: 4, paanch: 5, panch: 5,
  chhah: 6, cheh: 6, saat: 7, aath: 8, nau: 9, das: 10, dus: 10,
};

function extractSeverity(utterance: string, lastAskedField: string | null): number | null {
  const digitMatch = utterance.match(/\b(10|[1-9])\b/);
  if (digitMatch) {
    const n = parseInt(digitMatch[1], 10);
    if (n >= 1 && n <= 10) return n;
  }
  for (const [word, n] of Object.entries(HINDI_NUMBER_WORDS)) {
    const re = new RegExp(`(^|\\s)${word}(\\s|$)`, "i");
    if (re.test(utterance)) return n;
  }
  return lastAskedField === "severity" ? null : null;
}

const ONSET_PATTERNS: Array<[RegExp, string]> = [
  [/kal\s*raat\s*se|कल\s*रात\s*से/i, "last_night"],
  [/kal\s*se|कल\s*से/i, "yesterday"],
  [/aaj\s*se|आज\s*से|\btoday\b/i, "today"],
  [/abhi\s*abhi|just\s*now|अभी\s*अभी/i, "just_now"],
  [/(\d+)\s*(ghante|hour)/i, "hours_ago"],
  [/(\d+)\s*(din|day)/i, "days_ago"],
  [/hafte?\s*se|week|हफ़्ते\s*से|हफ्ते\s*से/i, "week_ago"],
];

function extractOnset(utterance: string): string | null {
  for (const [re, value] of ONSET_PATTERNS) {
    if (re.test(utterance)) return value;
  }
  return null;
}

const CHARACTER_PATTERNS: Array<[RegExp, string]> = [
  [/pressure|दबाव/i, "pressure"],
  [/burning|जलन/i, "burning"],
  [/sharp|stabbing|चुभ/i, "stabbing"],
  [/throb|धड़क/i, "throbbing"],
  [/dull|सुस्त|हल्का/i, "dull"],
];

function extractCharacter(utterance: string): string | null {
  for (const [re, value] of CHARACTER_PATTERNS) {
    if (re.test(utterance)) return value;
  }
  return null;
}

const RADIATION_PARTS: Array<[RegExp, string]> = [
  [/left arm|बाएं\s*हाथ|बायें\s*हाथ|baaye?n?\s*haath/i, "left_arm"],
  [/right arm|दाएं\s*हाथ|दायें\s*हाथ|daaye?n?\s*haath/i, "right_arm"],
  [/shoulder|कंधे|कंधा|kandhe?|kandha/i, "shoulder"],
  [/\bjaw\b|जबड़े|जबड़ा|jabde?|jabda/i, "jaw"],
  [/\bback\b|पीठ|peeth/i, "back"],
];

function extractRadiation(utterance: string): string[] | null {
  const found: string[] = [];
  for (const [re, value] of RADIATION_PARTS) {
    if (re.test(utterance) && !found.includes(value)) found.push(value);
  }
  return found.length > 0 ? found : null;
}

function extractAbdomenLocation(utterance: string): string | null {
  let side: string | null = null;
  let region: string | null = null;
  if (/right|दायें|दाहिने|dayen|dahine/i.test(utterance)) side = "right";
  if (/left|बायें|बाएं|bayen|baye/i.test(utterance)) side = "left";
  if (/upper|ऊपर|oopar/i.test(utterance)) region = "upper_abdomen";
  if (/lower|नीचे|neeche/i.test(utterance)) region = "lower_abdomen";
  if (region && side) return `${side}_${region.replace("_abdomen", "")}_abdomen`;
  if (region) return region;
  if (side) return `${side}_abdomen`;
  return null;
}

export function detectCategory(utterance: string): ComplaintCategory | null {
  for (const category of Object.keys(CATEGORY_PATTERNS) as ComplaintCategory[]) {
    if (CATEGORY_PATTERNS[category].some((re) => re.test(utterance))) {
      return category;
    }
  }
  return null;
}

function detectLanguageHint(utterance: string): "hindi" | "hinglish" | "english" | "unknown" {
  const hasDevanagari = /[\u0900-\u097F]/.test(utterance);
  const hasLatin = /[a-zA-Z]/.test(utterance);
  const romanHindiWords = /\b(hai|nahi|kal|dard|mein|bahut|thoda|se|ho|raha|rahi)\b/i.test(utterance);
  if (hasDevanagari && hasLatin) return "hinglish";
  if (hasDevanagari) return "hindi";
  if (hasLatin && romanHindiWords) return "hinglish";
  if (hasLatin) return "english";
  return "unknown";
}

export function extractFromUtterance(
  utterance: string,
  context: { chiefComplaint: ComplaintCategory | null; lastAskedField: string | null }
): ExtractionResult {
  const updates: KnownInformation = {};
  const text = utterance.trim();

  const detectedCategory = context.chiefComplaint ? null : detectCategory(text);

  // 1) Boolean fields: keyword evidence anywhere in the utterance.
  for (const [field, patterns] of Object.entries(BOOLEAN_FIELD_PATTERNS)) {
    if (patterns.some((re) => re.test(text))) {
      updates[field] = true;
    }
  }

  // 2) Bare yes/no answers resolve whichever boolean field was just asked,
  //    if the keyword pass above didn't already resolve it (spec section 14:
  //    "Haan." must resolve breathlessness after that question is asked).
  if (
    context.lastAskedField &&
    BOOLEAN_FIELDS.has(context.lastAskedField) &&
    updates[context.lastAskedField] === undefined
  ) {
    if (AFFIRMATIVE_RE.test(text)) updates[context.lastAskedField] = true;
    else if (NEGATIVE_RE.test(text)) updates[context.lastAskedField] = false;
  }

  // 3) Numeric / categorical fields.
  const severity = extractSeverity(text, context.lastAskedField);
  if (severity !== null) updates.severity = severity;

  const onset = extractOnset(text);
  if (onset !== null) updates.onset = onset;

  const character = extractCharacter(text);
  if (character !== null) updates.character = character;

  const radiation = extractRadiation(text);
  if (radiation !== null) {
    updates.radiation = radiation;
  } else if (context.lastAskedField === "radiation" && NEGATIVE_RE.test(text)) {
    // "no radiation" needs to resolve to an empty list, not fall through
    // to the free-text fallback below (which is reserved for fields where
    // arbitrary prose is a meaningful answer).
    updates.radiation = [];
  }

  const effectiveCategory = context.chiefComplaint ?? detectedCategory;
  if (effectiveCategory === "abdominal_pain") {
    const location = extractAbdomenLocation(text);
    if (location !== null) updates.location = location;
  }

  // 4) Generic fallback: only for fields where arbitrary prose IS a
  //    meaningful, storable answer (when did it start / what does it feel
  //    like / where exactly). Deliberately excludes severity (must be a
  //    1-10 number) and radiation (must be a body-part list or explicit
  //    "none") - for those, an unparseable reply should stay unresolved so
  //    it correctly triggers the ambiguous-response path instead of
  //    silently storing prose as if it were a number. This is what makes
  //    "avoid repeating questions" (spec section 11) robust to phrasing
  //    our keyword lists don't cover, without papering over genuinely
  //    unclear answers (spec section 22, Test 4).
  if (
    context.lastAskedField &&
    FREE_TEXT_FALLBACK_FIELDS.has(context.lastAskedField) &&
    updates[context.lastAskedField] === undefined &&
    text.length >= 2 &&
    !AFFIRMATIVE_RE.test(text) &&
    !NEGATIVE_RE.test(text)
  ) {
    updates[context.lastAskedField] = text;
  }

  // Seed the complaint's own presence flag so the emergency engine can see
  // e.g. chest pain as chief complaint even before every field is filled.
  const categoryToSeed = context.chiefComplaint ?? detectedCategory;
  if (categoryToSeed === "chest_pain") updates.chest_pain = true;
  if (categoryToSeed === "breathing_difficulty") updates.breathing_difficulty = true;

  return {
    updates,
    detectedCategory,
    matchedFieldCount: Object.keys(updates).length,
    languageHint: detectLanguageHint(text),
  };
}
