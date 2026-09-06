import type {
  ComplaintCategory,
  ConversationState,
  GeminiQuestionContext,
  KnownInformation,
  NextQuestionResult,
  Priority,
} from "../types/index.js";
import {
  CATEGORY_CLARIFY_QUESTION_HI,
  COMPLETION_MESSAGE_HI,
  QUESTION_BANKS,
  SAFE_FALLBACK_QUESTION,
  type BankQuestion,
} from "./questionBank.js";
import { getNextQuestionFromGemini } from "../llm/geminiFallback.js";

const PRIORITY_ORDER: Priority[] = ["P0", "P1", "P2", "P3"];

function pickHighestPriorityUnanswered(
  category: ComplaintCategory,
  known: KnownInformation,
  questionsAsked: string[]
): BankQuestion | null {
  const bank = QUESTION_BANKS[category];
  const remaining = bank.filter(
    (q) => !questionsAsked.includes(q.id) && known[q.id] === undefined
  );
  if (remaining.length === 0) return null;

  for (const priority of PRIORITY_ORDER) {
    const match = remaining.find((q) => q.priority === priority);
    if (match) return match;
  }
  return remaining[0];
}

function remainingCandidateIds(
  category: ComplaintCategory,
  known: KnownInformation,
  questionsAsked: string[]
): string[] {
  return QUESTION_BANKS[category]
    .filter((q) => !questionsAsked.includes(q.id) && known[q.id] === undefined)
    .map((q) => q.id);
}

/**
 * Decide the next thing to say to the patient. Never called when the
 * emergency engine has already fired - that short-circuits before this is
 * reached (see server.ts).
 *
 * turnHadResolution: whether this turn's extraction resolved the field we
 * had just asked about (state.lastAskedField). This is the confidence
 * signal that decides fast-path vs Gemini - see questionEngine design
 * notes in README for why it's keyed this way rather than a raw "did we
 * extract anything at all" count.
 */
export async function selectNextQuestion(
  state: ConversationState,
  turnHadResolution: boolean
): Promise<NextQuestionResult> {
  const { chief_complaint, known_information, questions_asked, lastAskedField } = state;

  // No category yet at all -> can't build a Gemini context or a bank.
  if (!chief_complaint) {
    return {
      done: false,
      questionId: "category_clarify",
      questionText: CATEGORY_CLARIFY_QUESTION_HI,
      priority: "P0",
      source: "fallback",
      geminiUsed: false,
      geminiLatencyMs: 0,
      geminiConfidence: null,
    };
  }

  const isOpeningExchange = lastAskedField === null;
  const confidentEnoughForFastPath = isOpeningExchange || turnHadResolution;

  if (confidentEnoughForFastPath) {
    const next = pickHighestPriorityUnanswered(chief_complaint, known_information, questions_asked);
    if (next) {
      return {
        done: false,
        questionId: next.id,
        questionText: next.hi,
        priority: next.priority,
        source: "predefined",
        geminiUsed: false,
        geminiLatencyMs: 0,
        geminiConfidence: null,
      };
    }
    // Bank exhausted.
    return {
      done: true,
      questionId: null,
      questionText: COMPLETION_MESSAGE_HI,
      priority: null,
      source: "none",
      geminiUsed: false,
      geminiLatencyMs: 0,
      geminiConfidence: null,
    };
  }

  // --- Slow path: ambiguous response to a specific question. -------------
  const candidateIds = remainingCandidateIds(chief_complaint, known_information, questions_asked);

  if (candidateIds.length === 0) {
    return {
      done: true,
      questionId: null,
      questionText: COMPLETION_MESSAGE_HI,
      priority: null,
      source: "none",
      geminiUsed: false,
      geminiLatencyMs: 0,
      geminiConfidence: null,
    };
  }

  const context: GeminiQuestionContext = {
    chief_complaint,
    known_information,
    questions_already_asked: questions_asked,
    candidate_questions: candidateIds,
  };

  const { result, latencyMs, error } = await getNextQuestionFromGemini(context);

  if (result && result.confidence >= 0.75) {
    const bank = QUESTION_BANKS[chief_complaint];
    const matched = bank.find((q) => q.id === result.next_question_id);
    return {
      done: false,
      questionId: result.next_question_id,
      questionText: result.question,
      priority: matched?.priority ?? "P2",
      source: "gemini",
      geminiUsed: true,
      geminiLatencyMs: latencyMs,
      geminiConfidence: result.confidence,
    };
  }

  // Gemini unavailable, errored, or below the 0.75 confidence bar (spec
  // section 6) -> fall back to a predefined safe question rather than
  // trusting a low-confidence result.
  if (error && process.env.NODE_ENV !== "production") {
    // eslint-disable-next-line no-console
    console.warn("[gemini fallback] not used this turn:", error);
  }
  return {
    done: false,
    questionId: SAFE_FALLBACK_QUESTION.id,
    questionText: SAFE_FALLBACK_QUESTION.hi,
    priority: SAFE_FALLBACK_QUESTION.priority,
    source: "fallback",
    geminiUsed: true,
    geminiLatencyMs: latencyMs,
    geminiConfidence: result?.confidence ?? null,
  };
}
