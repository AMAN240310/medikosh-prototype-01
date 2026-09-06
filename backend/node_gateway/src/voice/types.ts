// Core domain types shared across the clinical engine, LLM fallback, and
// server transport layer. Kept in one place so state shape can't drift
// between modules.

export type ComplaintCategory =
  | "chest_pain"
  | "breathing_difficulty"
  | "abdominal_pain"
  | "headache"
  | "fever";

export type Priority = "P0" | "P1" | "P2" | "P3";

export type ConversationStatus =
  | "IN_PROGRESS"
  | "ESCALATED"
  | "COMPLETE";

export type PriorityLevel = "ROUTINE" | "CRITICAL";

// known_information is intentionally a loose bag of clinical facts keyed by
// field id (see questionBank.ts for the canonical field ids per category).
// Values are usually string | boolean | number, occasionally string[].
export type KnownInformation = Record<string, string | boolean | number | string[]>;

export interface ConversationState {
  sessionId: string;
  language: "hindi" | "hinglish" | "english" | "unknown";
  chief_complaint: ComplaintCategory | null;
  known_information: KnownInformation;
  questions_asked: string[];
  priority: PriorityLevel;
  conversation_status: ConversationStatus;
  red_flags: string[];
  lastAskedField: string | null;
  turnCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface EmergencyCheckResult {
  isEmergency: boolean;
  redFlags: string[];
}

export interface NextQuestionResult {
  done: boolean; // true when the question bank is exhausted
  questionId: string | null;
  questionText: string | null;
  priority: Priority | null;
  source: "predefined" | "gemini" | "fallback" | "opening" | "none";
  geminiUsed: boolean;
  geminiLatencyMs: number;
  geminiConfidence: number | null;
}

export interface TurnMetrics {
  sttMs: number | null;
  processingMs: number;
  geminiUsed: boolean;
  geminiMs: number;
  ttsMs: number;
  totalMs: number;
}

export interface GeminiQuestionContext {
  chief_complaint: ComplaintCategory | string;
  known_information: KnownInformation;
  questions_already_asked: string[];
  candidate_questions: string[];
}

export interface GeminiQuestionResponse {
  next_question_id: string;
  question: string;
  confidence: number;
}
