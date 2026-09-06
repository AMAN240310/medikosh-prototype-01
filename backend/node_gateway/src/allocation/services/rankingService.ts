import { Doctor, EligibleDoctor, PatientAnalysis, RankedDoctor, ScoreBreakdown, Urgency } from "../types";
import { ContinuityResult } from "./followUpService";

// ============================================================================
// STEP 4: Doctor Ranking Engine
//
// Scores every eligible doctor against the case on seven factors and returns
// the top 3, each fully explainable via `breakdown` (raw 0-1 sub-scores) and
// `reasons` (human-readable bullets).
//
// Clinical suitability always comes first: this function only ever ranks
// doctors already vetted by eligibilityService (Step 2/5), so an
// EMERGENCY_CROSS or GENERAL_MEDICINE_FALLBACK doctor is never scored as
// highly on specialty match as an EXACT match — the tier IS the score input,
// not a separate string comparison that could drift out of sync with the
// eligibility decision that let the doctor in.
//
// Continuity and patient-preference bonuses are gated on clinical
// appropriateness (continuity.continuityApplicable /
// continuity.requestedDoctorSuitable) — being previously seen or explicitly
// requested is never enough on its own.
//
// "Earliest Availability" here is a heuristic proxy (today's existing
// appointment load) used only to pre-sort candidates before scheduling. The
// Python engine (Step 5/6) computes the *actual* earliest slot and makes the
// final joint doctor+time decision, which can and does override this
// heuristic's preference (see schedulingClient.ts / scheduler.py).
// ============================================================================

interface WeightProfile {
  specialtyMatch: number;
  skillMatch: number;
  earliestAvailability: number;
  workloadBalance: number;
  continuity: number;
  patientPreference: number;
  emergencyCapability: number;
}

// Suggested weights for normal (LOW/MEDIUM) cases.
const NORMAL_WEIGHTS: WeightProfile = {
  specialtyMatch: 0.35,
  skillMatch: 0.2,
  earliestAvailability: 0.15,
  workloadBalance: 0.15,
  continuity: 0.1,
  patientPreference: 0.05,
  emergencyCapability: 0.0,
};

// HIGH urgency: increase weight for earliest availability and urgency
// suitability (specialty match), while trimming continuity/preference —
// getting seen appropriately and promptly matters more than convenience.
const HIGH_WEIGHTS: WeightProfile = {
  specialtyMatch: 0.3,
  skillMatch: 0.15,
  earliestAvailability: 0.25,
  workloadBalance: 0.1,
  continuity: 0.1,
  patientPreference: 0.05,
  emergencyCapability: 0.05,
};

// CRITICAL cases care almost entirely about speed and emergency capability;
// continuity and patient preference are deliberately weighted near zero.
const CRITICAL_WEIGHTS: WeightProfile = {
  specialtyMatch: 0.2,
  skillMatch: 0.1,
  earliestAvailability: 0.3,
  emergencyCapability: 0.3,
  workloadBalance: 0.05,
  continuity: 0.05,
  patientPreference: 0.0,
};

function weightsFor(urgency: Urgency): WeightProfile {
  if (urgency === "CRITICAL") return CRITICAL_WEIGHTS;
  if (urgency === "HIGH") return HIGH_WEIGHTS;
  return NORMAL_WEIGHTS;
}

function specialtyMatchScore(tier: EligibleDoctor["tier"]): number {
  switch (tier) {
    case "EXACT":
      return 1;
    case "EMERGENCY_CROSS":
      return 0.75;
    case "GENERAL_MEDICINE_FALLBACK":
      return 0.5;
    default:
      return 0;
  }
}

function skillMatchScore(doctor: Doctor, patientSummaryText: string): number {
  if (doctor.skills.length === 0) return 0;
  const text = patientSummaryText.toLowerCase();
  const matched = doctor.skills.filter((skill) => text.includes(skill.toLowerCase()));
  return matched.length / doctor.skills.length;
}

function workloadBalanceScore(doctor: Doctor): number {
  if (doctor.maxPatientsPerDay <= 0) return 0;
  return Math.max(0, 1 - doctor.currentPatients / doctor.maxPatientsPerDay);
}

function earliestAvailabilityHeuristic(doctor: Doctor): number {
  const apptLoadFraction =
    doctor.maxPatientsPerDay > 0 ? doctor.appointments.length / doctor.maxPatientsPerDay : 0;
  return Math.max(0, 1 - apptLoadFraction);
}

/** Continuity bonus only applies to the validated previous doctor, and only
 * when they are clinically appropriate for the current case. */
