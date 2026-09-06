import { Doctor } from "../types";

// ============================================================================
// DUMMY DOCTOR DATA
//
// This file stands in for a real database/table. Keeping it isolated here
// means the rest of the system (eligibility filtering, ranking, scheduling)
// never needs to change when this is later replaced with real DB queries —
// only this module's export needs to be swapped for a repository call.
//
// Appointments are generated relative to "today" so the dummy data always
// produces realistic scheduling behavior no matter when this is run.
// ============================================================================

// The scheduling engine (python-scheduler/app/config.py) treats all working
// hours and appointment times as Asia/Kolkata local time. We build these
// dummy ISO timestamps with an explicit "+05:30" offset — rather than using
// the host machine's local timezone — so the two services always agree on
// "today at 09:00" regardless of what timezone the Node process happens to
// run in.
const IST_OFFSET = "+05:30";

function todayAt(hhmm: string): string {
  const nowUtc = new Date();
  const istWallClock = new Date(nowUtc.getTime() + 5.5 * 60 * 60 * 1000);
  const year = istWallClock.getUTCFullYear();
  const month = String(istWallClock.getUTCMonth() + 1).padStart(2, "0");
  const day = String(istWallClock.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}T${hhmm}:00${IST_OFFSET}`;
}

export const doctors: Doctor[] = [
  {
    id: "DOC-CARD-01",
    name: "Dr. Rajesh Sharma",
    specialty: "Cardiology",
    skills: ["Chest Pain", "Hypertension", "Heart Disease", "ECG Interpretation", "Interventional Cardiology"],
    active: true,
    onLeave: false,
    emergencyCapable: true,
    workingHours: { start: "09:00", end: "17:00" },
    currentPatients: 14,
    maxPatientsPerDay: 25,
    appointments: [
      { patientId: "P-9001", start: todayAt("09:00"), end: todayAt("09:20") },
      { patientId: "P-9002", start: todayAt("09:20"), end: todayAt("09:40") },
      { patientId: "P-9003", start: todayAt("11:00"), end: todayAt("11:30") },
    ],
  },
  {
    id: "DOC-NEUR-01",
    name: "Dr. Ananya Roy",
    specialty: "Neurology",
    skills: ["Migraine", "Headache", "Epilepsy", "Stroke", "Nerve Disorders", "Cognitive Neurology"],
    active: true,
    onLeave: false,
    emergencyCapable: true,
    workingHours: { start: "09:00", end: "17:00" },
    currentPatients: 8,
    maxPatientsPerDay: 20,
    appointments: [{ patientId: "P-9020", start: todayAt("13:00"), end: todayAt("13:30") }],
  },
  {
    id: "DOC-ORTH-01",
    name: "Dr. Vikram Malhotra",
    specialty: "Orthopedics",
    skills: ["Joint Replacement", "Spine", "Fracture", "Joint Pain", "Sports Injury", "Back Pain"],
    active: true,
    onLeave: false,
    emergencyCapable: true,
    workingHours: { start: "09:00", end: "17:00" },
    currentPatients: 10,
    maxPatientsPerDay: 25,
    appointments: [],
  },
  {
    id: "DOC-PEDI-01",
    name: "Dr. Sunita Patel",
    specialty: "Pediatrics",
    skills: ["Pediatric Care", "Immunology", "Child Fever", "Vaccination", "Growth Concerns"],
    active: true,
    onLeave: false,
    emergencyCapable: true,
    workingHours: { start: "09:00", end: "17:00" },
    currentPatients: 11,
    maxPatientsPerDay: 25,
    appointments: [{ patientId: "P-9030", start: todayAt("10:00"), end: todayAt("10:15") }],
  },
  {
    id: "DOC-GEN-01",
    name: "Dr. Amit Verma",
    specialty: "General Medicine",
    skills: ["Internal Medicine", "Critical Care", "Fever", "Infections", "Diabetes", "General Checkup"],
    active: true,
    onLeave: false,
    emergencyCapable: true,
    workingHours: { start: "08:00", end: "17:00" },
    currentPatients: 12,
    maxPatientsPerDay: 30,
    appointments: [{ patientId: "P-9010", start: todayAt("08:00"), end: todayAt("08:15") }],
  },
  {
    id: "DOC-DERM-01",
    name: "Dr. Priya Nair",
    specialty: "Dermatology",
    skills: ["Skin Allergy", "Acne", "Eczema", "Psoriasis", "Dermatitis", "Cosmetic Dermatology"],
    active: true,
    onLeave: false,
    emergencyCapable: false,
    workingHours: { start: "09:00", end: "17:00" },
    currentPatients: 7,
    maxPatientsPerDay: 22,
    appointments: [],
  },
  {
    // Test case: Doctor at capacity
    id: "DOC-CAP-01",
    name: "Dr. Sanjay Gupta",
    specialty: "Cardiology",
    skills: ["Arrhythmia", "Heart Failure"],
    active: true,
    onLeave: false,
    emergencyCapable: false,
    workingHours: { start: "10:00", end: "18:00" },
    currentPatients: 20,
    maxPatientsPerDay: 20, // at capacity -> excluded by eligibility filtering
    appointments: [],
  },
  {
    // Test case: Doctor on leave
    id: "DOC-LEAVE-01",
    name: "Dr. Kavita Joshi",
    specialty: "General Medicine",
    skills: ["Fever", "Allergy", "General Checkup"],
    active: true,
    onLeave: true, // on leave -> excluded by eligibility filtering
    emergencyCapable: false,
    workingHours: { start: "09:00", end: "17:00" },
    currentPatients: 5,
    maxPatientsPerDay: 25,
    appointments: [],
  },
  {
    // Test case: Inactive doctor
    id: "DOC-INACT-01",
    name: "Dr. Kabir Malhotra",
    specialty: "Dermatology",
    skills: ["Skin Allergy", "Acne", "Eczema"],
    active: false, // inactive -> excluded by eligibility filtering
    onLeave: false,
    emergencyCapable: false,
    workingHours: { start: "10:00", end: "16:00" },
    currentPatients: 4,
    maxPatientsPerDay: 20,
    appointments: [],
  },
  {
    id: "DOC-EMG-01",
    name: "Dr. Meera Pillai",
    specialty: "Emergency Medicine",
    skills: ["Trauma", "Critical Care", "Resuscitation", "Acute Illness"],
    active: true,
    onLeave: false,
    emergencyCapable: true,
    workingHours: { start: "00:00", end: "23:59" }, // round-the-clock ER coverage
    currentPatients: 6,
    maxPatientsPerDay: 40,
    appointments: [],
  },
];
