import { ENV } from '../config/env.js';
import type { ConversationTurn, PatientCaseData, SupportedLanguage } from '../types/index.js';

export interface SarvamChatTurnResponse {
  assistantResponse: string;
  nextQuestion: string;
  questionTopic: string;
  isSufficient: boolean;
}

const LANGUAGE_PROMPTS: Record<SupportedLanguage, string> = {
  hi: 'आप एक सहानुभूतिपूर्ण और पेशेवर नैदानिक इनटेक सहायक (Clinical Intake Assistant) हैं। मरीज से सरल, स्पष्ट हिन्दी में बात करें।',
  en: 'You are an empathetic and professional Clinical Intake Assistant. Speak to the patient in simple, clear English.',
  bn: 'আপনি একজন সহানুভূতিশীল এবং পেশাদার ক্লিনিক্যাল ইনটেক সহকারী। রোগীর সাথে সহজ বাংলায় কথা বলুন।',
  ta: 'நீங்கள் ஒரு இரக்கமுள்ள மற்றும் தொழில்முறை மருத்துவ உட்கொள்ளல் உதவியாளர். நோயாளியிடம் எளிய தமிழில் பேசுங்கள்.',
  te: 'మీరు దయగల మరియు వృత్తిపరమైన క్లినికల్ ఇన్‌టేక్ అసిస్టెంట్. రోగితో సరళమైన తెలుగులో మాట్లాడండి.',
  kn: 'ನೀವು ಸಹಾನುಭೂತಿಯುಳ್ಳ ಕ್ಲಿನಿಕಲ್ ಇನ್‌ಟೇಕ್ ಅಸಿಸ್ಟೆಂಟ್. ರೋಗಿಯೊಂದಿಗೆ ಸರಳ ಕನ್ನಡದಲ್ಲಿ ಮಾತನಾಡಿ.',
  ml: 'നിങ്ങൾ ഒരു സഹാനുഭൂതിയുള്ള ക്ലിനിക്കൽ ഇൻടേക്ക് അസിസ്റ്റന്റാണ്. രോഗിയോട് ലളിതമായ മലയാളത്തിൽ സംസാരിക്കുക.',
  mr: 'तुम्ही एक दयाळू आणि व्यावसायिक क्लिनिकल इनटेक असिस्टंट आहात. रुग्णाशी सोप्या मराठीत बोला.',
  gu: 'તમે એક સહાનુભૂતિપૂર્ણ ક્લિનિકલ ઇનટેક આસિસ્ટન્ટ છો. દર્દી સાથે સરળ ગુજરાતીમાં વાત કરો.',
  pa: 'ਤੁਸੀਂ ਇੱਕ ਹਮਦਰਦ ਕਲੀਨਿਕਲ ਇਨਟੇਕ ਅਸਿਸਟੈਂਟ ਹੋ। ਮਰੀਜ਼ ਨਾਲ ਸਧਾਰਨ ਪੰਜਾਬੀ ਵਿੱਚ ਗੱਲ ਕਰੋ।',
  od: 'ଆପଣ ଜଣେ ଦୟାଳୁ କ୍ଲିନିକାଲ୍ ଇନଟେକ୍ ଆସିଷ୍ଟାଣ୍ଟ। ରୋଗୀ ସହିତ ସରଳ ଓଡ଼ିଆରେ କଥା ହୁଅନ୍ତୁ।',
};

