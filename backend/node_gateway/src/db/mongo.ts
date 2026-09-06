import mongoose, { Schema, Document } from "mongoose";

export interface IPatientCase extends Document {
  caseId: string;
  patientId: string;
  patientName: string;
  chiefComplaint: string;
  symptoms: string[];
  voiceTranscript?: string;
  documentText?: string;
  clinicalSummary?: string;
  structuredFacts?: any[];
  validatedMedicines?: any[];
  severity?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

const PatientCaseSchema = new Schema<IPatientCase>(
  {
    caseId: { type: String, required: true, unique: true, index: true },
    patientId: { type: String, required: true, index: true },
    patientName: { type: String, default: "Jane Sharma" },
    chiefComplaint: { type: String, required: true },
    symptoms: [{ type: String }],
    voiceTranscript: { type: String },
    documentText: { type: String },
    clinicalSummary: { type: String },
    structuredFacts: [{ type: Schema.Types.Mixed }],
    validatedMedicines: [{ type: Schema.Types.Mixed }],
    severity: { type: String, enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL"], default: "MEDIUM" },
    status: { type: String, default: "INTAKE_COMPLETE" },
  },
  { timestamps: true }
);

export interface IMedicalRecord extends Document {
  documentId: string;
  patientId: string;
  title: string;
  type: string;
  date: string;
  storagePath: string;
  downloadUrl?: string;
  extractedText?: string;
  confidence?: number;
  createdAt: Date;
}

const MedicalRecordSchema = new Schema<IMedicalRecord>(
  {
    documentId: { type: String, required: true, unique: true, index: true },
    patientId: { type: String, required: true, index: true },
    title: { type: String, required: true },
    type: { type: String, required: true },
    date: { type: String, required: true },
    storagePath: { type: String, required: true },
    downloadUrl: { type: String },
    extractedText: { type: String },
    confidence: { type: Number, default: 0.9 },
  },
  { timestamps: true }
);

export const PatientCaseModel = mongoose.model<IPatientCase>("PatientCase", PatientCaseSchema);
export const MedicalRecordModel = mongoose.model<IMedicalRecord>("MedicalRecord", MedicalRecordSchema);

// ============================================================================
// DOCTOR-SIDE SHARED MONGO SCHEMAS & MODELS
// Directly maps to the Doctor Consultation Portal ('sih_database' on Atlas)
// ============================================================================

export interface IDoctor extends Document {
  hospitalId: string;
  doctorId: string;
  name: string;
  email?: string;
  password?: string;
  department: string;
  specialization?: string;
  hospital?: string;
  isDemo?: boolean;
  noticeAccepted?: boolean;
  noticeAcceptedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const DoctorSchema = new Schema<IDoctor>(
  {
    hospitalId: { type: String, required: true, trim: true },
    doctorId: { type: String, required: true, unique: true, trim: true },
    name: { type: String, required: true, trim: true },
    email: { type: String, lowercase: true, trim: true },
    password: { type: String, required: true },
    department: {
      type: String,
      required: true,
      enum: ["Cardiology", "Neurology", "Orthopedics", "Pediatrics", "General Medicine", "Dermatology"],
    },
    specialization: { type: String, default: "General Specialist" },
    hospital: { type: String, default: "AIIMS Metro Hospital" },
    isDemo: { type: Boolean, default: true },
    noticeAccepted: { type: Boolean, default: false },
    noticeAcceptedAt: { type: Date },
  },
  { timestamps: true }
);

export interface IPatient extends Document {
  name: string;
  email: string;
  password?: string;
  phone?: string;
  age?: number;
  gender?: "Male" | "Female" | "Other";
  bloodType?: string;
  medicalHistory?: string[];
  declarationAccepted?: boolean;
  declarationAcceptedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const PatientSchema = new Schema<IPatient>(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true },
    phone: { type: String, default: "" },
    age: { type: Number, default: 30 },
    gender: { type: String, enum: ["Male", "Female", "Other"], default: "Male" },
    bloodType: { type: String, default: "O+" },
    medicalHistory: [{ type: String }],
    declarationAccepted: { type: Boolean, default: true },
    declarationAcceptedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

export interface IDocumentItem {
  documentId?: string;
  filename?: string;
  fileType?: string;
  fileUrl?: string;
  extractedText?: string;
  confidence?: number;
}

export interface IFollowupItem {
  question: string;
  answer: string;
}

export interface IAppointment extends Document {
  appointmentId: string;
  patient: mongoose.Types.ObjectId;
  doctor: mongoose.Types.ObjectId;
  slotId: string;
  slotLabel: string;
  queueNumber: number;
  date: string;
  problem: string;
  followupAnswers: IFollowupItem[];
  documents: IDocumentItem[];
  clinicalFacts?: {
    safeFacts?: any;
    prioritizedFacts?: any;
    rxnormValidations?: any;
  };
  aiSummary: string;
  summarySource: "DEMO" | "MODULE_2" | "MANUAL" | "LIVE_VOICE_AGENT";
  status: "CONFIRMED" | "IN_QUEUE" | "SOLVED" | "NO_ATTEMPT" | "REMOVED" | "RESCHEDULED";
  statusMessage?: string;
  rescheduledFromSlot?: string;
  rescheduledFromQueueNumber?: number;
  solvedAt?: Date;
  removedAt?: Date;
  rescheduledAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const AppointmentSchema = new Schema<IAppointment>(
  {
    appointmentId: { type: String, required: true, unique: true, index: true },
    patient: { type: Schema.Types.ObjectId, ref: "Patient", required: true },
    doctor: { type: Schema.Types.ObjectId, ref: "Doctor", required: true },
    slotId: { type: String, required: true },
    slotLabel: { type: String, required: true },
    queueNumber: { type: Number, required: true },
    date: { type: String, required: true },
    problem: { type: String, required: true },
    followupAnswers: [
      {
        question: { type: String, required: true },
        answer: { type: String, required: true },
      },
    ],
    documents: [
      {
        documentId: { type: String },
        filename: { type: String },
        fileType: { type: String },
        fileUrl: { type: String },
        extractedText: { type: String },
        confidence: { type: Number, default: 0.95 },
      },
    ],
    clinicalFacts: {
      safeFacts: { type: Schema.Types.Mixed },
      prioritizedFacts: { type: Schema.Types.Mixed },
      rxnormValidations: { type: Schema.Types.Mixed },
    },
    aiSummary: { type: String, default: "" },
    summarySource: {
      type: String,
      enum: ["DEMO", "MODULE_2", "MANUAL", "LIVE_VOICE_AGENT"],
      default: "LIVE_VOICE_AGENT",
    },
    status: {
      type: String,
      enum: ["CONFIRMED", "IN_QUEUE", "SOLVED", "NO_ATTEMPT", "REMOVED", "RESCHEDULED"],
      default: "CONFIRMED",
    },
    statusMessage: { type: String, default: "" },
    rescheduledFromSlot: { type: String, default: null },
    rescheduledFromQueueNumber: { type: Number, default: null },
    solvedAt: { type: Date },
    removedAt: { type: Date },
    rescheduledAt: { type: Date },
  },
  { timestamps: true }
);

export interface IEmergency extends Document {
  emergencyId: string;
  patient: mongoose.Types.ObjectId;
  assignedDoctor?: mongoose.Types.ObjectId;
  severity: "CRITICAL" | "HIGH" | "MEDIUM";
  status: "ACTIVE" | "RESOLVED";
  reason: string;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const EmergencySchema = new Schema<IEmergency>(
  {
    emergencyId: { type: String, required: true, unique: true },
    patient: { type: Schema.Types.ObjectId, ref: "Patient", required: true },
    assignedDoctor: { type: Schema.Types.ObjectId, ref: "Doctor" },
    severity: { type: String, enum: ["CRITICAL", "HIGH", "MEDIUM"], default: "CRITICAL" },
    status: { type: String, enum: ["ACTIVE", "RESOLVED"], default: "ACTIVE" },
    reason: { type: String, required: true },
    notes: { type: String, default: "" },
  },
  { timestamps: true }
);

// Reuse existing models if already registered or instantiate new ones
export const DoctorModel = mongoose.models.Doctor || mongoose.model<IDoctor>("Doctor", DoctorSchema);
export const PatientModel = mongoose.models.Patient || mongoose.model<IPatient>("Patient", PatientSchema);
export const AppointmentModel = mongoose.models.Appointment || mongoose.model<IAppointment>("Appointment", AppointmentSchema);
export const EmergencyModel = mongoose.models.Emergency || mongoose.model<IEmergency>("Emergency", EmergencySchema);

// In-Memory fallback store for resilience when MongoDB server is offline
export const memoryMongo = {
  cases: new Map<string, any>(),
  records: new Map<string, any>(),
};

let isConnected = false;

export async function connectMongo(uri?: string): Promise<boolean> {
  const mongoUri = uri || process.env.MONGODB_URI;
  if (!mongoUri) {
    console.log("ℹ️ MONGODB_URI not provided. Running in resilient In-Memory Mongo store mode.");
    return false;
  }
  try {
    await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 5000 });
    isConnected = true;
    console.log("✅ Connected to MongoDB successfully.");
    return true;
  } catch (err) {
    console.warn("⚠️ MongoDB connection failed. Falling back to resilient In-Memory store:", err);
    isConnected = false;
    return false;
  }
}

export function isMongoConnected(): boolean {
  return isConnected;
}
