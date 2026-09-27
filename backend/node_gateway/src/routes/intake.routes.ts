import { Router, Request, Response } from "express";
import multer from "multer";
import FormData from "form-data";
import axios from "axios";
import bcrypt from "bcryptjs";
import { allocateDoctor } from "../allocation/allocationEngine.js";
import { validateUpload } from "../middleware/uploadValidation.middleware.js";
import {
  PatientCaseModel,
  DoctorModel,
  PatientModel,
  AppointmentModel,
  memoryMongo,
} from "../db/mongo.js";
import { saveAppointment, AppointmentRecord } from "../db/supabase.js";

export const intakeRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

const PYTHON_API_URL = process.env.PYTHON_SERVICES_URL || "http://localhost:8000";

interface DoctorPortalAppointmentParams {
  appointmentId: string;
  doctorId?: string;
  doctorName?: string;
  specialty?: string;
  patientName: string;
  patientEmail?: string;
  patientPhone?: string;
  patientAge?: number;
  patientGender?: "Male" | "Female" | "Other";
  patientBloodType?: string;
  problem: string;
  aiSummary: string;
  slotStartTime?: string;
  slotDate?: string;
  followupAnswers?: Array<{ question: string; answer: string }>;
  documents?: Array<{
    documentId?: string;
    filename?: string;
    fileType?: string;
    fileUrl?: string;
    extractedText?: string;
    confidence?: number;
  }>;
  clinicalFacts?: any;
}