export async function generateSarvamTurn(
  turns: ConversationTurn[],
  patientCase: PatientCaseData,
  askedTopics: string[],
  missingInfo: string[],
  language: SupportedLanguage
): Promise<SarvamChatTurnResponse> {
  const apiKey = ENV.SARVAM_API_KEY;

  const patientStatements = turns.filter(t => t.role === 'patient').map((t, i) => `Statement ${i + 1}: "${t.text}"`);

  const systemInstructions = [
    LANGUAGE_PROMPTS[language] || LANGUAGE_PROMPTS.hi,
    'CRITICAL MEDICAL INTAKE RULES:',
    '1. You are an INTAKE ASSISTANT, NOT a doctor. Do NOT diagnose, prescribe drugs, or guess diseases.',
    '2. Ask exactly ONE clear, brief question at a time to understand their condition.',
    '3. ABSOLUTE ZERO-DUPLICATION RULE: Review all patient statements below carefully. You MUST NEVER ask about anything the patient already stated (e.g. onset, when it started, duration, severity, location, medications, eye drops, or allergies).',
    'PATIENT STATEMENTS SO FAR:',
    ...patientStatements,
    '',
    'ALREADY ASKED TOPICS: ' + JSON.stringify(askedTopics),
    'KNOWN EXTRACTED FACTS: ' + JSON.stringify({
      chiefComplaint: patientCase.chiefComplaint,
      duration: patientCase.duration,
      location: patientCase.location,
      severity: patientCase.severity,
      medications: patientCase.medications,
      allergies: patientCase.allergies,
      history: patientCase.medicalHistory,
    }),
    'Missing information that could be relevant: ' + JSON.stringify(missingInfo),
    patientStatements.length >= 4 
      ? 'SUFFICIENT DETAIL REACHED: The patient has answered 4 or more rounds. If all core clinical facts (symptoms, duration, severity, history) are covered, you may set "isSufficient": true and acknowledge all details are noted.'
      : `MANDATORY 4-QUESTION INTAKE RULE: The patient has only answered ${patientStatements.length} question(s) so far. You MUST ask at least 4 distinct questions total across the intake to properly understand their condition. DO NOT set isSufficient to true yet. Set "isSufficient": false and ask the next clinical question regarding missing topics (duration, location, severity, triggers, associated symptoms, medical history, medications, or allergies).`,
    'Respond strictly in valid JSON format:',
    '{',
    '  "assistantResponse": "Short empathetic acknowledgment + next question",',
    '  "nextQuestion": "The specific question asked",',
    '  "questionTopic": "one of: duration, location, severity, triggers, associated_symptoms, medical_history, medications, allergies, other",',
    '  "isSufficient": true/false',
    '}',
  ].join('\n');

  if (!apiKey) {
    // Deterministic dynamic fallback when no Sarvam API key is supplied
    return generateFallbackTurn(patientCase, askedTopics, language, patientStatements.length);
  }

  try {
    const messages = [
      { role: 'system', content: systemInstructions },
      // Send the entire conversation history (up to 20 turns) so model never forgets Turn 1
      ...turns.slice(-20).map((t) => ({
        role: t.role === 'patient' ? 'user' : 'assistant',
        content: t.text,
      })),
    ];

    const response = await fetch('https://api.sarvam.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'api-subscription-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: ENV.SARVAM_CHAT_MODEL || 'sarvam-105b-conversations',
        messages,
        temperature: 0.2,
      }),
      signal: AbortSignal.timeout(12000),
    });

    if (!response.ok) {
      const err = await response.text().catch(() => '');
      console.warn(`[Sarvam Chat HTTP ${response.status}]: ${err.slice(0, 200)}. Using clinical fallback.`);
      return generateFallbackTurn(patientCase, askedTopics, language, patientStatements.length);
    }

    const data = (await response.json()) as any;
    const content = data.choices?.[0]?.message?.content || '';

    // 1. Try parsing Sarvam-specific <tool_call> XML format (e.g. <tool_call>json<arg_key>...</arg_key>...)
    const toolCallParsed = parseToolCallXml(content);
    if (toolCallParsed) {
      const resp = cleanAssistantMessage(toolCallParsed.assistantResponse || toolCallParsed.nextQuestion || '');
      const nextQ = cleanAssistantMessage(toolCallParsed.nextQuestion || toolCallParsed.assistantResponse || '');
      return {
        assistantResponse: resp || nextQ,
        nextQuestion: nextQ || resp,
        questionTopic: toolCallParsed.questionTopic || 'duration',
        isSufficient: patientStatements.length >= 4 && Boolean(toolCallParsed.isSufficient),
      };
    }

    // 2. Extract JSON block if wrapped in markdown or raw JSON
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        const resp = cleanAssistantMessage(parsed.assistantResponse || parsed.nextQuestion || '');
        const nextQ = cleanAssistantMessage(parsed.nextQuestion || parsed.assistantResponse || '');
        return {
          assistantResponse: resp || nextQ,
          nextQuestion: nextQ || resp,
          questionTopic: parsed.questionTopic || 'symptoms',
          // Strictly require at least 4 patient statements before isSufficient can be true
          isSufficient: patientStatements.length >= 4 && Boolean(parsed.isSufficient),
        };
      } catch {}
    }

    // 3. Fallback: Clean any leaked XML/tool tags and return the text
    const cleanedText = cleanAssistantMessage(content);
    return {
      assistantResponse: cleanedText,
      nextQuestion: cleanedText,
      questionTopic: 'general',
      isSufficient: false,
    };
  } catch (err: any) {
    console.warn('[Sarvam Chat Exception]:', err.message, 'Using clinical fallback.');
    return generateFallbackTurn(patientCase, askedTopics, language, patientStatements.length);
  }
}

