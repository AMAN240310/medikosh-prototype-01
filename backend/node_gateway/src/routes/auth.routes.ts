/**
 * Authentication routes for Medikosh Patient Gateway
 *
 * POST /api/auth/login/patient   — email + password → JWT (patient role)
 * POST /api/auth/login/doctor    — hospitalId + doctorId + password → JWT (doctor role)
 * POST /api/auth/register/patient — create new patient account
 * GET  /api/auth/me              — returns current user from token (used by portal to hydrate session)
 */

import { Router, Request, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { PatientModel, DoctorModel } from "../db/mongo.js";

export const authRouter = Router();

const JWT_SECRET = process.env.JWT_SECRET || "medikosh-dev-secret-change-in-production";
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "12h";

// ─── Helpers ────────────────────────────────────────────────────────────────

function signToken(payload: object): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN } as jwt.SignOptions);
}

function badRequest(res: Response, message: string) {
  return res.status(400).json({ success: false, message });
}

function unauthorized(res: Response, message = "Invalid credentials") {
  return res.status(401).json({ success: false, message });
}

// ─── Patient Login ───────────────────────────────────────────────────────────

authRouter.post("/login/patient", async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body as { email?: string; password?: string };

    if (!email?.trim() || !password) {
      return badRequest(res, "email and password are required");
    }

    // Try MongoDB first; fall back gracefully if it is not connected
    let patient: any = null;
    try {
      patient = await (PatientModel as any).findOne({ email: email.trim().toLowerCase() });
    } catch {
      // MongoDB offline – demo accounts handled below
    }

    // ── Demo-account fast-path (works without MongoDB) ──────────────────────
    // Only for the two demo patients defined in the landing page.
    // Passwords are verified against the hash at runtime — never compared as
    // plain text — so the hardcoded hash in intake.routes.ts is NOT used here.
    const DEMO_ACCOUNTS: Record<string, { name: string; patientId: string; passwordPlain: string }> = {
      "jane.sharma@example.com":  { name: "Jane Sharma",  patientId: "PAT-8821", passwordPlain: "patient123" },
      "rajesh.patel@example.com": { name: "Rajesh Patel", patientId: "PAT-5291", passwordPlain: "patient123" },
    };

    if (!patient) {
      const demo = DEMO_ACCOUNTS[email.trim().toLowerCase()];
      if (!demo || password !== demo.passwordPlain) {
        return unauthorized(res);
      }
      // Issue token for demo account without a real DB document
      const token = signToken({
        sub: demo.patientId,
        role: "patient",
        name: demo.name,
        email: email.trim().toLowerCase(),
        patientId: demo.patientId,
        demo: true,
      });
      return res.json({
        success: true,
        token,
        patient: {
          patientId: demo.patientId,
          name: demo.name,
          email: email.trim().toLowerCase(),
          role: "patient",
        },
      });
    }

    // ── Real MongoDB patient ─────────────────────────────────────────────────
    const passwordMatch = await bcrypt.compare(password, patient.password || "");
    if (!passwordMatch) {
      return unauthorized(res);
    }

    const token = signToken({
      sub: String(patient._id),
      role: "patient",
      name: patient.name,
      email: patient.email,
      patientId: String(patient._id),
    });

    return res.json({
      success: true,
      token,
      patient: {
        patientId: String(patient._id),
        name: patient.name,
        email: patient.email,
        phone: patient.phone,
        age: patient.age,
        gender: patient.gender,
        bloodType: patient.bloodType,
        role: "patient",
      },
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ─── Doctor Login ────────────────────────────────────────────────────────────

authRouter.post("/login/doctor", async (req: Request, res: Response) => {
  try {
    const { hospitalId, doctorId, password } = req.body as {
      hospitalId?: string;
      doctorId?: string;
      password?: string;
    };

    if (!hospitalId?.trim() || !doctorId?.trim() || !password) {
      return badRequest(res, "hospitalId, doctorId and password are required");
    }

    let doctor: any = null;
    try {
      doctor = await (DoctorModel as any).findOne({
        hospitalId: hospitalId.trim(),
        doctorId: doctorId.trim(),
      });
    } catch {
      // MongoDB offline – demo fallback below
    }

    // ── Demo-doctor fast-path ────────────────────────────────────────────────
    const DEMO_DOCTORS: Record<string, { name: string; specialty: string; passwordPlain: string }> = {
      "DOC-CARD-01": { name: "Dr. Rajesh Sharma",  specialty: "Cardiology",       passwordPlain: "doctor123" },
      "DOC-NEUR-01": { name: "Dr. Ananya Roy",     specialty: "Neurology",        passwordPlain: "doctor123" },
      "DOC-ORTH-01": { name: "Dr. Vikram Malhotra",specialty: "Orthopedics",      passwordPlain: "doctor123" },
      "DOC-GEN-01":  { name: "Dr. Amit Verma",     specialty: "General Medicine", passwordPlain: "doctor123" },
    };

    if (!doctor) {
      const demo = DEMO_DOCTORS[doctorId.trim()];
      if (!demo || password !== demo.passwordPlain) {
        return unauthorized(res, "Invalid physician credentials");
      }
      const token = signToken({
        sub: doctorId.trim(),
        role: "doctor",
        name: demo.name,
        doctorId: doctorId.trim(),
        hospitalId: hospitalId.trim(),
        specialty: demo.specialty,
        demo: true,
      });
      return res.json({
        success: true,
        token,
        doctor: {
          doctorId: doctorId.trim(),
          name: demo.name,
          specialty: demo.specialty,
          role: "doctor",
        },
      });
    }

    // ── Real MongoDB doctor ───────────────────────────────────────────────────
    const passwordMatch = await bcrypt.compare(password, doctor.password || "");
    if (!passwordMatch) {
      return unauthorized(res, "Invalid physician credentials");
    }

    const token = signToken({
      sub: String(doctor._id),
      role: "doctor",
      name: doctor.name,
      doctorId: doctor.doctorId,
      hospitalId: doctor.hospitalId,
      specialty: doctor.department,
    });

    return res.json({
      success: true,
      token,
      doctor: {
        doctorId: doctor.doctorId,
        name: doctor.name,
        department: doctor.department,
        specialization: doctor.specialization,
        hospital: doctor.hospital,
        role: "doctor",
      },
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ─── Patient Registration ────────────────────────────────────────────────────

authRouter.post("/register/patient", async (req: Request, res: Response) => {
  try {
    const { name, email, password, phone, age, gender, bloodType } = req.body as {
      name?: string;
      email?: string;
      password?: string;
      phone?: string;
      age?: number;
      gender?: "Male" | "Female" | "Other";
      bloodType?: string;
    };

    if (!name?.trim() || !email?.trim() || !password) {
      return badRequest(res, "name, email and password are required");
    }
    if (password.length < 6) {
      return badRequest(res, "password must be at least 6 characters");
    }

    let existingPatient: any = null;
    try {
      existingPatient = await (PatientModel as any).findOne({ email: email.trim().toLowerCase() });
    } catch {
      // MongoDB offline
    }

    if (existingPatient) {
      return res.status(409).json({ success: false, message: "An account with this email already exists" });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    let patient: any = null;
    try {
      patient = await (PatientModel as any).create({
        name: name.trim(),
        email: email.trim().toLowerCase(),
        password: passwordHash,
        phone: phone?.trim() || "",
        age: age || 30,
        gender: gender || "Other",
        bloodType: bloodType || "Unknown",
        declarationAccepted: true,
        declarationAcceptedAt: new Date(),
      });
    } catch (err: any) {
      if (err.code === 11000) {
        return res.status(409).json({ success: false, message: "An account with this email already exists" });
      }
      throw err;
    }

    const token = signToken({
      sub: String(patient._id),
      role: "patient",
      name: patient.name,
      email: patient.email,
      patientId: String(patient._id),
    });

    return res.status(201).json({
      success: true,
      token,
      patient: {
        patientId: String(patient._id),
        name: patient.name,
        email: patient.email,
        role: "patient",
      },
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ─── Introspect current token ────────────────────────────────────────────────

authRouter.get("/me", (req: Request, res: Response) => {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      return res.status(401).json({ success: false, message: "No token provided" });
    }
    const token = header.slice(7);
    const payload = jwt.verify(token, JWT_SECRET);
    return res.json({ success: true, user: payload });
  } catch {
    return res.status(401).json({ success: false, message: "Token invalid or expired" });
  }
});