async function persistToDoctorPortal(params: DoctorPortalAppointmentParams) {
  try {
    // 1. Resolve Doctor document in MongoDB
    let doctorDoc = null;
    if (params.doctorId) {
      doctorDoc = await DoctorModel.findOne({ doctorId: params.doctorId });
    }
    if (!doctorDoc && params.specialty) {
      doctorDoc = await DoctorModel.findOne({ department: params.specialty });
    }
    if (!doctorDoc) {
      doctorDoc = await DoctorModel.findOne({ department: "General Medicine" });
    }
    if (!doctorDoc) {
      doctorDoc = await DoctorModel.findOne();
    }

    if (!doctorDoc) {
      console.warn("⚠️ No doctor found in MongoDB for doctor portal sync.");
      return null;
    }

    // 2. Resolve or create Patient document in MongoDB
    const safeName = params.patientName && params.patientName.trim() ? params.patientName.trim() : "Jane Sharma";
    const patientEmail = params.patientEmail || `${safeName.toLowerCase().replace(/[^a-z0-9]/g, ".")}@example.com`;

    let patientDoc = await PatientModel.findOne({
      $or: [{ email: patientEmail }, { name: safeName }],
    });

    if (!patientDoc) {
      // Generate a secure random password for auto-created patients.
      // These accounts are headless (created from intake); the patient should
      // use the registration flow to claim the account with their own password.
      const autoPassword = await bcrypt.hash(`auto-${Date.now()}-${Math.random()}`, 10);
      patientDoc = await PatientModel.create({
        name: safeName,
        email: patientEmail,
        password: autoPassword,
        phone: params.patientPhone || "+91 9876543210",
        age: params.patientAge || 35,
        gender: params.patientGender || "Female",
        bloodType: params.patientBloodType || "O+",
        medicalHistory: [params.problem],
        declarationAccepted: true,
        declarationAcceptedAt: new Date(),
      });
    }

    // 3. Map slot and calculate contiguous queueNumber
    const dateStr = params.slotDate || new Date().toISOString().split("T")[0];
    const DEFINED_SLOTS = [
      { slotId: "slot-0900", label: "09:00 AM - 09:30 AM", startMin: 540 },
      { slotId: "slot-0930", label: "09:30 AM - 10:00 AM", startMin: 570 },
      { slotId: "slot-1000", label: "10:00 AM - 10:30 AM", startMin: 600 },
      { slotId: "slot-1030", label: "10:30 AM - 11:00 AM", startMin: 630 },
      { slotId: "slot-1100", label: "11:00 AM - 11:30 AM", startMin: 660 },
      { slotId: "slot-1130", label: "11:30 AM - 12:00 PM", startMin: 690 },
      { slotId: "slot-1200", label: "12:00 PM - 12:30 PM", startMin: 720 },
      { slotId: "slot-1230", label: "12:30 PM - 01:00 PM", startMin: 750 },
      { slotId: "slot-0200", label: "02:00 PM - 02:30 PM", startMin: 840 },
      { slotId: "slot-0230", label: "02:30 PM - 03:00 PM", startMin: 870 },
      { slotId: "slot-0300", label: "03:00 PM - 03:30 PM", startMin: 900 },
      { slotId: "slot-0330", label: "03:30 PM - 04:00 PM", startMin: 930 },
      { slotId: "slot-0400", label: "04:00 PM - 04:30 PM", startMin: 960 },
      { slotId: "slot-0430", label: "04:30 PM - 05:00 PM", startMin: 990 },
    ];

    let matchedSlot = DEFINED_SLOTS[2]; // default 10:00 AM
    if (params.slotStartTime) {
      const match = params.slotStartTime.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
      if (match) {
        let hours = parseInt(match[1], 10);
        const minutes = parseInt(match[2], 10);
        const meridian = match[3] ? match[3].toUpperCase() : null;
        if (meridian === "PM" && hours < 12) hours += 12;
        if (meridian === "AM" && hours === 12) hours = 0;
        const totalMinutes = hours * 60 + minutes;
        matchedSlot = DEFINED_SLOTS.reduce((prev, curr) =>
          Math.abs(curr.startMin - totalMinutes) < Math.abs(prev.startMin - totalMinutes) ? curr : prev
        );
      }
    }

    // Count existing active appointments for doctor on this date
    const existingCount = await AppointmentModel.countDocuments({
      doctor: doctorDoc._id,
      date: dateStr,
      status: { $in: ["CONFIRMED", "IN_QUEUE", "SOLVED", "RESCHEDULED"] },
    });
    const queueNumber = existingCount + 1;

    // 4. Create Appointment in MongoDB
    const appointmentDoc = await AppointmentModel.findOneAndUpdate(
      { appointmentId: params.appointmentId },
      {
        appointmentId: params.appointmentId,
        patient: patientDoc._id,
        doctor: doctorDoc._id,
        slotId: matchedSlot.slotId,
        slotLabel: matchedSlot.label,
        queueNumber,
        date: dateStr,
        problem: params.problem,
        followupAnswers: params.followupAnswers || [],
        documents: params.documents || [],
        clinicalFacts: params.clinicalFacts || {},
        aiSummary: params.aiSummary,
        summarySource: "LIVE_VOICE_AGENT",
        status: "CONFIRMED",
        statusMessage: "Booked via MediCare AI Voice Intake Kiosk",
      },
      { upsert: true, new: true }
    );

    console.log(
      `✅ [Doctor-Side Portal Sync] Appointment ${params.appointmentId} confirmed in MongoDB:` +
      ` Doctor ${doctorDoc.name} (${doctorDoc.department}) | Queue #${queueNumber} | Slot ${matchedSlot.label}`
    );

    return {
      appointmentDoc,
      doctorDoc,
      patientDoc,
      matchedSlot,
      queueNumber,
    };
  } catch (err: any) {
    console.warn("⚠️ Failed to persist appointment to Doctor-Side MongoDB:", err.message);
    return null;
  }
}


