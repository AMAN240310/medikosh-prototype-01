import { ENV } from '../config/env.js';
import type { PatientCaseData, SupportedLanguage } from '../types/index.js';

export interface GeminiPersonalizedResponse {
  question: string;
  category: string;
  latencyMs: number;
}

export async function generateGeminiPersonalizedQuestion(
  patientCase: PatientCaseData,
  sarvamQuestion: string,
  askedQuestions: string[],
  language: SupportedLanguage
): Promise<GeminiPersonalizedResponse> {
  const started = Date.now();
  const apiKey = ENV.GEMINI_API_KEY;

  if (!apiKey) {
    console.warn('[Gemini Question 2] GEMINI_API_KEY not set. Using clinical deduplicated fallback.');
    return {
      question: language === 'hi'
        ? 'क्या आपके परिवार में किसी को ऐसी कोई पुरानी बीमारी या एलर्जी की समस्या रही है?'
        : 'Has anyone in your family had a history of similar symptoms, allergies, or chronic conditions?',
      category: 'family_history',
      latencyMs: Date.now() - started,
    };
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${ENV.GEMINI_MODEL}:generateContent`;

  const prompt = [
    'You are a clinical intake assistant responsible EXCLUSIVELY for generating the SECOND personalized follow-up question for a patient.',
    'RULES:',
    '1. Return exactly ONE concise question tailored to the patient case.',
    '2. It must NOT duplicate or overlap with the first question already asked by Sarvam: "' + sarvamQuestion + '".',
    '3. It must NOT repeat any previously asked questions: ' + JSON.stringify(askedQuestions) + '.',
    '4. Do NOT diagnose, prescribe, or mention disease names with certainty.',
    '5. The question must be understandable by the patient in the requested language: ' + language + '.',
    '',
    'Patient Case Information:',
    JSON.stringify(patientCase, null, 2),
    '',
    'Output must be strict JSON in this format:',
    '{',
    '  "question": "The single follow-up question",',
    '  "category": "one of: family_history, lifestyle_factors, previous_episodes, functional_impact"',
    '}',
  ].join('\n');

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          maxOutputTokens: 500,
          temperature: 0.2,
        },
      }),
      signal: AbortSignal.timeout(10000),
    });

    const latencyMs = Date.now() - started;

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      console.warn(`[Gemini Q2 HTTP ${response.status}]: ${body.slice(0, 200)}. Fallback used.`);
      return {
        question: language === 'hi'
          ? 'क्या यह समस्या आपके रोजमर्रा के काम या नींद को प्रभावित कर रही है?'
          : 'Is this condition affecting your sleep or ability to carry out your daily activities?',
        category: 'functional_impact',
        latencyMs,
      };
    }

    const data = (await response.json()) as any;
    const rawText = (data.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
    
    // Clean code fences if present
    const cleaned = rawText.replace(/^```json/i, '').replace(/^```/, '').replace(/```$/, '').trim();

    try {
      const parsed = JSON.parse(cleaned);
      if (parsed && typeof parsed.question === 'string') {
        return {
          question: parsed.question.trim(),
          category: parsed.category || 'personalized_detail',
          latencyMs,
        };
      }
    } catch {
      const match = rawText.match(/\{[\s\S]*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        if (parsed.question && typeof parsed.question === 'string') {
          return {
            question: parsed.question.trim(),
            category: parsed.category || 'personalized_detail',
            latencyMs,
          };
        }
      }
    }

    throw new Error(`Gemini output could not be parsed: ${rawText.slice(0, 100)}`);
  } catch (err: any) {
    console.warn('[Gemini Question 2 Error]:', err.message);
    return {
      question: language === 'hi'
        ? 'क्या यह समस्या आपके रोजमर्रा के काम या नींद को प्रभावित कर रही है?'
        : 'Is this condition affecting your sleep or daily routine in any noticeable way?',
      category: 'functional_impact',
      latencyMs: Date.now() - started,
    };
  }
}