function continuityScore(doctor: Doctor, continuity: ContinuityResult): number {
  if (!continuity.continuityApplicable) return 0;
  return continuity.previousDoctor && continuity.previousDoctor.id === doctor.id ? 1 : 0;
}

/** Preference bonus only applies to the validated requested doctor, and only
 * when they are clinically suitable — an unsuitable request is never
 * silently rewarded. */
function patientPreferenceScore(doctor: Doctor, continuity: ContinuityResult): number {
  if (!continuity.requestedDoctorSuitable) return 0;
  return continuity.requestedDoctor && continuity.requestedDoctor.id === doctor.id ? 1 : 0;
}

function emergencyCapabilityScore(doctor: Doctor): number {
  return doctor.emergencyCapable ? 1 : 0;
}

function buildReasons(
  doctor: Doctor,
  tier: EligibleDoctor["tier"],
  breakdown: ScoreBreakdown,
  continuity: ContinuityResult,
  analysis: PatientAnalysis
): string[] {
  const reasons: string[] = [];

  if (tier === "EXACT") {
    reasons.push(`Exact specialty match for ${analysis.requiredSpecialty}`);
  } else if (tier === "EMERGENCY_CROSS") {
    reasons.push(`Emergency Medicine cross-cover accepted for a CRITICAL case`);
  } else if (tier === "GENERAL_MEDICINE_FALLBACK") {
    reasons.push(`No ${analysis.requiredSpecialty} specialist was eligible — General Medicine fallback applied`);
  }

  if (breakdown.skillMatch > 0.5) {
    reasons.push(`Strong skill overlap with the reported symptoms (${Math.round(breakdown.skillMatch * 100)}%)`);
  } else if (breakdown.skillMatch > 0) {
    reasons.push(`Partial skill overlap with the reported symptoms`);
  }

  if (breakdown.continuity === 1) {
    reasons.push(`Previously treated this patient for a clinically related case — preserves continuity of care`);
  }
  if (breakdown.patientPreference === 1) {
    reasons.push(`Matches the patient's explicit doctor request`);
  }

  if (breakdown.workloadBalance > 0.6) {
    reasons.push(`Low current workload (${doctor.currentPatients}/${doctor.maxPatientsPerDay} patients today)`);
  }

  if (analysis.urgency === "CRITICAL" && doctor.emergencyCapable) {
    reasons.push(`Emergency-capable — prioritized for a CRITICAL case`);
  }

  if (breakdown.earliestAvailability > 0.6) {
    reasons.push(`Lighter existing schedule suggests an earlier available slot`);
  }

  if (reasons.length === 0) {
    reasons.push(`Eligible ${doctor.specialty} doctor with capacity remaining`);
  }

  return reasons;
}

/**
 * Scores every eligible doctor and returns the top 3, sorted descending.
 */
export function rankDoctors(
  eligibleDoctors: EligibleDoctor[],
  analysis: PatientAnalysis,
  patientSummaryText: string,
  continuity: ContinuityResult
): RankedDoctor[] {
  const weights = weightsFor(analysis.urgency);

  const ranked: RankedDoctor[] = eligibleDoctors.map(({ doctor, tier }) => {
    const breakdown: ScoreBreakdown = {
      specialtyMatch: specialtyMatchScore(tier),
      skillMatch: skillMatchScore(doctor, patientSummaryText),
      earliestAvailability: earliestAvailabilityHeuristic(doctor),
      workloadBalance: workloadBalanceScore(doctor),
      continuity: continuityScore(doctor, continuity),
      patientPreference: patientPreferenceScore(doctor, continuity),
      emergencyCapability: emergencyCapabilityScore(doctor),
    };

    const rawScore =
      breakdown.specialtyMatch * weights.specialtyMatch +
      breakdown.skillMatch * weights.skillMatch +
      breakdown.earliestAvailability * weights.earliestAvailability +
      breakdown.workloadBalance * weights.workloadBalance +
      breakdown.continuity * weights.continuity +
      breakdown.patientPreference * weights.patientPreference +
      breakdown.emergencyCapability * weights.emergencyCapability;

    return {
      doctorId: doctor.id,
      name: doctor.name,
      specialty: doctor.specialty,
      score: Math.round(rawScore * 1000) / 10, // 0-100 scale, 1 decimal place
      breakdown,
      reasons: buildReasons(doctor, tier, breakdown, continuity, analysis),
    };
  });

  ranked.sort((a, b) => b.score - a.score);
  return ranked.slice(0, 3);
}