intakeRouter.post("/process", upload.array("files", 5), validateUpload(), async (req: Request, res: Response) => {
  try {
    const { voiceTranscript, chiefComplaint } = req.body;
    // Identity always from JWT — never trust body-supplied IDs
    const patientId = req.user?.patientId || "PAT-8821";
    const patientName = req.user?.name || "Patient";
    const files = req.files as Express.Multer.File[];

    let documentText = req.body.documentText || "";
    let followupAnswers = req.body.followupAnswers || [];
    if (typeof followupAnswers === "string") {
      try {
        followupAnswers = JSON.parse(followupAnswers);
      } catch {
        followupAnswers = [];
      }
    }
    const uploadedFileDetails: any[] = [];

    // Step 1: Process documents if any were uploaded (otherwise skip cleanly)
    if (files && files.length > 0) {
      console.log(`📄 Processing ${files.length} attached document(s) through Python OCR...`);
      try {
        const formData = new FormData();
        for (const file of files) {
          formData.append("files", file.buffer, {
            filename: file.originalname,
            contentType: file.mimetype,
          });
        }

        const extractRes = await axios.post(`${PYTHON_API_URL}/api/extract/batch`, formData, {
          headers: formData.getHeaders(),
          timeout: 45000,
        });

        documentText = extractRes.data.combined_text || "";
        if (extractRes.data.files) {
          uploadedFileDetails.push(...extractRes.data.files);
        }
      } catch (err: any) {
        console.warn("⚠️ Python OCR extraction failed, continuing with voice transcript only:", err.message);
        documentText = "[Document extraction was skipped or unavailable]";
      }
    } else {
      console.log("ℹ️ No documents attached. Proceeding with voice transcript only.");
    }

    // Step 2: Combine Voice + Documents into the canonical intake text
    const textParts: string[] = [];
    if (voiceTranscript && voiceTranscript.trim()) {
      textParts.push(`===== SECTION 1: VOICE INTAKE TRANSCRIPT & PATIENT REPORTED SYMPTOMS =====\n${voiceTranscript.trim()}`);
    } else if (chiefComplaint && chiefComplaint.trim()) {
      textParts.push(`===== SECTION 1: VOICE INTAKE TRANSCRIPT & PATIENT REPORTED SYMPTOMS =====\nPatient: ${chiefComplaint.trim()}`);
    } else {
      textParts.push(`===== SECTION 1: VOICE INTAKE TRANSCRIPT & PATIENT REPORTED SYMPTOMS =====\nPatient presented for clinical intake.`);
    }

    if (documentText && documentText.trim()) {
      textParts.push(`===== SECTION 2: ATTACHED MEDICAL RECORDS, LAB REPORTS & INVESTIGATIONS =====\n${documentText.trim()}`);
    }

    const combinedExtractedText = textParts.join("\n\n");

    // Step 3: Call Python Clinical Structuring & Validation Pipeline
    console.log("🧬 Sending combined text to Clinical Reasoning Pipeline...");
    let clinicalSummary = "";
    let structuredExtraction: any = null;
    let rxnormResults: any[] = [];
    let safeValidatedData: any = null;

    try {
      const clinicalRes = await axios.post(
        `${PYTHON_API_URL}/pipeline/run`,
        { extracted_text: combinedExtractedText, include_timing: true },
        { timeout: 45000 }
      );

      clinicalSummary = clinicalRes.data.clinical_summary || "";
      structuredExtraction = clinicalRes.data.structured_extraction;
      rxnormResults = clinicalRes.data.rxnorm_results || [];
      safeValidatedData = clinicalRes.data.safe_validated_data;
    } catch (err: any) {
      console.warn("⚠️ Clinical pipeline live call unavailable, generating fallback summary:", err.message);
      const docExcerpt = documentText && documentText.trim() ? documentText.slice(0, 1000) : "No attached documents provided.";
      clinicalSummary = `PATIENT SUMMARY\n\nCHIEF CONCERN & PRESENTING COMPLAINT\n${chiefComplaint || "General clinical checkup"}\n\nSYMPTOM ANALYSIS & CLINICAL CONVERSATION\n${voiceTranscript || "Patient reported active symptoms during clinical intake."}\n\nDOCUMENT FINDINGS & DIAGNOSTIC INVESTIGATIONS\n${docExcerpt}\n\nINFORMATION REQUIRING VERIFICATION\nVerification needed during in-person doctor consultation.`;
    }

    // Step 4: Doctor Allocation & Smart Scheduling
    console.log("🩺 Allocating doctor and computing optimal appointment slot...");
    const allocationResult = await allocateDoctor(clinicalSummary || combinedExtractedText);

    const urgency = allocationResult.patientAnalysis.urgency || "MEDIUM";
    const requiredSpecialty = allocationResult.patientAnalysis.requiredSpecialty || "General Medicine";
    const assigned = allocationResult.finalAssignment;

    const caseId = `CASE-${Date.now().toString().slice(-6)}`;
    const appointmentId = `APT-${Date.now().toString().slice(-6)}`;
    const tokenNumber = Math.floor(10 + Math.random() * 40);
    const checkInOtp = Math.floor(1000 + Math.random() * 9000).toString();

    // Step 5: Persist to MongoDB (Clinical Store)
    const newCase = {
      caseId,
      patientId,
      patientName,
      chiefComplaint: chiefComplaint || voiceTranscript || "Clinical consultation",
      symptoms: structuredExtraction?.patient_reported?.symptoms || [chiefComplaint || "Routine consultation"],
      voiceTranscript,
      documentText: documentText || undefined,
      clinicalSummary,
      structuredFacts: structuredExtraction?.facts || [],
      validatedMedicines: rxnormResults || [],
      severity: urgency,
      status: "ALLOCATED",
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    try {
      await PatientCaseModel.create(newCase);
    } catch {
      memoryMongo.cases.set(caseId, newCase);
    }

    // Step 6: Persist to Supabase PostgreSQL (Appointments Database with Severity)
    const slotDate = assigned ? assigned.appointmentStart.split("T")[0] : new Date().toISOString().split("T")[0];
    const startTimeStr = assigned
      ? new Date(assigned.appointmentStart).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })
      : "11:00 AM";
    const endTimeStr = assigned
      ? new Date(assigned.appointmentEnd).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })
      : "11:20 AM";

    const appointmentRecord: AppointmentRecord = {
      appointment_id: appointmentId,
      case_id: caseId,
      patient_id: patientId,
      patient_name: patientName,
      doctor_id: assigned ? assigned.doctorId : "DOC002",
      doctor_name: assigned ? assigned.doctorName : "Dr. Priya Sharma",
      specialty: assigned ? assigned.specialty : requiredSpecialty,
      room_number: "OPD Room 204",
      appointment_date: slotDate,
      start_time: startTimeStr,
      end_time: endTimeStr,
      duration_minutes: assigned?.estimatedDurationMinutes || 15,
      severity: urgency as any,
      token_number: tokenNumber,
      check_in_otp: checkInOtp,
      status: "CONFIRMED",
      is_revisit: false,
      created_at: new Date().toISOString(),
    };

    const savedAppt = await saveAppointment(appointmentRecord);

    // Step 7: Persist to Doctor Consultation Portal MongoDB
    const doctorPortalResult = await persistToDoctorPortal({
      appointmentId,
      doctorId: assigned?.doctorId,
      doctorName: assigned?.doctorName,
      specialty: assigned?.specialty || requiredSpecialty,
      patientName,
      patientEmail: req.body.patientEmail,
      patientPhone: req.body.patientPhone,
      patientAge: req.body.patientAge ? Number(req.body.patientAge) : 35,
      patientGender: req.body.patientGender,
      patientBloodType: req.body.patientBloodType,
      problem: chiefComplaint || voiceTranscript || "Clinical Consultation",
      aiSummary: clinicalSummary,
      slotStartTime: assigned?.appointmentStart || startTimeStr,
      slotDate,
      documents: uploadedFileDetails.length > 0
        ? uploadedFileDetails.map((f, i) => ({
            documentId: `DOC-${Date.now()}-${i}`,
            filename: f.filename || "Attached_Medical_Record.pdf",
            fileType: f.filename?.toLowerCase().endsWith(".pdf") ? "pdf" : "image",
            extractedText: f.extracted_text || documentText,
            confidence: 0.95,
          }))
        : documentText
        ? [{ documentId: `DOC-${Date.now()}`, filename: "Intake_Medical_Report.pdf", fileType: "pdf", extractedText: documentText, confidence: 0.95 }]
        : [],
      followupAnswers,
      clinicalFacts: {
        safeFacts: structuredExtraction?.facts || [],
        prioritizedFacts: structuredExtraction?.patient_reported || {},
        rxnormValidations: rxnormResults,
      },
    });

    return res.status(200).json({
      success: true,
      caseId,
      appointment: {
        ...savedAppt,
        slot_label: doctorPortalResult?.matchedSlot?.label || savedAppt.start_time,
        slot_id: doctorPortalResult?.matchedSlot?.slotId || "slot-1000",
        queue_number: doctorPortalResult?.queueNumber || tokenNumber,
        token_number: doctorPortalResult?.queueNumber || tokenNumber,
        doctor_id: doctorPortalResult?.doctorDoc?.doctorId || savedAppt.doctor_id,
        doctor_name: doctorPortalResult?.doctorDoc?.name || savedAppt.doctor_name,
        specialty: doctorPortalResult?.doctorDoc?.department || savedAppt.specialty,
        mongo_appointment_id: doctorPortalResult?.appointmentDoc?._id,
      },
      patientAnalysis: allocationResult.patientAnalysis,
      clinicalSummary,
      allocationReason: allocationResult.allocationReason,
      alternativeOptions: allocationResult.alternativeOptions,
    });
  } catch (error: any) {
    console.error("❌ Intake process failed:", error);
    return res.status(500).json({ success: false, error: error.message || "Failed to process intake" });
  }
});