export function parseToolCallXml(content: string): Record<string, any> | null {
  const toolCallMatch = content.match(/<tool_call[\s\S]*?<\/tool_call>/i) || content.match(/<tool_call[\s\S]*$/i);
  if (!toolCallMatch) return null;

  const xmlBlock = toolCallMatch[0];
  const result: Record<string, any> = {};

  const regex = /<arg_key>(.*?)<\/arg_key>\s*<arg_value>([\s\S]*?)<\/arg_value>/gi;
  let match;
  while ((match = regex.exec(xmlBlock)) !== null) {
    const key = match[1].trim();
    let val = match[2].trim();
    if (val === 'true') {
      result[key] = true;
    } else if (val === 'false') {
      result[key] = false;
    } else {
      result[key] = val;
    }
  }

  return Object.keys(result).length > 0 ? result : null;
}

export function cleanAssistantMessage(rawText: string): string {
  if (!rawText) return '';
  return rawText
    .replace(/<tool_call[\s\S]*?<\/tool_call>/gi, '')
    .replace(/<tool_call[\s\S]*$/gi, '')
    .replace(/<\/?(?:tool_call|arg_key|arg_value|function_call|action|thought|tool_code|json)[^>]*>/gi, '')
    .replace(/```(?:json)?[\s\S]*?```/gi, '')
    .trim();
}

export async function generateSarvamPersonalizedQuestion(
  patientCase: PatientCaseData,
  language: SupportedLanguage
): Promise<{ question: string; category: string }> {
  const apiKey = ENV.SARVAM_API_KEY;

  if (!apiKey) {
    // Intelligent fallback for Q1
    if (language === 'hi') {
      return {
        question: 'क्या इस समस्या के लिए आपने पहले कोई दवा या घरेलू उपचार लिया है?',
        category: 'prior_treatment',
      };
    }
    return {
      question: 'Have you taken any medication or prior treatment for this specific condition?',
      category: 'prior_treatment',
    };
  }

  const prompt = [
    LANGUAGE_PROMPTS[language] || LANGUAGE_PROMPTS.hi,
    'Based on this collected case:',
    JSON.stringify(patientCase),
    'Generate exactly ONE clinically relevant follow-up question (Question 1) exploring previous treatments or aggravating factors.',
    'Respond in JSON: {"question": "...", "category": "..."}',
  ].join('\n');

  try {
    const response = await fetch('https://api.sarvam.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'api-subscription-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: ENV.SARVAM_CHAT_MODEL || 'sarvam-105b-conversations',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2,
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (response.ok) {
      const data = (await response.json()) as any;
      const content = data.choices?.[0]?.message?.content || '';

      const toolCallParsed = parseToolCallXml(content);
      if (toolCallParsed && (toolCallParsed.question || toolCallParsed.assistantResponse)) {
        return {
          question: cleanAssistantMessage(toolCallParsed.question || toolCallParsed.assistantResponse),
          category: toolCallParsed.category || 'prior_treatment',
        };
      }

      const match = content.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          const parsed = JSON.parse(match[0]);
          if (parsed.question) {
            return {
              question: cleanAssistantMessage(parsed.question),
              category: parsed.category || 'prior_treatment',
            };
          }
        } catch {}
      }

      const cleaned = cleanAssistantMessage(content);
      if (cleaned) {
        return {
          question: cleaned,
          category: 'prior_treatment',
        };
      }
    }
  } catch (err) {
    console.warn('[Sarvam Personalized Q1 error]:', err);
  }

  return {
    question: language === 'hi' 
      ? 'क्या यह दर्द या समस्या किसी खास समय (जैसे सुबह या रात) ज्यादा बढ़ती है?' 
      : 'Does this symptom or pain worsen at any particular time of day or night?',
    category: 'progression',
  };
}

