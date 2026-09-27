/**
 * Authentication middleware for Medikosh Patient Gateway
 *
 * `authenticate`       — requires a valid Bearer JWT; injects req.user
 * `authenticatePatient` — same, but also requires role === "patient"
 * `authenticateDoctor`  — same, but also requires role === "doctor"
 * `optionalAuth`       — decodes token if present, never rejects
 */

import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "medikosh-dev-secret-change-in-production";

export interface AuthUser {
  sub: string;
  role: "patient" | "doctor";
  name: string;
  email?: string;
  patientId?: string;
  doctorId?: string;
  hospitalId?: string;
  specialty?: string;
  demo?: boolean;
}

// Extend Express request type
declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

function extractToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) return header.slice(7);
  return null;
}

export function authenticate(req: Request, res: Response, next: NextFunction): void {
  const token = extractToken(req);
  if (!token) {
    res.status(401).json({ success: false, message: "Authentication required" });
    return;
  }
  try {
    req.user = jwt.verify(token, JWT_SECRET) as AuthUser;
    next();
  } catch {
    res.status(401).json({ success: false, message: "Token invalid or expired" });
  }
}

export function authenticatePatient(req: Request, res: Response, next: NextFunction): void {
  authenticate(req, res, () => {
    if (req.user?.role !== "patient") {
      res.status(403).json({ success: false, message: "Patient access required" });
      return;
    }
    next();
  });
}

export function authenticateDoctor(req: Request, res: Response, next: NextFunction): void {
  authenticate(req, res, () => {
    if (req.user?.role !== "doctor") {
      res.status(403).json({ success: false, message: "Doctor access required" });
      return;
    }
    next();
  });
}

/** Decodes the token when present; never blocks the request. */
export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  const token = extractToken(req);
  if (token) {
    try {
      req.user = jwt.verify(token, JWT_SECRET) as AuthUser;
    } catch {
      // Invalid token — just skip
    }
  }
  next();
}
