import type { GeminiQuestionContext, GeminiQuestionResponse } from "../types/index.js";

// Gemini's ONLY job (spec section 5-6): given structured context, decide
// which single predefined-bank question id is the most useful thing to ask
// next, and phrase it in Hindi. It must never be asked to diagnose,
// prescribe, or hold a free-form conversation, and it is only ever called
// when the deterministic path (emergencyRules + questionEngine) could not
// confidently decide - this module has no idea what "confidently" means,
// that logic lives entirely in questionEngine.ts.

const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const GEMINI_ENDPOINT = (model: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    next_question_id: {
      type: "string",
      description: "Must be exactly one of the candidate_questions ids provided in the input.",
    },
    question: {
      type: "string",
      description: "A single, short clinical intake question in Hindi (Devanagari), one sentence, no preamble.",
    },
    confidence: {
      type: "number",
      description: "0.0 to 1.0 - how confident you are this is the single most useful next question.",
    },
  },
  required: ["next_question_id", "question", "confidence"],
} as const;

function buildPrompt(context: GeminiQuestionContext): string {
  return [
    "You are the question-selection module inside a Hindi/Hinglish clinical intake voice agent.",
    "Your ONLY job: pick the single most clinically useful next question from candidate_questions,",
    "and phrase it in Hindi, in one short sentence a patient can answer easily by voice.",
    "",
    "Hard rules:",
    "- Do NOT diagnose, prescribe, name a disease, or suggest treatment.",
    "- Do NOT ask about anything already present in known_information.",
    "- next_question_id MUST be one of the ids listed in candidate_questions, verbatim.",
    "- question MUST be Hindi (Devanagari script), one sentence, no preamble like \"thank you\".",
    "- confidence reflects your own certainty this is the right next question, not the patient's condition.",
    "",
    "Context:",
    JSON.stringify(context, null, 2),
  ].join("\n");
}

export interface GeminiCallOutcome {
  result: GeminiQuestionResponse | null;
  latencyMs: number;
  error?: string;
}

export async function getNextQuestionFromGemini(
  context: GeminiQuestionContext
): Promise<GeminiCallOutcome> {
  const apiKey = process.env.GEMINI_API_KEY;
  const started = Date.now();

  if (!apiKey) {
    return { result: null, latencyMs: 0, error: "GEMINI_API_KEY not configured" };
  }

  try {
    const response = await fetch(GEMINI_ENDPOINT(GEMINI_MODEL), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: buildPrompt(context) }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: RESPONSE_SCHEMA,
          maxOutputTokens: 300,
          temperature: 0.2,
        },
      }),
      // Question selection is on the slow path already; don't let a hung
      // request stall the conversation indefinitely.
      signal: AbortSignal.timeout(6000),
    });

    const latencyMs = Date.now() - started;

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      return { result: null, latencyMs, error: `Gemini HTTP ${response.status}: ${body.slice(0, 200)}` };
    }

    const data = (await response.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const raw = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!raw) {
      return { result: null, latencyMs, error: "Gemini returned no content" };
    }

    const parsed = JSON.parse(raw) as GeminiQuestionResponse;
    if (
      typeof parsed.next_question_id !== "string" ||
      typeof parsed.question !== "string" ||
      typeof parsed.confidence !== "number"
    ) {
      return { result: null, latencyMs, error: "Gemini response failed shape validation" };
    }

    // Refuse anything not in the offered candidate list, regardless of the
    // confidence Gemini claims - this keeps Gemini strictly inside "pick
    // one of these", never free-form question generation.
    if (!context.candidate_questions.includes(parsed.next_question_id)) {
      return { result: null, latencyMs, error: "Gemini picked an id outside candidate_questions" };
    }

    return { result: parsed, latencyMs };
  } catch (err) {
    const latencyMs = Date.now() - started;
    const message = err instanceof Error ? err.message : String(err);
    return { result: null, latencyMs, error: `Gemini call failed: ${message}` };
  }
}
