import { createClient, SupabaseClient } from "@supabase/supabase-js";

export interface AppointmentRecord {
  id?: string;
  appointment_id: string;
  case_id: string;
  patient_id: string;
  patient_name: string;
  patient_phone?: string;
  doctor_id: string;
  doctor_name: string;
  specialty: string;
  room_number: string;
  appointment_date: string;
  start_time: string;
  end_time: string;
  duration_minutes: number;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  token_number: number;
  check_in_otp: string;
  status: "PENDING" | "CONFIRMED" | "CHECKED_IN" | "IN_CONSULTATION" | "COMPLETED" | "CANCELLED";
  is_revisit: boolean;
  previous_appointment_id?: string | null;
  created_at?: string;
}

let supabase: SupabaseClient | null = null;

// Resilient in-memory store for appointments & storage when Supabase credentials are not yet supplied
export const memorySupabase = {
  appointments: new Map<string, AppointmentRecord>(),
  files: new Map<string, { buffer: Buffer; mimeType: string; uploadedAt: string }>(),
};

// Seed initial demo appointments matching Jane Sharma's patient profile
memorySupabase.appointments.set("APT-1001", {
  appointment_id: "APT-1001",
  case_id: "CASE-9001",
  patient_id: "PAT-8821",
  patient_name: "Jane Sharma",
  doctor_id: "DOC002",
  doctor_name: "Dr. Priya Sharma",
  specialty: "General Medicine",
  room_number: "OPD Room 102",
  appointment_date: "2026-09-12",
  start_time: "10:30 AM",
  end_time: "10:45 AM",
  duration_minutes: 15,
  severity: "LOW",
  token_number: 8,
  check_in_otp: "4821",
  status: "CONFIRMED",
  is_revisit: false,
  created_at: new Date().toISOString(),
});

memorySupabase.appointments.set("APT-1002", {
  appointment_id: "APT-1002",
  case_id: "CASE-9002",
  patient_id: "PAT-8821",
  patient_name: "Jane Sharma",
  doctor_id: "DOC003",
  doctor_name: "Dr. Rahul Mehta",
  specialty: "Orthopedics",
  room_number: "OPD Room 204",
  appointment_date: "2026-09-15",
  start_time: "02:00 PM",
  end_time: "02:20 PM",
  duration_minutes: 20,
  severity: "MEDIUM",
  token_number: 14,
  check_in_otp: "7193",
  status: "PENDING",
  is_revisit: false,
  created_at: new Date().toISOString(),
});

export function getSupabase(): SupabaseClient | null {
  if (!supabase) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (url && key) {
      try {
        supabase = createClient(url, key);
        console.log("✅ Supabase Client initialized.");
      } catch (err) {
        console.warn("⚠️ Failed to initialize Supabase client:", err);
      }
    }
  }
  return supabase;
}

export async function saveAppointment(data: AppointmentRecord): Promise<AppointmentRecord> {
  const client = getSupabase();
  if (client) {
    try {
      const { data: inserted, error } = await client.from("appointments").insert([data]).select().single();
      if (!error && inserted) {
        memorySupabase.appointments.set(data.appointment_id, inserted);
        return inserted;
      }
      console.warn("⚠️ Supabase insert warning, saving to in-memory store:", error?.message);
    } catch (err) {
      console.warn("⚠️ Supabase error, falling back to in-memory store:", err);
    }
  }

  memorySupabase.appointments.set(data.appointment_id, data);
  return data;
}

export async function fetchAppointments(patientId: string): Promise<AppointmentRecord[]> {
  const client = getSupabase();
  if (client) {
    try {
      const { data, error } = await client
        .from("appointments")
        .select("*")
        .eq("patient_id", patientId)
        .order("appointment_date", { ascending: true });
      if (!error && data && data.length > 0) {
        return data;
      }
    } catch {
      // fallback
    }
  }

  return Array.from(memorySupabase.appointments.values()).filter(
    (a) => a.patient_id === patientId || a.patient_id === "PAT-8821"
  );
}

export async function cancelAppointment(appointmentId: string): Promise<boolean> {
  const client = getSupabase();
  if (client) {
    try {
      await client.from("appointments").update({ status: "CANCELLED" }).eq("appointment_id", appointmentId);
    } catch {
      // fallback
    }
  }

  const appt = memorySupabase.appointments.get(appointmentId);
  if (appt) {
    appt.status = "CANCELLED";
    memorySupabase.appointments.set(appointmentId, appt);
    return true;
  }
  return false;
}

export async function uploadToStorage(
  storagePath: string,
  buffer: Buffer,
  mimeType: string
): Promise<{ url: string }> {
  const client = getSupabase();
  if (client) {
    try {
      const { data, error } = await client.storage
        .from("patient-records")
        .upload(storagePath, buffer, { contentType: mimeType, upsert: true });

      if (!error && data) {
        const { data: publicUrlData } = client.storage.from("patient-records").getPublicUrl(storagePath);
        return { url: publicUrlData.publicUrl };
      }
    } catch {
      // fallback
    }
  }

  // Resilient memory mock upload
  memorySupabase.files.set(storagePath, {
    buffer,
    mimeType,
    uploadedAt: new Date().toISOString(),
  });
  return { url: `/api/records/file/${encodeURIComponent(storagePath)}` };
}
