// ============================================================================
// Specialty matching rules, shared by eligibility filtering (Step 2/5) and
// continuity-of-care logic (Step 3), so both use the exact same definition
// of "clinically related" instead of two ad-hoc implementations drifting
// apart over time.
//
// These groups are deliberately conservative and explicit — this is the
// "controlled matching" and "explicit fallback rule" the spec calls for,
// not a blanket "anything unavailable falls back to General Medicine".
// ============================================================================

/**
 * Specialties General Medicine is considered a clinically reasonable
 * first-line fallback for (undifferentiated cases in these areas are
 * commonly triaged by a GP). Deliberately EXCLUDES Dermatology, Pediatrics,
 * and Emergency Medicine — those require specialist-specific training a
 * General Medicine doctor should not be assumed to substitute for.
 */
export const RELATED_SPECIALTY_GROUPS: string[][] = [
  ["General Medicine", "Cardiology"],
  ["General Medicine", "Gastroenterology"],
  ["General Medicine", "Neurology"],
  ["General Medicine", "Orthopedics"],
];

/** Specialties for which falling back to General Medicine is an approved,
 * explicit rule when no specialist is eligible. Derived from the groups
 * above, kept as an explicit set so the "explicit fallback rule" language
 * in the spec maps to one obvious place in the code. */
export const GENERAL_MEDICINE_FALLBACK_ALLOWED = new Set(
  RELATED_SPECIALTY_GROUPS.flat().filter((s) => s !== "General Medicine")
);

export function normalizeSpecialty(specialty: string): string {
  return specialty.trim().toLowerCase();
}

export function isExactSpecialtyMatch(a: string, b: string): boolean {
  return normalizeSpecialty(a) === normalizeSpecialty(b);
}

/** True if `a` and `b` are the same specialty, or both appear together in an
 * approved related-specialty group (currently: General Medicine <-> a
 * specific set of specialist fields). */
export function areSpecialtiesRelated(a: string, b: string): boolean {
  if (isExactSpecialtyMatch(a, b)) return true;
  return RELATED_SPECIALTY_GROUPS.some(
    (group) =>
      group.some((s) => isExactSpecialtyMatch(s, a)) && group.some((s) => isExactSpecialtyMatch(s, b))
  );
}

/** True only for CRITICAL cases where an Emergency Medicine doctor is an
 * approved cross-specialty stand-in for any required specialty. */
export function isEmergencyCrossCoverAllowed(doctorSpecialty: string, urgency: string): boolean {
  return urgency === "CRITICAL" && isExactSpecialtyMatch(doctorSpecialty, "Emergency Medicine");
}

/** Whether General Medicine is an approved fallback for `requiredSpecialty`
 * under the explicit fallback rule (see GENERAL_MEDICINE_FALLBACK_ALLOWED). */
export function isGeneralMedicineFallbackAllowed(requiredSpecialty: string): boolean {
  if (isExactSpecialtyMatch(requiredSpecialty, "General Medicine")) return false;
  return [...GENERAL_MEDICINE_FALLBACK_ALLOWED].some((s) => isExactSpecialtyMatch(s, requiredSpecialty));
}
