import axios from "axios";
import {
  Complexity,
  Doctor,
  RankedDoctor,
  SchedulingRequest,
  SchedulingResponse,
  Urgency,
  VisitType,
} from "../types";

const SCHEDULER_URL = process.env.PYTHON_SCHEDULER_URL || "http://localhost:8000";

/**
 * Maps urgency + complexity + visit type to an appointment duration in
 * minutes, per spec:
 *   FOLLOW_UP + LOW complexity -> 10
 *   LOW complexity             -> 15
 *   MEDIUM complexity          -> 20
 *   HIGH complexity            -> 30
 *   CRITICAL                   -> immediate / earliest possible (shortest slot)
 */
export function resolveDurationMinutes(urgency: Urgency, complexity: Complexity, visitType: VisitType): number {
  if (urgency === "CRITICAL") return 15; // shortest standard slot, scheduled ASAP
  if (visitType === "FOLLOW_UP" && complexity === "LOW") return 10;
  if (complexity === "LOW") return 15;
  if (complexity === "HIGH") return 30;
  return 20; // MEDIUM default
}

/**
 * STEP 5 / 6: Calls the Python FastAPI scheduling engine with the top-ranked
 * doctors so it can generate conflict-free slots and jointly evaluate
 * doctor + time together — rather than Node simply picking the #1 ranked
 * doctor regardless of how far away their next opening is.
 */
export async function requestSchedule(
  topDoctors: RankedDoctor[],
  doctorLookup: Map<string, Doctor>,
  urgency: Urgency,
  durationMinutes: number
): Promise<SchedulingResponse> {
  const payload: SchedulingRequest = {
    urgency,
    durationMinutes,
    doctors: topDoctors.map((rd) => {
      const doctor = doctorLookup.get(rd.doctorId);
      if (!doctor) {
        throw new Error(`Ranked doctor ${rd.doctorId} not found in doctor dataset`);
      }
      return {
        doctorId: doctor.id,
        name: doctor.name,
        specialty: doctor.specialty,
        rankScore: rd.score,
        workingHours: doctor.workingHours,
        appointments: doctor.appointments,
        currentPatients: doctor.currentPatients,
        maxPatientsPerDay: doctor.maxPatientsPerDay,
        emergencyCapable: doctor.emergencyCapable,
      };
    }),
  };

  try {
    const res = await axios.post<SchedulingResponse>(`${SCHEDULER_URL}/schedule`, payload, {
      timeout: 10_000,
    });
    return res.data;
  } catch (err) {
    if (axios.isAxiosError(err)) {
      const detail = err.response?.data ? JSON.stringify(err.response.data) : err.message;
      throw new Error(`Python scheduling service error: ${detail}`);
    }
    throw err;
  }
}
