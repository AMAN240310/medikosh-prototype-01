/**
 * Integration tests for /api/auth routes.
 *
 * Runs against the real express app (in-process, no network port needed).
 * Uses Node's built-in test runner (node:test) + assert — zero extra deps.
 *
 * Run with:
 *   cd backend/node_gateway
 *   node --experimental-vm-modules --loader tsx tests/auth.test.ts
 *
 * Or simply:
 *   npx tsx tests/auth.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";

const BASE = process.env.GATEWAY_URL || "http://localhost:5000";

async function post(path: string, body: object): Promise<{ status: number; data: any }> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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

// ─── Patient Login ────────────────────────────────────────────────────────────

test("POST /api/auth/login/patient — demo account Jane Sharma succeeds", async () => {
  const { status, data } = await post("/api/auth/login/patient", {
    email: "jane.sharma@example.com",
    password: "patient123",
  });
  assert.equal(status, 200, `Expected 200, got ${status}: ${JSON.stringify(data)}`);
  assert.ok(data.success, "Expected success: true");
  assert.ok(typeof data.token === "string" && data.token.length > 10, "Expected a JWT token");
  assert.equal(data.patient.patientId, "PAT-8821");
  assert.equal(data.patient.role, "patient");
});

test("POST /api/auth/login/patient — wrong password returns 401", async () => {
  const { status, data } = await post("/api/auth/login/patient", {
    email: "jane.sharma@example.com",
    password: "wrongpassword",
  });
  assert.equal(status, 401, `Expected 401, got ${status}`);
  assert.equal(data.success, false);
});

test("POST /api/auth/login/patient — unknown email returns 401", async () => {
  const { status, data } = await post("/api/auth/login/patient", {
    email: "unknown@example.com",
    password: "patient123",
  });
  assert.equal(status, 401, `Expected 401, got ${status}`);
  assert.equal(data.success, false);
});

test("POST /api/auth/login/patient — missing fields returns 400", async () => {
  const { status, data } = await post("/api/auth/login/patient", { email: "x@x.com" });
  assert.equal(status, 400, `Expected 400, got ${status}`);
  assert.equal(data.success, false);
});

// ─── Doctor Login ─────────────────────────────────────────────────────────────

test("POST /api/auth/login/doctor — demo doctor DOC-CARD-01 succeeds", async () => {
  const { status, data } = await post("/api/auth/login/doctor", {
    hospitalId: "HOSP101",
    doctorId: "DOC-CARD-01",
    password: "doctor123",
  });
  assert.equal(status, 200, `Expected 200, got ${status}: ${JSON.stringify(data)}`);
  assert.ok(data.success);
  assert.ok(typeof data.token === "string" && data.token.length > 10);
  assert.equal(data.doctor.role, "doctor");
  assert.equal(data.doctor.specialty, "Cardiology");
});

test("POST /api/auth/login/doctor — wrong password returns 401", async () => {
  const { status, data } = await post("/api/auth/login/doctor", {
    hospitalId: "HOSP101",
    doctorId: "DOC-CARD-01",
    password: "badpass",
  });
  assert.equal(status, 401);
  assert.equal(data.success, false);
});

test("POST /api/auth/login/doctor — missing doctorId returns 400", async () => {
  const { status } = await post("/api/auth/login/doctor", {
    hospitalId: "HOSP101",
    password: "doctor123",
  });
  assert.equal(status, 400);
});

// ─── /api/auth/me ─────────────────────────────────────────────────────────────

test("GET /api/auth/me — valid patient token returns user", async () => {
  const { data: loginData } = await post("/api/auth/login/patient", {
    email: "jane.sharma@example.com",
    password: "patient123",
  });
  const { status, data } = await get("/api/auth/me", loginData.token);
  assert.equal(status, 200);
  assert.ok(data.success);
  assert.equal(data.user.role, "patient");
});

test("GET /api/auth/me — no token returns 401", async () => {
  const { status, data } = await get("/api/auth/me");
  assert.equal(status, 401);
  assert.equal(data.success, false);
});

test("GET /api/auth/me — invalid token returns 401", async () => {
  const { status, data } = await get("/api/auth/me", "not.a.real.token");
  assert.equal(status, 401);
  assert.equal(data.success, false);
});

// ─── Protected route guard ────────────────────────────────────────────────────

test("GET /api/appointments — no token returns 401", async () => {
  const { status } = await get("/api/appointments");
  assert.equal(status, 401, "Protected route must reject unauthenticated request");
});

test("GET /api/records — no token returns 401", async () => {
  const { status } = await get("/api/records");
  assert.equal(status, 401);
});

test("GET /api/appointments — valid patient token returns appointments", async () => {
  const { data: loginData } = await post("/api/auth/login/patient", {
    email: "jane.sharma@example.com",
    password: "patient123",
  });
  const { status, data } = await get("/api/appointments", loginData.token);
  assert.equal(status, 200, `Expected 200, got ${status}: ${JSON.stringify(data)}`);
  assert.ok(data.success);
  assert.ok(Array.isArray(data.appointments));
});

// ─── Doctors listing (public) ─────────────────────────────────────────────────

test("GET /api/doctors — public route returns doctors list", async () => {
  const { status, data } = await get("/api/doctors");
  assert.equal(status, 200);
  assert.ok(data.success);
  assert.ok(Array.isArray(data.doctors) && data.doctors.length > 0);
});

test("GET /api/doctors?specialty=Cardiology — filters by specialty", async () => {
  const { status, data } = await get("/api/doctors?specialty=Cardiology");
  assert.equal(status, 200);
  assert.ok(data.doctors.every((d: any) => d.specialty === "Cardiology"));
});

test("GET /api/doctors/specialties — returns specialty list", async () => {
  const { status, data } = await get("/api/doctors/specialties");
  assert.equal(status, 200);
  assert.ok(Array.isArray(data.specialties) && data.specialties.length > 0);
});

console.log("\n✅ Auth & API integration tests complete.\n");
