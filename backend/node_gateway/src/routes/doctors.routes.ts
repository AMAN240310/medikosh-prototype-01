/**
 * Doctors listing route
 *
 * GET /api/doctors          — list all active doctors (optionally filter by specialty)
 * GET /api/doctors/specialties — list distinct specialties
 *
 * Patient-facing — returns only non-sensitive fields (no schedule details).
 */

import { Router, Request, Response } from "express";
import { doctors } from "../allocation/data/doctors.js";

export const doctorsRouter = Router();

// GET /api/doctors?specialty=Cardiology
doctorsRouter.get("/", (_req: Request, res: Response) => {
  const specialty = _req.query.specialty as string | undefined;

  const filtered = doctors
    .filter((d) => d.active && !d.onLeave)
    .filter((d) => !specialty || d.specialty.toLowerCase() === specialty.toLowerCase())
    .map((d) => ({
      id: d.id,
      name: d.name,
      specialty: d.specialty,
      skills: d.skills,
      emergencyCapable: d.emergencyCapable,
      workingHours: d.workingHours,
      // Availability indicator (not slot details)
      availableToday: d.currentPatients < d.maxPatientsPerDay,
      currentLoad: Math.round((d.currentPatients / d.maxPatientsPerDay) * 100),
    }));

  return res.json({ success: true, doctors: filtered, total: filtered.length });
});

// GET /api/doctors/specialties
doctorsRouter.get("/specialties", (_req: Request, res: Response) => {
  const specialties = [...new Set(doctors.filter((d) => d.active).map((d) => d.specialty))].sort();
  return res.json({ success: true, specialties });
});
