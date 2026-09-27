import { doctors } from "./data/doctors";
import { analyzePatientSummary } from "./services/geminiService";
import { filterEligibleDoctors } from "./services/eligibilityService";
import { evaluateContinuity } from "./services/followUpService";
import { rankDoctors } from "./services/rankingService";
import { requestSchedule, resolveDurationMinutes } from "./services/schedulingClient";
import { AllocationMetadata, AllocationResponse, AlternativeOption, Doctor, PatientAnalysis } from "./types";

/**
 * Full pipeline (architecture preserved):
 *   Gemini analysis (1) -> eligibility filtering + specialty tiering (2/5)
 *   -> continuity/preference validation (3/4) -> ranking (4) -> Python
 *   scheduling (5) -> final combined doctor+time selection (6)
 *   -> explainable response with metadata (12).
 *
 * Clinical suitability is enforced before scheduling ever runs: only
 * doctors that survived eligibility filtering (Step 2/5) are ever sent to
 * the Python scheduler, so scheduling optimization can never override a
 * poor clinical match.
 */
export async function allocateDoctor(patientSummary: string): Promise<AllocationResponse> {
  // ---- Step 1: Gemini analysis (defensively normalized in geminiService) ----
  const analysis = await analyzePatientSummary(patientSummary);
  return allocateFromAnalysis(analysis, patientSummary);
}

/**
 * Steps 2-6 of the pipeline, taking an already-produced PatientAnalysis.
 * Split out from allocateDoctor() specifically so tests can exercise the
 * real eligibility/continuity/ranking/scheduling logic with a hand-built
 * analysis, without needing a live Gemini API key.
 */