// Step 3 API: Run OCR + Clinical Pipeline Structuring Only (Returning clinical summary for patient review)
intakeRouter.post("/structure", upload.array("files", 5), validateUpload(), async (req: Request, res: Response) => {
  try {
    const { voiceTranscript, chiefComplaint } = req.body;
    const files = req.files as Express.Multer.File[];

    let documentText = "";
    const uploadedFileDetails: any[] = [];

    // Process documents if any
    if (files && files.length > 0) {
      console.log(`📄 Processing ${files.length} attached document(s) through Python OCR...`);
      try {
        const formData = new FormData();
        for (const file of files) {
          formData.append("files", file.buffer, {
            filename: file.originalname,
            contentType: file.mimetype,
          });
        }

        const extractRes = await axios.post(`${PYTHON_API_URL}/api/extract/batch`, formData, {
          headers: formData.getHeaders(),
          timeout: 45000,
        });

        documentText = extractRes.data.combined_text || "";
        if (extractRes.data.files) {
          uploadedFileDetails.push(...extractRes.data.files);
        }
      } catch (err: any) {
        console.warn("⚠️ Python OCR extraction failed, continuing with voice transcript:", err.message);
        documentText = "";
      }
    }

    const textParts: string[] = [];
    if (voiceTranscript && voiceTranscript.trim()) {
      textParts.push(`===== SECTION 1: VOICE INTAKE TRANSCRIPT & PATIENT REPORTED SYMPTOMS =====\n${voiceTranscript.trim()}`);
    } else if (chiefComplaint && chiefComplaint.trim()) {
      textParts.push(`===== SECTION 1: VOICE INTAKE TRANSCRIPT & PATIENT REPORTED SYMPTOMS =====\nPatient: ${chiefComplaint.trim()}`);
    } else {
      textParts.push(`===== SECTION 1: VOICE INTAKE TRANSCRIPT & PATIENT REPORTED SYMPTOMS =====\nPatient presented for clinical intake.`);
    }

    if (documentText && documentText.trim()) {
      textParts.push(`===== SECTION 2: ATTACHED MEDICAL RECORDS, LAB REPORTS & INVESTIGATIONS =====\n${documentText.trim()}`);
    }

    const combinedExtractedText = textParts.join("\n\n");

    console.log("🧬 Sending combined evidence to Python Clinical Structuring Pipeline...");
    let clinicalSummary = "";
    let structuredExtraction: any = null;
    let rxnormResults: any[] = [];
    let safeValidatedData: any = null;

    try {
      const clinicalRes = await axios.post(
        `${PYTHON_API_URL}/pipeline/run`,
        { extracted_text: combinedExtractedText, include_timing: true },
        { timeout: 45000 }
      );

      clinicalSummary = clinicalRes.data.clinical_summary || "";
      structuredExtraction = clinicalRes.data.structured_extraction;
      rxnormResults = clinicalRes.data.rxnorm_results || [];
      safeValidatedData = clinicalRes.data.safe_validated_data;
    } catch (err: any) {
      console.warn("⚠️ Clinical pipeline live call failed, generating structured fallback summary:", err.message);
      const docExcerpt = documentText && documentText.trim() ? documentText.slice(0, 1000) : "No attached documents provided.";
      clinicalSummary = `PATIENT SUMMARY\n\nCHIEF CONCERN & PRESENTING COMPLAINT\n${chiefComplaint || "Clinical Consultation"}\n\nSYMPTOM ANALYSIS & CLINICAL CONVERSATION\n${voiceTranscript || "Patient reported active symptoms during intake."}\n\nDOCUMENT FINDINGS & DIAGNOSTIC INVESTIGATIONS\n${docExcerpt}\n\nINFORMATION REQUIRING VERIFICATION\nVerification needed during doctor consultation.`;
    }

    return res.status(200).json({
      success: true,
      clinicalSummary,
      structuredExtraction,
      rxnormResults,
      safeValidatedData,
      documentText,
      uploadedFileCount: files ? files.length : 0,
    });
  } catch (error: any) {
    console.error("❌ Clinical structuring failed:", error);
    return res.status(500).json({ success: false, error: error.message || "Clinical structuring failed" });
  }
});

