/**
 * Integration tests for /api/appointments routes.
 *
 * Covers:
 *   - Authorization isolation: patient A cannot touch patient B's appointments
 *   - Input validation: date, timeSlot, specialty
 *   - End-time calculation: including the critical AM→PM and PM→AM rollovers
 *   - Ownership enforcement: cancel only own appointments
 *
 * Run with:
 *   cd backend/node_gateway
 *   npx tsx tests/appointments.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";

const BASE = process.env.GATEWAY_URL || "http://localhost:5000";

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function post(path: string, body: object, token?: string): Promise<{ status: number; data: any }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return { status: res.status, data };
}

async function get(path: string, token?: string): Promise<{ status: number; data: any }> {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, { headers });
  const data = await res.json();
  return { status: res.status, data };
}

/** Login a demo patient and return their JWT token */
async function loginPatient(email: string, password = "patient123"): Promise<string> {
  const { data } = await post("/api/auth/login/patient", { email, password });
  if (!data.token) throw new Error(`Login failed for ${email}: ${JSON.stringify(data)}`);
  return data.token;
}

/** Future date string in YYYY-MM-DD format */
function futureDate(daysFromNow = 7): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d.toISOString().split("T")[0];
}

/** Yesterday in YYYY-MM-DD format */
function pastDate(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().split("T")[0];
}

// ─── Authorization: unauthenticated ──────────────────────────────────────────

test("GET /api/appointments — unauthenticated returns 401", async () => {
  const { status } = await get("/api/appointments");
  assert.equal(status, 401, "No token must be rejected");
});

test("POST /api/appointments/quick-book — unauthenticated returns 401", async () => {
  const { status } = await post("/api/appointments/quick-book", {
    appointmentDate: futureDate(),
    timeSlot: "09:00 AM",
  });
  assert.equal(status, 401);
});

// ─── Authorization: patient A cannot see patient B's appointments ─────────────

test("Patient A cannot see Patient B's appointments — scoped to own ID", async () => {
  const janeToken = await loginPatient("jane.sharma@example.com");
  const rajeshToken = await loginPatient("rajesh.patel@example.com");

  // Book an appointment for Jane
  const bookRes = await post("/api/appointments/quick-book", {
    appointmentDate: futureDate(),
    timeSlot: "09:00 AM",
    specialty: "General Medicine",
    reason: "Routine checkup",
  }, janeToken);
  assert.equal(bookRes.status, 201, "Jane should be able to book");

  // Rajesh fetches his own appointments — must not include Jane's booking
  const rajeshAppts = await get("/api/appointments", rajeshToken);
  assert.equal(rajeshAppts.status, 200);
  const janeId = bookRes.data.appointment?.patient_id;
  if (janeId) {
    const leak = rajeshAppts.data.appointments.some((a: any) => a.appointment_id === bookRes.data.appointment?.appointment_id);
    assert.equal(leak, false, "Rajesh must not see Jane's appointment");
  }
});

// ─── Authorization: cancel ownership ─────────────────────────────────────────

test("Patient cannot cancel another patient's appointment — returns 404", async () => {
  const janeToken = await loginPatient("jane.sharma@example.com");
  const rajeshToken = await loginPatient("rajesh.patel@example.com");

  // Jane books an appointment
  const bookRes = await post("/api/appointments/quick-book", {
    appointmentDate: futureDate(3),
    timeSlot: "10:00 AM",
    specialty: "General Medicine",
  }, janeToken);
  assert.equal(bookRes.status, 201);
  const apptId = bookRes.data.appointment?.appointment_id;
  assert.ok(apptId, "Should have appointment_id");

  // Rajesh tries to cancel Jane's appointment
  const cancelRes = await post(`/api/appointments/${apptId}/cancel`, {}, rajeshToken);
  assert.equal(cancelRes.status, 404, "Should return 404 — not reveal ownership");
});

// ─── Booking input validation ────────────────────────────────────────────────

test("POST /api/appointments/quick-book — missing appointmentDate returns 400", async () => {
  const token = await loginPatient("jane.sharma@example.com");
  const { status, data } = await post("/api/appointments/quick-book", {
    timeSlot: "09:00 AM",
  }, token);
  assert.equal(status, 400);
  assert.ok(data.error, "Should include error message");
});

test("POST /api/appointments/quick-book — missing timeSlot returns 400", async () => {
  const token = await loginPatient("jane.sharma@example.com");
  const { status, data } = await post("/api/appointments/quick-book", {
    appointmentDate: futureDate(),
  }, token);
  assert.equal(status, 400);
  assert.ok(data.error);
});

test("POST /api/appointments/quick-book — invalid date format returns 400", async () => {
  const token = await loginPatient("jane.sharma@example.com");
  const { status } = await post("/api/appointments/quick-book", {
    appointmentDate: "25-12-2026",   // wrong format: DD-MM-YYYY
    timeSlot: "09:00 AM",
  }, token);
  assert.equal(status, 400, "Should reject non-ISO date format");
});

test("POST /api/appointments/quick-book — nonsense date returns 400", async () => {
  const token = await loginPatient("jane.sharma@example.com");
  const { status } = await post("/api/appointments/quick-book", {
    appointmentDate: "not-a-date",
    timeSlot: "09:00 AM",
  }, token);
  assert.equal(status, 400);
});

