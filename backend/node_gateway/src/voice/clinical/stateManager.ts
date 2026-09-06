import type { ComplaintCategory, ConversationState, KnownInformation } from "../types/index.js";

// Deliberately in-memory (spec section 16: "No database calls during the
// voice loop"). State lives only as long as the socket connection does.
const sessions = new Map<string, ConversationState>();

export function createSession(sessionId: string): ConversationState {
  const now = Date.now();
  const state: ConversationState = {
    sessionId,
    language: "unknown",
    chief_complaint: null,
    known_information: {},
    questions_asked: [],
    priority: "ROUTINE",
    conversation_status: "IN_PROGRESS",
    red_flags: [],
    lastAskedField: null,
    turnCount: 0,
    createdAt: now,
    updatedAt: now,
  };
  sessions.set(sessionId, state);
  return state;
}

export function getSession(sessionId: string): ConversationState | undefined {
  return sessions.get(sessionId);
}

export function deleteSession(sessionId: string): void {
  sessions.delete(sessionId);
}

export function activeSessionCount(): number {
  return sessions.size;
}

export function mergeExtraction(
  state: ConversationState,
  updates: KnownInformation,
  detectedCategory: ComplaintCategory | null,
  languageHint: ConversationState["language"]
): void {
  if (!state.chief_complaint && detectedCategory) {
    state.chief_complaint = detectedCategory;
  }
  state.known_information = { ...state.known_information, ...updates };
  if (languageHint !== "unknown") state.language = languageHint;
  state.turnCount += 1;
  state.updatedAt = Date.now();
}

export function recordQuestionAsked(state: ConversationState, questionId: string | null): void {
  if (questionId && !state.questions_asked.includes(questionId)) {
    state.questions_asked.push(questionId);
  }
  state.lastAskedField = questionId;
  state.updatedAt = Date.now();
}

export function markEscalated(state: ConversationState, redFlags: string[]): void {
  state.priority = "CRITICAL";
  state.conversation_status = "ESCALATED";
  state.red_flags = redFlags;
  state.updatedAt = Date.now();
}

export function markComplete(state: ConversationState): void {
  state.conversation_status = "COMPLETE";
  state.updatedAt = Date.now();
}