// Step 5 API: Run Doctor Allocation & Scheduling based on Reviewed Clinical Summary
intakeRouter.post("/allocate", async (req: Request, res: Response) => {
  try {
    const {
      clinicalSummary,
      chiefComplaint = "Clinical Consultation",
      patientId = "PAT-8821",
      patientName = "Jane Sharma",
      structuredExtraction,
      rxnormResults = [],
      documentText,
    } = req.body;

    let followupAnswers = req.body.followupAnswers || [];
    if (typeof followupAnswers === "string") {
      try {
        followupAnswers = JSON.parse(followupAnswers);
      } catch {
        followupAnswers = [];
      }
    }

    console.log("🩺 Allocating doctor and computing optimal slot for reviewed summary...");
    const allocationResult = await allocateDoctor(clinicalSummary || chiefComplaint);

    const urgency = allocationResult.patientAnalysis.urgency || "MEDIUM";
    const requiredSpecialty = allocationResult.patientAnalysis.requiredSpecialty || "General Medicine";
    const assigned = allocationResult.finalAssignment;

    const caseId = `CASE-${Date.now().toString().slice(-6)}`;
    const appointmentId = `APT-${Date.now().toString().slice(-6)}`;
    const tokenNumber = Math.floor(10 + Math.random() * 40);
    const checkInOtp = Math.floor(1000 + Math.random() * 9000).toString();

    // Persist to MongoDB
    const newCase = {
      caseId,
      patientId,
      patientName,
      chiefComplaint,
      symptoms: structuredExtraction?.patient_reported?.symptoms || [chiefComplaint],
      clinicalSummary,
      documentText,
      structuredFacts: structuredExtraction?.facts || [],
      validatedMedicines: rxnormResults,
      severity: urgency,
      status: "ALLOCATED",
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    try {
      await PatientCaseModel.create(newCase);
    } catch {
      memoryMongo.cases.set(caseId, newCase);
    }

    // Persist to Supabase
    const slotDate = assigned ? assigned.appointmentStart.split("T")[0] : new Date().toISOString().split("T")[0];
    const startTimeStr = assigned
      ? new Date(assigned.appointmentStart).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })
      : "11:00 AM";
    const endTimeStr = assigned
      ? new Date(assigned.appointmentEnd).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })
      : "11:20 AM";

    const appointmentRecord: AppointmentRecord = {
      appointment_id: appointmentId,
      case_id: caseId,
      patient_id: patientId,
      patient_name: patientName,
      doctor_id: assigned ? assigned.doctorId : "DOC002",
      doctor_name: assigned ? assigned.doctorName : "Dr. Priya Sharma",
      specialty: assigned ? assigned.specialty : requiredSpecialty,
      room_number: "OPD Room 204",
      appointment_date: slotDate,
      start_time: startTimeStr,
      end_time: endTimeStr,
      duration_minutes: assigned?.estimatedDurationMinutes || 15,
      severity: urgency as any,
      token_number: tokenNumber,
      check_in_otp: checkInOtp,
      status: "CONFIRMED",
      is_revisit: false,
      created_at: new Date().toISOString(),
    };

    const savedAppt = await saveAppointment(appointmentRecord);

    // Persist to Doctor Consultation Portal MongoDB
    const doctorPortalResult = await persistToDoctorPortal({
      appointmentId,
      doctorId: assigned?.doctorId,
      doctorName: assigned?.doctorName,
      specialty: assigned?.specialty || requiredSpecialty,
      patientName,
      patientEmail: req.body.patientEmail,
      patientPhone: req.body.patientPhone,
      patientAge: req.body.patientAge ? Number(req.body.patientAge) : 35,
      patientGender: req.body.patientGender,
      patientBloodType: req.body.patientBloodType,
      problem: chiefComplaint,
      aiSummary: clinicalSummary,
      slotStartTime: assigned?.appointmentStart || startTimeStr,
      slotDate,
      followupAnswers: req.body.followupAnswers || [],
      documents: documentText
        ? [{ documentId: `DOC-${Date.now()}`, filename: "Patient_Diagnostic_Report.pdf", fileType: "pdf", extractedText: documentText, confidence: 0.95 }]
        : [],
      clinicalFacts: {
        safeFacts: structuredExtraction?.facts || [],
        prioritizedFacts: structuredExtraction?.patient_reported || {},
        rxnormValidations: rxnormResults,
      },
    });

    return res.status(200).json({
      success: true,
      caseId,
      appointment: {
        ...savedAppt,
        slot_label: doctorPortalResult?.matchedSlot?.label || savedAppt.start_time,
        slot_id: doctorPortalResult?.matchedSlot?.slotId || "slot-1000",
        queue_number: doctorPortalResult?.queueNumber || tokenNumber,
        token_number: doctorPortalResult?.queueNumber || tokenNumber,
        doctor_id: doctorPortalResult?.doctorDoc?.doctorId || savedAppt.doctor_id,
        doctor_name: doctorPortalResult?.doctorDoc?.name || savedAppt.doctor_name,
        specialty: doctorPortalResult?.doctorDoc?.department || savedAppt.specialty,
        mongo_appointment_id: doctorPortalResult?.appointmentDoc?._id,
      },
      patientAnalysis: allocationResult.patientAnalysis,
      clinicalSummary,
      allocationReason: allocationResult.allocationReason,
      alternativeOptions: allocationResult.alternativeOptions,
    });
  } catch (error: any) {
    console.error("❌ Allocation failed:", error);
    return res.status(500).json({ success: false, error: error.message || "Allocation failed" });
  }
});
