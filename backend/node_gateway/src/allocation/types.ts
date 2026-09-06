// ============================================================================
// Core domain types for the Doctor Allocation & Smart Scheduling Module
// ============================================================================

export type Urgency = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type VisitType = "NEW" | "FOLLOW_UP";
export type Complexity = "LOW" | "MEDIUM" | "HIGH";

export interface WorkingHours {
  start: string; // "HH:MM" 24h
  end: string; // "HH:MM" 24h
}

export interface Appointment {
  patientId: string;
  start: string; // ISO 8601 datetime
  end: string; // ISO 8601 datetime
}

export interface Doctor {
  id: string;
  name: string;
  specialty: string;
  skills: string[];
  active: boolean;
  onLeave: boolean;
  emergencyCapable: boolean;
  workingHours: WorkingHours;
  currentPatients: number;
  maxPatientsPerDay: number;
  appointments: Appointment[];
}

// ---- Step 1: Gemini structured output -------------------------------------

export interface PatientAnalysis {
  requiredSpecialty: string;
  urgency: Urgency;
  visitType: VisitType;
  complexity: Complexity;
  requestedDoctor: string | null;
  previousDoctorId: string | null;
  reasoning: string;
}

// ---- Step 2/5: Eligibility & specialty matching ----------------------------

export type SpecialtyMatchTier = "EXACT" | "EMERGENCY_CROSS" | "GENERAL_MEDICINE_FALLBACK";

export interface EligibleDoctor {
  doctor: Doctor;
  tier: SpecialtyMatchTier;
}

export type ExclusionReasonCode = "INACTIVE" | "ON_LEAVE" | "AT_CAPACITY" | "SPECIALTY_MISMATCH";

export interface ExcludedDoctor {
  doctor: Doctor;
  reasonCode: ExclusionReasonCode;
  reason: string;
}

// ---- Step 4: Ranking --------------------------------------------------------

export interface ScoreBreakdown {
  specialtyMatch: number;
  skillMatch: number;
  earliestAvailability: number;
  workloadBalance: number;
  continuity: number;
  patientPreference: number;
  emergencyCapability: number;
}

export interface RankedDoctor {
  doctorId: string;
  name: string;
  specialty: string;
  score: number; // 0-100
  breakdown: ScoreBreakdown;
  reasons: string[];
}

// ---- Step 5 & 6: Scheduling (payloads exchanged with the Python service) --

export interface SchedulingRequestDoctor {
  doctorId: string;
  name: string;
  specialty: string;
  rankScore: number;
  workingHours: WorkingHours;
  appointments: Appointment[];
  currentPatients: number;
  maxPatientsPerDay: number;
  emergencyCapable: boolean;
}

export interface SchedulingRequest {
  urgency: Urgency;
  durationMinutes: number;
  requestDate?: string; // ISO date (YYYY-MM-DD), defaults to today
  doctors: SchedulingRequestDoctor[];
}

export interface SchedulingResultOption {
  doctorId: string;
  start: string; // ISO 8601 datetime
  end: string; // ISO 8601 datetime
  combinedScore: number;
  waitMinutes: number;
}

export interface SchedulingResponse {
  best: SchedulingResultOption | null;
  alternatives: SchedulingResultOption[];
}

// ---- Final API response ------------------------------------------------------

export interface FinalAssignment {
  doctorId: string;
  doctorName: string;
  specialty: string;
  appointmentStart: string;
  appointmentEnd: string;
  estimatedDurationMinutes: number;
}

export interface AllocationMetadata {
  previousDoctorValidated: boolean;
  previousDoctorSpecialty: string | null;
  continuityApplicable: boolean;
  continuityReason: string;
  requestedDoctorValidated: boolean;
  requestedDoctorAvailable: boolean;
  requestedDoctorSuitable: boolean;
  fallbackToGeneralMedicine: boolean;
}

export interface AlternativeOption {
  doctorId: string;
  doctorName: string;
  specialty: string;
  appointmentStart: string;
  appointmentEnd: string;
  reason: string;
}

export interface AllocationResponse {
  patientAnalysis: {
    requiredSpecialty: string;
    urgency: Urgency;
    visitType: VisitType;
    complexity: Complexity;
  };
  topDoctors: {
    doctorId: string;
    name: string;
    specialty: string;
    score: number;
    reasons: string[];
  }[];
  finalAssignment: FinalAssignment | null;
  allocationReason: string[];
  alternativeOptions: AlternativeOption[];
  allocationMetadata: AllocationMetadata;
}
