import { Doctor, EligibleDoctor, PatientAnalysis } from "../types";
import { isDoctorCurrentlyAvailable } from "./eligibilityService";
import { areSpecialtiesRelated } from "../utils/specialtyMatching";

export interface ContinuityResult {
  // ---- Previous doctor (follow-up continuity) ----
  previousDoctor: Doctor | null;
  previousDoctorValidated: boolean;
  previousDoctorSpecialty: string | null;
  previousDoctorCurrentlyAvailable: boolean;
  continuityApplicable: boolean;
  continuityReason: string;

  // ---- Explicitly requested doctor ----
  requestedDoctor: Doctor | null;
  requestedDoctorValidated: boolean;
  requestedDoctorAvailable: boolean;
  requestedDoctorSuitable: boolean;

  notes: string[];
}

// ============================================================================
// STEP 3: Follow-up & Continuity Logic
//
// The key fix here: "patient saw this doctor before" and "this doctor is
// right for the current condition" are two SEPARATE facts. A continuity
// bonus is only applied when both hold:
//   (a) previousDoctorId resolves to a real doctor (previousDoctorValidated)
//   (b) that doctor's specialty is the same as, or clinically related to,
//       requiredSpecialty (continuityApplicable)
// A previous Dermatologist does not get a continuity bonus on a new
// Cardiology case just because the patient saw them before.
//
// STEP 4: Requested Doctor Logic
//
// Gemini's `requestedDoctor` string is never trusted as-is. It is resolved
// against the real doctor dataset, and validated on three independent axes:
//   - requestedDoctorValidated: does this doctor exist at all?
//   - requestedDoctorAvailable: are they active / not on leave / under capacity?
//   - requestedDoctorSuitable: is their specialty right for this case?
// A request is only a *strong* ranking signal when all three are true. If
// the doctor doesn't exist, the reference is safely ignored. If they exist
// but aren't suitable, they are never silently assigned — normal
// specialty-based allocation proceeds and the mismatch is explained.
// ============================================================================

function resolveDoctorByIdOrName(needle: string, allDoctors: Doctor[]): Doctor | null {
  const normalized = needle.trim().toLowerCase();
  return (
    allDoctors.find((d) => d.id.toLowerCase() === normalized) ||
    allDoctors.find((d) => d.name.toLowerCase() === normalized) ||
    allDoctors.find((d) => d.name.toLowerCase().includes(normalized)) ||
    null
  );
}

export function evaluateContinuity(
  eligibleDoctors: EligibleDoctor[],
  allDoctors: Doctor[],
  analysis: PatientAnalysis
): ContinuityResult {
  const notes: string[] = [];
  const eligibleIds = new Set(eligibleDoctors.map((e) => e.doctor.id));

  // ---- Previous doctor ----
  let previousDoctor: Doctor | null = null;
  let previousDoctorValidated = false;
  let previousDoctorSpecialty: string | null = null;
  let previousDoctorCurrentlyAvailable = false;
  let continuityApplicable = false;
  let continuityReason = "Not a follow-up visit, or no previous doctor was specified.";

  if (analysis.visitType === "FOLLOW_UP" && analysis.previousDoctorId) {
    const match = allDoctors.find((d) => d.id === analysis.previousDoctorId) || null;
    previousDoctor = match;
    previousDoctorValidated = !!match;

    if (match) {
      previousDoctorSpecialty = match.specialty;
      previousDoctorCurrentlyAvailable = isDoctorCurrentlyAvailable(match);
      const related = areSpecialtiesRelated(match.specialty, analysis.requiredSpecialty);
      continuityApplicable = related;

      if (related && eligibleIds.has(match.id)) {
        continuityReason = `Previous doctor ${match.name} (${match.specialty}) is clinically appropriate for this ${analysis.requiredSpecialty} case and is currently available — continuity bonus applied.`;
        notes.push(continuityReason);
      } else if (related && !eligibleIds.has(match.id)) {
        continuityReason = `Previous doctor ${match.name} (${match.specialty}) is clinically appropriate, but currently unavailable (inactive, on leave, or at capacity) — searching for the best eligible alternative in ${analysis.requiredSpecialty}.`;
        notes.push(continuityReason);
      } else {
        continuityReason = `Previous doctor ${match.name}'s specialty (${match.specialty}) does not relate to the required specialty (${analysis.requiredSpecialty}) — continuity is not applied; standard specialty-based allocation is used instead.`;
        notes.push(continuityReason);
      }
    } else {
      continuityReason = `Follow-up visit references previous doctor ID "${analysis.previousDoctorId}", but no matching doctor record was found — the reference is ignored.`;
      notes.push(continuityReason);
    }
  }

  // ---- Requested doctor ----
  let requestedDoctor: Doctor | null = null;
  let requestedDoctorValidated = false;
  let requestedDoctorAvailable = false;
  let requestedDoctorSuitable = false;

  if (analysis.requestedDoctor) {
    const match = resolveDoctorByIdOrName(analysis.requestedDoctor, allDoctors);
    requestedDoctor = match;
    requestedDoctorValidated = !!match;

    if (match) {
      requestedDoctorAvailable = isDoctorCurrentlyAvailable(match);
      requestedDoctorSuitable = areSpecialtiesRelated(match.specialty, analysis.requiredSpecialty);

      if (requestedDoctorSuitable && requestedDoctorAvailable) {
        notes.push(
          `Patient explicitly requested ${match.name}, who is available and clinically suitable — strongly weighted in ranking.`
        );
      } else if (requestedDoctorSuitable && !requestedDoctorAvailable) {
        notes.push(
          `Patient explicitly requested ${match.name}, who is clinically suitable but currently unavailable — offering the earliest appointment with the best suitable alternative instead.`
        );
      } else {
        notes.push(
          `Patient explicitly requested ${match.name}, but their specialty (${match.specialty}) does not match the required specialty (${analysis.requiredSpecialty}) — the request is not honored; an appropriate ${analysis.requiredSpecialty} doctor is recommended instead.`
        );
      }
    } else {
      notes.push(
        `Patient requested a doctor ("${analysis.requestedDoctor}") that could not be matched to any known doctor record — the reference is safely ignored.`
      );
    }
  }

  return {
    previousDoctor,
    previousDoctorValidated,
    previousDoctorSpecialty,
    previousDoctorCurrentlyAvailable,
    continuityApplicable,
    continuityReason,
    requestedDoctor,
    requestedDoctorValidated,
    requestedDoctorAvailable,
    requestedDoctorSuitable,
    notes,
  };
}
