import { Router, Request, Response } from "express";
import { fetchAppointments, saveAppointment, cancelAppointment, AppointmentRecord } from "../db/supabase.js";
import { doctors } from "../allocation/data/doctors.js";

export const appointmentsRouter = Router();

// ─── Validation helpers ──────────────────────────────────────────────────────

/** Accept ISO date YYYY-MM-DD only */
function isValidDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));
}

/** Accept "H:MM AM/PM" or "HH:MM AM/PM" */
function isValidTimeSlot(s: string): boolean {
  return /^\d{1,2}:\d{2}\s*(AM|PM)$/i.test(s.trim());
}

// ─── End-time calculation ────────────────────────────────────────────────────

/**
 * Add 15 minutes to a "HH:MM AM/PM" time string with full meridian rollover.
 * Examples:
 *   "09:00 AM" → "09:15 AM"
 *   "09:50 AM" → "10:05 AM"
 *   "11:50 AM" → "12:05 PM"   ← AM→PM rollover
 *   "11:50 PM" → "12:05 AM"   ← PM→AM (midnight) rollover
 */
export function addFifteenMinutes(timeSlot: string): string {
  const m = timeSlot.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!m) return timeSlot;

  let h = parseInt(m[1], 10);
  let min = parseInt(m[2], 10) + 15;
  let meridian = m[3].toUpperCase() as "AM" | "PM";

  if (min >= 60) {
    h += 1;
    min -= 60;
  }

  // Handle 12-hour rollover with meridian flip
  if (h === 12 && meridian === "AM") {
    // 11:50 AM + 15 → 12:05 PM  (noon)
    meridian = "PM";
  } else if (h > 12) {
    // e.g. 12:50 PM + 15 → 13:05 PM → 01:05 AM (midnight boundary)
    h -= 12;
    meridian = meridian === "AM" ? "PM" : "AM";
  } else if (h === 12 && meridian === "PM") {
    // 11:50 PM + 15 → 12:05 AM  (midnight)
    meridian = "AM";
  }

  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")} ${meridian}`;
}

// GET all appointments for patient — patient ID resolved from JWT, not query string
appointmentsRouter.get("/", async (req: Request, res: Response) => {
  try {
    const patientId = req.user?.patientId || "PAT-8821";
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
    } = req.body;

    // Identity ALWAYS comes from the JWT — never trust client-supplied IDs
    const patientId = req.user!.patientId!;
    const patientName = req.user!.name;

    // ── Input validation ────────────────────────────────────────────────────
    if (!appointmentDate || !isValidDate(String(appointmentDate))) {
      return res.status(400).json({ success: false, error: "appointmentDate must be a valid YYYY-MM-DD date." });
    }
    if (!timeSlot || !isValidTimeSlot(String(timeSlot))) {
      return res.status(400).json({ success: false, error: "timeSlot must be in HH:MM AM/PM format (e.g. 09:30 AM)." });
    }
    if (typeof specialty !== "string" || specialty.trim().length === 0) {
      return res.status(400).json({ success: false, error: "specialty must be a non-empty string." });
    }

    // ── Reject past dates ───────────────────────────────────────────────────
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (new Date(appointmentDate) < today) {
      return res.status(400).json({ success: false, error: "appointmentDate cannot be in the past." });
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
      start_time: timeSlot.trim(),
      end_time: addFifteenMinutes(timeSlot.trim()),
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
      days = 3,
    } = req.body;

    // Identity from JWT — never from body
    const patientId = req.user!.patientId!;
    const patientName = req.user!.name;

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

// Cancel Appointment — verify ownership before cancelling
appointmentsRouter.post("/:id/cancel", async (req: Request, res: Response) => {
  try {
    const appointmentId = req.params.id;
    const patientId = req.user!.patientId!;

    // Fetch the patient's own appointments and confirm this ID belongs to them
    const patientAppointments = await fetchAppointments(patientId);
    const owns = patientAppointments.some((a: any) => a.appointment_id === appointmentId);
    if (!owns) {
      // Return 404 — don't reveal that the appointment exists but belongs to someone else
      return res.status(404).json({ success: false, message: "Appointment not found" });
    }

    const ok = await cancelAppointment(appointmentId);
    return res.json({ success: ok, message: ok ? "Appointment cancelled" : "Appointment not found" });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});
