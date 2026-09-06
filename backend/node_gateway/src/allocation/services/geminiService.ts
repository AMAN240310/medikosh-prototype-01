import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import { PatientAnalysis, Urgency, VisitType, Complexity } from "../types";

// ============================================================================
// STEP 1: Analyze the raw patient summary with Gemini.
//
// Gemini's ONLY job is intake extraction — it never chooses a doctor or a
// time slot. It returns strictly-structured JSON that Node.js then uses for
// eligibility filtering (Step 2) and ranking (Step 4).
// ============================================================================

const SYSTEM_INSTRUCTION = `
You are a clinical intake triage assistant for a hospital scheduling system.
Your ONLY job is to read a patient summary and extract structured intake data.

STRICT RULES:
- Do NOT diagnose the patient or suggest treatment.
- Use ONLY information explicitly present in the patient summary. Never invent facts.
- If the required specialty is unclear or not stated, use "General Medicine".
- If urgency is unclear, use "MEDIUM".
- Do NOT invent a previous doctor. If none is mentioned, set previousDoctorId to null.
- Set requestedDoctor ONLY if the patient explicitly asks for a specific doctor by
  name or ID. Otherwise it must be null.
- Return ONLY the JSON object described by the response schema — no commentary,
  no markdown fences, no extra keys.
`;

const RESPONSE_SCHEMA = {
  type: SchemaType.OBJECT,
  properties: {
    requiredSpecialty: { type: SchemaType.STRING },
    urgency: { type: SchemaType.STRING, enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL"] },
    visitType: { type: SchemaType.STRING, enum: ["NEW", "FOLLOW_UP"] },
    complexity: { type: SchemaType.STRING, enum: ["LOW", "MEDIUM", "HIGH"] },
    requestedDoctor: { type: SchemaType.STRING, nullable: true },
    previousDoctorId: { type: SchemaType.STRING, nullable: true },
    reasoning: { type: SchemaType.STRING },
  },
  required: [
    "requiredSpecialty",
    "urgency",
    "visitType",
    "complexity",
    "requestedDoctor",
    "previousDoctorId",
    "reasoning",
  ],
};

let client: GoogleGenerativeAI | null = null;

function getClient(): GoogleGenerativeAI {
  if (!client) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error(
        "GEMINI_API_KEY is not set. Add it to your .env file before calling /api/allocate."
      );
    }
    client = new GoogleGenerativeAI(apiKey);
  }
  return client;
}

/**
 * Intelligent rule-based clinical heuristic fallback if external AI is unavailable or rate-limited.
 */
function heuristicAnalysis(summary: string): PatientAnalysis {
  const lower = summary.toLowerCase();
  
  let requiredSpecialty = "General Medicine";
  if (/\b(headache|migraine|brain|seizure|numbness|neurolog|nerve|paralysis|concussion|dizziness|vertigo|stroke)\b/.test(lower)) {
    requiredSpecialty = "Neurology";
  } else if (/\b(heart|chest pain|palpitation|cardiolog|angina|hypertension|bp|blood pressure|breathless|shortness of breath)\b/.test(lower)) {
    requiredSpecialty = "Cardiology";
  } else if (/\b(bone|joint|fracture|orthoped|knee|spine|back pain|arthritis|sprain|ligament|shoulder)\b/.test(lower)) {
    requiredSpecialty = "Orthopedics";
  } else if (/\b(child|infant|pediatric|baby|kid|toddler|vaccination)\b/.test(lower)) {
    requiredSpecialty = "Pediatrics";
  } else if (/\b(skin|rash|dermatolog|itching|acne|eczema|psoriasis|allergy|blister)\b/.test(lower)) {
    requiredSpecialty = "Dermatology";
  }

  let urgency: Urgency = "MEDIUM";
  if (/\b(severe|critical|emergency|unbearable|bleeding|intense|acute|high)\b/.test(lower)) {
    urgency = "HIGH";
  } else if (/\b(mild|routine|checkup|regular|slight)\b/.test(lower)) {
    urgency = "LOW";
  }

  return {
    requiredSpecialty,
    urgency,
    visitType: "NEW",
    complexity: "MEDIUM",
    requestedDoctor: null,
    previousDoctorId: null,
    reasoning: `Rule-based clinical heuristic triage: matched ${requiredSpecialty} based on symptom keywords.`
  };
}

/**
 * Analyze the raw patient summary text with Gemini and return strictly
 * structured case requirements, falling back gracefully to heuristic triage
 * if rate limit or quota is exceeded.
 */
export async function analyzePatientSummary(patientSummary: string): Promise<PatientAnalysis> {
  const modelsToTry = [
    process.env.GEMINI_MODEL || "gemini-2.5-flash",
    "gemini-1.5-flash",
    "gemini-2.0-flash"
  ];

  try {
    const genAI = getClient();
    for (const modelName of modelsToTry) {
      try {
        const model = genAI.getGenerativeModel({
          model: modelName,
          systemInstruction: SYSTEM_INSTRUCTION,
          generationConfig: {
            responseMimeType: "application/json",
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            responseSchema: RESPONSE_SCHEMA as any,
            temperature: 0.1,
          },
        });

        const result = await model.generateContent(patientSummary);
        const text = result.response.text();
        const parsed = JSON.parse(text);
        return normalizeAnalysis(parsed);
      } catch (err: any) {
        console.warn(`[Triage] Gemini model ${modelName} error: ${err.message || err}. Attempting fallback...`);
      }
    }
  } catch (err: any) {
    console.warn(`[Triage] Gemini client error: ${err.message || err}. Falling back to clinical heuristic.`);
  }

  console.log(`[Triage] Using clinical rule-based heuristic triage fallback.`);
  return heuristicAnalysis(patientSummary);
}

/**
 * Defensive normalization: even with a response schema, we never trust an
 * external model's output blindly. Anything outside the allowed enum values
 * falls back to the documented safe defaults.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeAnalysis(raw: any): PatientAnalysis {
  const urgency: Urgency = ["LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(raw?.urgency)
    ? raw.urgency
    : "MEDIUM";
  const visitType: VisitType = ["NEW", "FOLLOW_UP"].includes(raw?.visitType) ? raw.visitType : "NEW";
  const complexity: Complexity = ["LOW", "MEDIUM", "HIGH"].includes(raw?.complexity)
    ? raw.complexity
    : "MEDIUM";

  return {
    requiredSpecialty: (raw?.requiredSpecialty && String(raw.requiredSpecialty).trim()) || "General Medicine",
    urgency,
    visitType,
    complexity,
    requestedDoctor: raw?.requestedDoctor || null,
    previousDoctorId: raw?.previousDoctorId || null,
    reasoning: raw?.reasoning || "",
  };
}
