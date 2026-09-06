import { Router, Request, Response } from "express";
import { fetchAppointments, saveAppointment, cancelAppointment, AppointmentRecord } from "../db/supabase";
import { doctors } from "../allocation/data/doctors";

export const appointmentsRouter = Router();

// GET all appointments for patient
appointmentsRouter.get("/", async (req: Request, res: Response) => {
  try {
    const patientId = (req.query.patientId as string) || "PAT-8821";
    const appts = await fetchAppointments(patientId);
    return res.json({ success: true, appointments: appts });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Path A: Standard Quick Form Booking
appointmentsRouter.post("/quick-book", async (req: Request, res: Response) => {
  try {
    const {
      specialty = "General Medicine",
      appointmentDate,
      timeSlot,
      reason,
      patientId = "PAT-8821",
      patientName = "Jane Sharma",
    } = req.body;

    if (!appointmentDate || !timeSlot) {
      return res.status(400).json({ success: false, error: "Date and Time Slot are required" });
    }

    // Match an active doctor in this specialty
    const matchingDoc = doctors.find((d) => d.specialty.toLowerCase() === specialty.toLowerCase() && d.active) || doctors[0];

    const appointmentId = `APT-${Date.now().toString().slice(-6)}`;
    const tokenNumber = Math.floor(10 + Math.random() * 40);
    const checkInOtp = Math.floor(1000 + Math.random() * 9000).toString();

    const appt: AppointmentRecord = {
      appointment_id: appointmentId,
      case_id: `CASE-DIRECT-${Date.now().toString().slice(-4)}`,
      patient_id: patientId,
      patient_name: patientName,
      doctor_id: matchingDoc.id,
      doctor_name: matchingDoc.name,
      specialty: matchingDoc.specialty,
      room_number: "OPD Room 104",
      appointment_date: appointmentDate,
      start_time: timeSlot,
      end_time: timeSlot.replace("AM", "15 AM").replace("PM", "15 PM"),
      duration_minutes: 15,
      severity: "MEDIUM",
      token_number: tokenNumber,
      check_in_otp: checkInOtp,
      status: "CONFIRMED",
      is_revisit: false,
      created_at: new Date().toISOString(),
    };

    const saved = await saveAppointment(appt);
    return res.status(201).json({ success: true, appointment: saved });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 3-Day Follow-Up / Revisit Continuity Scheduling
appointmentsRouter.post("/revisit", async (req: Request, res: Response) => {
  try {
    const {
      previousDoctorId = "DOC003",
      previousAppointmentId,
      patientId = "PAT-8821",
      patientName = "Jane Sharma",
      days = 3,
    } = req.body;

    const doc = doctors.find((d) => d.id === previousDoctorId) || doctors[0];

    // Compute target date (e.g. today + 3 days)
    const target = new Date();
    target.setDate(target.getDate() + Number(days));
    const targetDateStr = target.toISOString().split("T")[0];

    const appointmentId = `APT-REV-${Date.now().toString().slice(-5)}`;
    const tokenNumber = Math.floor(5 + Math.random() * 20);
    const checkInOtp = Math.floor(1000 + Math.random() * 9000).toString();

    const appt: AppointmentRecord = {
      appointment_id: appointmentId,
      case_id: `CASE-REV-${Date.now().toString().slice(-4)}`,
      patient_id: patientId,
      patient_name: patientName,
      doctor_id: doc.id,
      doctor_name: doc.name,
      specialty: doc.specialty,
      room_number: "OPD Room 204",
      appointment_date: targetDateStr,
      start_time: "11:30 AM",
      end_time: "11:45 AM",
      duration_minutes: 15,
      severity: "LOW",
      token_number: tokenNumber,
      check_in_otp: checkInOtp,
      status: "CONFIRMED",
      is_revisit: true,
      previous_appointment_id: previousAppointmentId || null,
      created_at: new Date().toISOString(),
    };

    const saved = await saveAppointment(appt);
    return res.status(201).json({
      success: true,
      message: `Follow-up appointment scheduled with ${doc.name} for ${targetDateStr}`,
      appointment: saved,
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Cancel Appointment
appointmentsRouter.post("/:id/cancel", async (req: Request, res: Response) => {
  try {
    const ok = await cancelAppointment(req.params.id);
    return res.json({ success: ok, message: ok ? "Appointment cancelled" : "Appointment not found" });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});
