import type { EmergencyCheckResult, KnownInformation } from "../types/index.js";

// Fast, deterministic, conservative red-flag rules. This module must never
// call an LLM and must never be skipped - the architecture depends on
// emergencies being caught before Gemini is even considered (see spec
// section 7-9). These rules only flag situations that need urgent
// escalation; they never diagnose a condition.

const bool = (v: KnownInformation[string] | undefined): boolean => v === true;

function hasArmOrClassicRadiation(known: KnownInformation): boolean {
  const radiation = known.radiation;
  if (Array.isArray(radiation)) {
    return radiation.some((r) =>
      ["left_arm", "right_arm", "shoulder", "jaw", "back"].includes(r)
    );
  }
  return typeof radiation === "string" && radiation !== "none" && radiation.length > 0;
}

export function checkEmergency(known: KnownInformation): EmergencyCheckResult {
  const redFlags: string[] = [];

  // --- Chest pain combo -----------------------------------------------
  const chestPain = bool(known.chest_pain) || known.chief_complaint === "chest_pain";
  if (
    chestPain &&
    (bool(known.breathlessness) ||
      bool(known.fainting) ||
      bool(known.severe_weakness) ||
      hasArmOrClassicRadiation(known) ||
      bool(known.sweating))
  ) {
    redFlags.push("Chest pain with breathlessness / radiation / sweating / weakness");
  }

  // --- Stroke-like symptoms --------------------------------------------
  if (bool(known.facial_weakness) || bool(known.speech_difficulty) || bool(known.one_sided_weakness)) {
    redFlags.push("Stroke-like symptoms (facial weakness / speech difficulty / one-sided weakness)");
  }

  // --- Severe breathing difficulty -------------------------------------
  if (bool(known.severe_breathing_difficulty)) {
    redFlags.push("Severe breathing difficulty");
  }

  // --- Loss of consciousness --------------------------------------------
  if (bool(known.unconsciousness)) {
    redFlags.push("Loss of consciousness");
  }

  // --- Severe uncontrolled bleeding --------------------------------------
  if (bool(known.severe_bleeding)) {
    redFlags.push("Severe uncontrolled bleeding");
  }

  return { isEmergency: redFlags.length > 0, redFlags };
}

// Patient-facing message. Deliberately does not name a condition ("heart
// attack" etc.) - see spec section 9 and 21.
export const EMERGENCY_RESPONSE_HI =
  "आपके बताए लक्षण गंभीर हो सकते हैं। कृपया तुरंत चिकित्सा सहायता लें या नज़दीकी आपातकालीन विभाग से संपर्क करें।";