function generateFallbackTurn(
  patientCase: PatientCaseData,
  askedTopics: string[],
  language: SupportedLanguage,
  patientTurnCount: number = 0
): SarvamChatTurnResponse {
  // Ordered clinical priorities
  const questionsHi: Record<string, { q: string; topic: string }> = {
    duration: { q: 'यह समस्या आपको कितने दिनों या समय से हो रही है, और क्या यह अचानक शुरू हुई थी या धीरे-धीरे?', topic: 'duration' },
    location: { q: 'क्या आप बता सकते हैं कि यह दर्द या परेशानी शरीर के किस हिस्से में सबसे ज्यादा महसूस हो रही है?', topic: 'location' },
    severity: { q: 'इस दर्द या परेशानी की तीव्रता 1 से 10 के पैमाने पर कितनी होगी — हल्की, मध्यम या बहुत तेज?', topic: 'severity' },
    triggers: { q: 'क्या यह परेशानी किसी खास काम, खाने या तनाव के बाद बढ़ती या घटती है?', topic: 'triggers' },
    associated_symptoms: { q: 'क्या इसके साथ आपको बुखार, उल्टी, चक्कर या अत्यधिक कमजोरी जैसे कोई अन्य लक्षण महसूस हो रहे हैं?', topic: 'associated_symptoms' },
    medical_history: { q: 'क्या आपको पहले से कोई पुरानी बीमारी जैसे डायबिटीज, बीपी या थायरॉइड है?', topic: 'medical_history' },
    medications: { q: 'क्या आप वर्तमान में किसी बीमारी की कोई नियमित दवा ले रहे हैं?', topic: 'medications' },
    allergies: { q: 'क्या आपको किसी दवा, इंजेक्शन या खाने की चीज से कोई एलर्जी है?', topic: 'allergies' },
  };

  const questionsEn: Record<string, { q: string; topic: string }> = {
    duration: { q: 'How long have you been experiencing this problem, and did it start suddenly or gradually?', topic: 'duration' },
    location: { q: 'Could you clarify the exact location of the discomfort or pain, and does it spread anywhere?', topic: 'location' },
    severity: { q: 'On a scale of 1 to 10 (or mild, moderate, severe), how intense would you describe this discomfort?', topic: 'severity' },
    triggers: { q: 'Does anything specific seem to trigger, worsen, or relieve the symptoms?', topic: 'triggers' },
    associated_symptoms: { q: 'Are you experiencing any other accompanying symptoms such as fever, nausea, dizziness, or fatigue?', topic: 'associated_symptoms' },
    medical_history: { q: 'Do you have any pre-existing medical conditions like diabetes, hypertension, or asthma?', topic: 'medical_history' },
    medications: { q: 'Are you currently taking any regular prescription or over-the-counter medications?', topic: 'medications' },
    allergies: { q: 'Do you have any known allergies to medicines, foods, or other substances?', topic: 'allergies' },
  };

  const questions = language === 'hi' ? questionsHi : questionsEn;
  const orderedTopics = [
    'duration',
    'location',
    'severity',
    'triggers',
    'associated_symptoms',
    'medical_history',
    'medications',
    'allergies',
  ];

  // Pick next unasked topic
  for (const topic of orderedTopics) {
    if (!askedTopics.includes(topic)) {
      const qObj = questions[topic] || questions.duration;
      return {
        assistantResponse: qObj.q,
        nextQuestion: qObj.q,
        questionTopic: qObj.topic,
        isSufficient: false,
      };
    }
  }

  // If patient has answered fewer than 4 questions, guarantee another relevant clinical topic
  if (patientTurnCount < 4) {
    const qObj = questions.associated_symptoms;
    return {
      assistantResponse: qObj.q,
      nextQuestion: qObj.q,
      questionTopic: 'associated_symptoms',
      isSufficient: false,
    };
  }

  // If at least 4 turns have been completed and core facts collected, mark isSufficient
  const completionMsg = language === 'hi'
    ? 'धन्यवाद, आपकी प्राथमिक जानकारी नोट कर ली गई है। अब हम अगले चरण के लिए आगे बढ़ रहे हैं।'
    : 'Thank you, your clinical intake details have been thoroughly noted. We are now proceeding to the next step.';

  return {
    assistantResponse: completionMsg,
    nextQuestion: completionMsg,
    questionTopic: 'complete',
    isSufficient: true,
  };
}