test("POST /api/appointments/quick-book — past date returns 400", async () => {
  const token = await loginPatient("jane.sharma@example.com");
  const { status, data } = await post("/api/appointments/quick-book", {
    appointmentDate: pastDate(),
    timeSlot: "09:00 AM",
  }, token);
  assert.equal(status, 400, "Past dates must be rejected");
  assert.ok(data.error?.toLowerCase().includes("past"), `Expected 'past' in error: ${data.error}`);
});

test("POST /api/appointments/quick-book — invalid timeSlot format returns 400", async () => {
  const token = await loginPatient("jane.sharma@example.com");
  const { status } = await post("/api/appointments/quick-book", {
    appointmentDate: futureDate(),
    timeSlot: "9am",  // no colon, no space
  }, token);
  assert.equal(status, 400, "Should reject malformed time slot");
});

test("POST /api/appointments/quick-book — timeSlot 24-hour format returns 400", async () => {
  const token = await loginPatient("jane.sharma@example.com");
  const { status } = await post("/api/appointments/quick-book", {
    appointmentDate: futureDate(),
    timeSlot: "14:00",  // 24-hour, no AM/PM
  }, token);
  assert.equal(status, 400, "Should reject 24-hour time format");
});

// ─── Booking success ──────────────────────────────────────────────────────────

test("POST /api/appointments/quick-book — valid booking returns 201 with appointment", async () => {
  const token = await loginPatient("jane.sharma@example.com");
  const { status, data } = await post("/api/appointments/quick-book", {
    appointmentDate: futureDate(),
    timeSlot: "09:30 AM",
    specialty: "Cardiology",
    reason: "Chest pain follow-up",
  }, token);
  assert.equal(status, 201, `Expected 201, got ${status}: ${JSON.stringify(data)}`);
  assert.ok(data.success);
  assert.ok(data.appointment?.appointment_id);
  assert.ok(data.appointment?.start_time);
  assert.ok(data.appointment?.end_time);
  assert.equal(data.appointment?.patient_id, "PAT-8821", "Patient ID must come from JWT");
});

// ─── End-time calculation: verify correct meridian rollover ──────────────────
// These tests hit the booking endpoint and verify the calculated end_time,
// catching the bug where the old code produced "11:50 AM" → "12:05 AM"
// (should be "12:05 PM").

test("end_time: 09:00 AM + 15 min = 09:15 AM", async () => {
  const token = await loginPatient("jane.sharma@example.com");
  const { data } = await post("/api/appointments/quick-book", {
    appointmentDate: futureDate(2),
    timeSlot: "09:00 AM",
  }, token);
  assert.equal(data.appointment?.end_time, "09:15 AM", `Got: ${data.appointment?.end_time}`);
});

test("end_time: 09:50 AM + 15 min = 10:05 AM", async () => {
  const token = await loginPatient("jane.sharma@example.com");
  const { data } = await post("/api/appointments/quick-book", {
    appointmentDate: futureDate(2),
    timeSlot: "09:50 AM",
  }, token);
  assert.equal(data.appointment?.end_time, "10:05 AM", `Got: ${data.appointment?.end_time}`);
});

test("end_time: 11:50 AM + 15 min = 12:05 PM  (AM→PM noon rollover)", async () => {
  const token = await loginPatient("jane.sharma@example.com");
  const { data } = await post("/api/appointments/quick-book", {
    appointmentDate: futureDate(2),
    timeSlot: "11:50 AM",
  }, token);
  assert.equal(data.appointment?.end_time, "12:05 PM",
    `AM→PM rollover bug! Got: ${data.appointment?.end_time}`);
});

test("end_time: 11:50 PM + 15 min = 12:05 AM  (PM→AM midnight rollover)", async () => {
  const token = await loginPatient("jane.sharma@example.com");
  const { data } = await post("/api/appointments/quick-book", {
    appointmentDate: futureDate(2),
    timeSlot: "11:50 PM",
  }, token);
  assert.equal(data.appointment?.end_time, "12:05 AM",
    `PM→AM rollover bug! Got: ${data.appointment?.end_time}`);
});

// ─── Records isolation ────────────────────────────────────────────────────────

test("Patient can only see their own records — not all records in the system", async () => {
  // Rajesh (PAT-5291) should not see Jane's seeded records (PAT-8821)
  const rajeshToken = await loginPatient("rajesh.patel@example.com");
  const { status, data } = await get("/api/records", rajeshToken);
  assert.equal(status, 200);
  // All returned records must belong to Rajesh, not Jane
  const hasJaneRecord = data.records.some((r: any) => r.patientId === "PAT-8821");
  assert.equal(hasJaneRecord, false, "Rajesh must not see Jane's records (PAT-8821)");
});

test("Jane can see her own seeded records", async () => {
  const janeToken = await loginPatient("jane.sharma@example.com");
  const { status, data } = await get("/api/records", janeToken);
  assert.equal(status, 200);
  assert.ok(data.records.length > 0, "Jane should have seeded records");
  const allBelongToJane = data.records.every((r: any) => r.patientId === "PAT-8821");
  assert.equal(allBelongToJane, true, "All records must belong to PAT-8821");
});

console.log("\n✅ Appointments & authorization integration tests complete.\n");