export async function allocateFromAnalysis(
  analysis: PatientAnalysis,
  patientSummary: string
): Promise<AllocationResponse> {
  const allocationReason: string[] = [];

  allocationReason.push(
    `Case classified as ${analysis.urgency} urgency, ${analysis.visitType} visit, ${analysis.complexity} complexity, requiring ${analysis.requiredSpecialty}.`
  );
  if (analysis.urgency === "CRITICAL") {
    allocationReason.push(
      "⚠ EMERGENCY-PRIORITY ALLOCATION: this case is being scheduled with emergency weighting — earliest valid availability and emergency capability are prioritized over routine ranking factors."
    );
  }

  // ---- Step 2/5: Eligibility filtering + controlled specialty matching ----
  const { eligible, excluded, fallbackToGeneralMedicine } = filterEligibleDoctors(doctors, analysis);
  if (fallbackToGeneralMedicine) {
    allocationReason.push(
      `No eligible ${analysis.requiredSpecialty} specialist was available — falling back to General Medicine under the approved fallback rule for this specialty.`
    );
  }
  if (excluded.length > 0) {
    allocationReason.push(`${excluded.length} doctor(s) excluded (inactive, on leave, at capacity, or specialty mismatch).`);
  }

  if (eligible.length === 0) {
    return {
      patientAnalysis: toPatientAnalysisView(analysis),
      topDoctors: [],
      finalAssignment: null,
      allocationReason: [
        ...allocationReason,
        `No eligible ${analysis.requiredSpecialty} doctor is currently available.`,
      ],
      alternativeOptions: [],
      allocationMetadata: emptyMetadata(),
    };
  }

  // ---- Step 3/4: Continuity + requested-doctor validation (signals only) ----
  const continuity = evaluateContinuity(eligible, doctors, analysis);
  allocationReason.push(...continuity.notes);

  const allocationMetadata: AllocationMetadata = {
    previousDoctorValidated: continuity.previousDoctorValidated,
    previousDoctorSpecialty: continuity.previousDoctorSpecialty,
    continuityApplicable: continuity.continuityApplicable,
    continuityReason: continuity.continuityReason,
    requestedDoctorValidated: continuity.requestedDoctorValidated,
    requestedDoctorAvailable: continuity.requestedDoctorAvailable,
    requestedDoctorSuitable: continuity.requestedDoctorSuitable,
    fallbackToGeneralMedicine,
  };

  // ---- Step 4: Ranking (only ever ranks the already-eligible pool) ----
  const topDoctors = rankDoctors(eligible, analysis, patientSummary, continuity);

  // ---- Step 5: Scheduling ----
  const durationMinutes = resolveDurationMinutes(analysis.urgency, analysis.complexity, analysis.visitType);
  const doctorLookup = new Map<string, Doctor>(doctors.map((d) => [d.id, d]));
  const schedule = await requestSchedule(topDoctors, doctorLookup, analysis.urgency, durationMinutes);

  const topDoctorsView = topDoctors.map((d) => ({
    doctorId: d.doctorId,
    name: d.name,
    specialty: d.specialty,
    score: d.score,
    reasons: d.reasons,
  }));

  // ---- Step 6: no slot found anywhere within the search window ----
  if (!schedule.best) {
    return {
      patientAnalysis: toPatientAnalysisView(analysis),
      topDoctors: topDoctorsView,
      finalAssignment: null,
      allocationReason: [
        ...allocationReason,
        `Top-ranked doctors had no available slot within the search window. Consider widening the doctor pool or the search window.`,
      ],
      alternativeOptions: [],
      allocationMetadata,
    };
  }

  // ---- Step 6: final combined doctor + time decision ----
  const win = schedule.best;
  const bestDoctor = doctorLookup.get(win.doctorId);
  if (!bestDoctor) {
    throw new Error(`Scheduling engine returned unknown doctor id ${win.doctorId}`);
  }
  const bestRanked = topDoctors.find((d) => d.doctorId === win.doctorId);

  allocationReason.push(
    `Selected ${bestDoctor.name} (${bestDoctor.specialty}) for the ${win.start} slot — best combined match of ` +
      `suitability and availability` +
      (bestRanked ? ` (rank score ${bestRanked.score}/100).` : ".")
  );

  const alternativeOptions: AlternativeOption[] = schedule.alternatives.map((alt) => {
    const d = doctorLookup.get(alt.doctorId);
    return {
      doctorId: alt.doctorId,
      doctorName: d?.name ?? alt.doctorId,
      specialty: d?.specialty ?? "",
      appointmentStart: alt.start,
      appointmentEnd: alt.end,
      reason: buildAlternativeReason(alt, win, d),
    };
  });

  return {
    patientAnalysis: toPatientAnalysisView(analysis),
    topDoctors: topDoctorsView,
    finalAssignment: {
      doctorId: bestDoctor.id,
      doctorName: bestDoctor.name,
      specialty: bestDoctor.specialty,
      appointmentStart: win.start,
      appointmentEnd: win.end,
      estimatedDurationMinutes: durationMinutes,
    },
    allocationReason,
    alternativeOptions,
    allocationMetadata,
  };
}

function buildAlternativeReason(
  alt: { waitMinutes: number; combinedScore: number },
  best: { waitMinutes: number },
  doctor: Doctor | undefined
): string {
  const waitDiff = Math.round(alt.waitMinutes - best.waitMinutes);
  const doctorLabel = doctor ? doctor.name : "this doctor";
  const workloadLabel = doctor ? ` (${doctor.currentPatients}/${doctor.maxPatientsPerDay} patients today)` : "";

  if (waitDiff > 0) {
    return `${waitDiff} minute(s) later than the top pick, but a solid alternative with ${doctorLabel}${workloadLabel}.`;
  }
  if (waitDiff < 0) {
    return `Actually available sooner than the top pick — offered as a backup option with ${doctorLabel}${workloadLabel}.`;
  }
  return `Comparable timing to the top pick, with ${doctorLabel}${workloadLabel}.`;
}

function toPatientAnalysisView(analysis: PatientAnalysis) {
  return {
    requiredSpecialty: analysis.requiredSpecialty,
    urgency: analysis.urgency,
    visitType: analysis.visitType,
    complexity: analysis.complexity,
  };
}

function emptyMetadata(): AllocationMetadata {
  return {
    previousDoctorValidated: false,
    previousDoctorSpecialty: null,
    continuityApplicable: false,
    continuityReason: "",
    requestedDoctorValidated: false,
    requestedDoctorAvailable: false,
    requestedDoctorSuitable: false,
    fallbackToGeneralMedicine: false,
  };
}
