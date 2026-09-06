import { Doctor, EligibleDoctor, ExcludedDoctor, PatientAnalysis } from "../types";
import {
  isExactSpecialtyMatch,
  isEmergencyCrossCoverAllowed,
  isGeneralMedicineFallbackAllowed,
} from "../utils/specialtyMatching";

export interface EligibilityResult {
  eligible: EligibleDoctor[];
  excluded: ExcludedDoctor[];
  fallbackToGeneralMedicine: boolean;
}

// ============================================================================
// STEP 2: Doctor Eligibility Filtering  +  STEP 5: Controlled Specialty
// Matching
//
// Two passes:
//  1. Status filtering — remove doctors who are inactive, on leave, or at
//     capacity, regardless of specialty. Every exclusion is tagged with a
//     machine-readable reasonCode (for internal debugging) and a
//     human-readable `reason` (safe to summarize in API responses).
//  2. Specialty tiering — among the status-eligible doctors, classify by how
//     well their specialty matches the case:
//       EXACT               — doctor.specialty === requiredSpecialty
//       EMERGENCY_CROSS      — Emergency Medicine doctor on a CRITICAL case
//       GENERAL_MEDICINE_FALLBACK — only used when there are zero EXACT/
//                             EMERGENCY_CROSS candidates AND requiredSpecialty
//                             is one of the specialties General Medicine is
//                             an approved fallback for (see
//                             specialtyMatching.ts). This is the "explicit
//                             fallback rule" — it never fires blindly.
//
// If, after both passes, there are still zero eligible doctors, the caller
// (routes/allocation.ts) returns `finalAssignment: null` with a clear
// explanation rather than silently assigning anyone.
// ============================================================================

export function isDoctorCurrentlyAvailable(doctor: Doctor): boolean {
  return doctor.active && !doctor.onLeave && doctor.currentPatients < doctor.maxPatientsPerDay;
}

function statusExclusionReason(doctor: Doctor): ExcludedDoctor | null {
  if (!doctor.active) {
    return { doctor, reasonCode: "INACTIVE", reason: "Doctor is inactive" };
  }
  if (doctor.onLeave) {
    return { doctor, reasonCode: "ON_LEAVE", reason: "Doctor is currently on leave" };
  }
  if (doctor.currentPatients >= doctor.maxPatientsPerDay) {
    return { doctor, reasonCode: "AT_CAPACITY", reason: "Doctor has reached maximum daily patient capacity" };
  }
  return null;
}

export function filterEligibleDoctors(doctors: Doctor[], analysis: PatientAnalysis): EligibilityResult {
  const excluded: ExcludedDoctor[] = [];
  const statusAvailable: Doctor[] = [];

  for (const doctor of doctors) {
    const exclusion = statusExclusionReason(doctor);
    if (exclusion) {
      excluded.push(exclusion);
    } else {
      statusAvailable.push(doctor);
    }
  }

  const required = analysis.requiredSpecialty;

  const exactMatches = statusAvailable.filter((d) => isExactSpecialtyMatch(d.specialty, required));
  const emergencyCross = statusAvailable.filter(
    (d) => !isExactSpecialtyMatch(d.specialty, required) && isEmergencyCrossCoverAllowed(d.specialty, analysis.urgency)
  );

  let eligible: EligibleDoctor[] = [
    ...exactMatches.map((doctor) => ({ doctor, tier: "EXACT" as const })),
    ...emergencyCross.map((doctor) => ({ doctor, tier: "EMERGENCY_CROSS" as const })),
  ];

  const matchedIds = new Set(eligible.map((e) => e.doctor.id));
  let fallbackToGeneralMedicine = false;

  // Explicit fallback rule: only reached when there is truly no exact or
  // emergency-cross candidate, and only for the specific specialties General
  // Medicine is an approved substitute for (Dermatology and Pediatrics are
  // deliberately NOT in that set — see specialtyMatching.ts).
  if (eligible.length === 0 && isGeneralMedicineFallbackAllowed(required)) {
    const gmDoctors = statusAvailable.filter((d) => isExactSpecialtyMatch(d.specialty, "General Medicine"));
    if (gmDoctors.length > 0) {
      eligible = gmDoctors.map((doctor) => ({ doctor, tier: "GENERAL_MEDICINE_FALLBACK" as const }));
      gmDoctors.forEach((d) => matchedIds.add(d.id));
      fallbackToGeneralMedicine = true;
    }
  }

  // Anything status-available but not matched by any tier above is a
  // specialty mismatch — record it for debugging/explanation purposes.
  for (const doctor of statusAvailable) {
    if (!matchedIds.has(doctor.id)) {
      excluded.push({
        doctor,
        reasonCode: "SPECIALTY_MISMATCH",
        reason: `Specialty mismatch (needs ${analysis.requiredSpecialty}, doctor is ${doctor.specialty})`,
      });
    }
  }

  // CRITICAL: bring emergency-capable doctors to the front so the fastest
  // possible emergency-capable doctor is evaluated first by later steps.
  if (analysis.urgency === "CRITICAL") {
    eligible.sort((a, b) => Number(b.doctor.emergencyCapable) - Number(a.doctor.emergencyCapable));
  }

  return { eligible, excluded, fallbackToGeneralMedicine };
}
