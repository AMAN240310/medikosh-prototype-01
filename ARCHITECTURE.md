# Architecture — Medikosh Prototype 01

## System Overview

```
Browser / Voice Kiosk
        │
        ▼
┌─────────────────────┐
│  Frontend (Port 3000) │  Static HTML/JS (Python http.server in dev)
│  login.html           │  portal.html, doctor.html, intake/index.html
│  js/api.js            │  Handles auth token storage + API routing
└────────┬────────────┘
         │  HTTP (REST + multipart)
         ▼
┌──────────────────────────┐
│  Node Gateway (Port 5000) │  Express + Socket.IO  (TypeScript / tsx)
│  src/server.ts            │
│  src/routes/              │
│  src/middleware/          │
│  src/allocation/          │
│  src/db/                  │
│  src/voice/               │
│  src/voice-engine/        │
└────────┬─────────────────┘
         │  HTTP (axios)
         ▼
┌──────────────────────────┐
│  Python Services (Port 8000) │  FastAPI + uvicorn
│  extraction/               │  OCR pipeline (PyMuPDF, pytesseract, OpenCV)
│  clinical_engine/          │  Gemini structuring + RxNorm validation
│  scheduler/                │  Appointment scheduling logic
└────────┬───────────────────┘
         │
    ┌────┴─────────────────┐
    │                      │
    ▼                      ▼
Supabase (PostgreSQL)   MongoDB
Appointments table      PatientCase, MedicalRecord,
Supabase Storage        Patient, Doctor, Appointment
(file uploads)          (in-memory fallback when offline)
         │
         ▼
External APIs:
  Google Gemini (AI clinical structuring + doctor allocation)
  Sarvam AI     (Hindi/Hinglish STT + TTS for voice intake)
  NIH RxNorm    (medicine name validation)
```

---

## Node Gateway — Module Map

```
src/
├── server.ts               Entry point: CORS, routes, Socket.IO, static serve
├── routes/
│   ├── auth.routes.ts      POST /api/auth/login/patient|doctor, GET /me
│   ├── intake.routes.ts    POST /api/intake/process|structure
│   ├── appointments.routes.ts  GET|POST /api/appointments/*
│   ├── records.routes.ts   GET|POST /api/records/*
│   └── doctors.routes.ts   GET /api/doctors (public)
├── middleware/
│   ├── auth.middleware.ts  JWT verification, req.user injection
│   └── uploadValidation.middleware.ts  Magic-byte file type + size check
├── allocation/
│   ├── allocationEngine.ts         Full doctor allocation pipeline
│   ├── data/doctors.ts             Static doctor roster
│   └── services/
│       ├── geminiService.ts        Gemini patient analysis
│       ├── eligibilityService.ts   Filter + tier matching
│       ├── rankingService.ts       Score + rank doctors
│       └── schedulingClient.ts     Slot request to Python scheduler
├── db/
│   ├── mongo.ts            Mongoose schemas + in-memory fallback
│   └── supabase.ts         Supabase client + in-memory fallback
├── voice/                  Real-time Socket.IO voice session handler
│   ├── clinical/           Emergency rules, symptom extractor, question engine
│   └── voice/              Sarvam STT + TTS wrappers
└── voice-engine/           Alternative case-taking engine (REST-based)
    ├── routes/caseTakingRoutes.ts
    └── services/           Gemini question gen, conversation engine, clinical pipeline
```

---

## Python Services — Module Map

```
backend/python_services/
├── main.py                 FastAPI app: mounts extraction + clinical + scheduler routers
├── extraction/
│   ├── orchestrator.py     Batch file processing entry point
│   ├── extraction.py       Gemini-based text extraction from document images
│   ├── preprocessing.py    OpenCV image enhancement (deskew, denoise)
│   ├── confidence.py       Extraction confidence scoring
│   └── models.py           Pydantic schemas for extraction results
├── clinical_engine/app/
│   ├── pipeline.py         ClinicalPipeline.run() — stages 1-4
│   ├── routes.py           POST /pipeline/run
│   ├── models/schemas.py   All Pydantic models for the pipeline
│   ├── prompts/            Gemini prompt templates
│   └── services/
│       ├── gemini_client.py        Gemini API wrapper with key rotation
│       ├── rxnorm_service.py       NIH RxNorm API medicine validation
│       ├── validation_service.py   Stage 3: deterministic SAFE_FACTS builder
│       ├── prioritization_service.py  Stage 3.5: fact tiering (no LLM)
│       └── field_taxonomy.py       Single/multi-value field definitions
└── scheduler/
    ├── scheduler.py        Slot availability + booking logic
    └── models.py           Appointment slot schemas
```

---

## Clinical Processing Pipeline

```
Patient Input (voice transcript + uploaded documents)
        │
        ▼
Stage 0: OCR Extraction (Python)
  PyMuPDF for PDFs, pytesseract + OpenCV for images
  → raw extracted text per file
        │
        ▼
Stage 1: Gemini Structuring (Python)
  Combined text → StructuredExtraction:
    patient_reported { symptoms, medical_history, current_medications }
    document_extracted { findings, medical_history, medications }
    facts [ { field, value, source_type: VOICE|DOCUMENT, evidence } ]
    medicines_to_validate [ { raw_name, dosage, evidence } ]
    uncertain_information [ strings ]
        │
        ▼
Stage 2: RxNorm Medicine Validation (Python → NIH API)
  Each medicine → RxNormResult { exists_in_rxnorm, validated_name, status }
  Unrecognised names → UNVERIFIED (never auto-corrected)
        │
        ▼
Stage 3: Deterministic SAFE_FACTS (Python — no LLM)
  Conflict detection:
    SINGLE-value fields (age, sex, blood_type): any two different values = conflict
    MULTI-value fields: only flag negation + affirmation of same topic
  Output → SafeValidatedData:
    safe_facts          — passed conflicts, non-empty, source-tagged
    validated_medicines — RxNorm VALID only
    excluded_information — everything dropped, with reason
    conflicts           — each conflict with both values + sources preserved
        │
        ▼
Stage 3.5: Deterministic Prioritization (Python — no LLM)
  Tiers: HIGH (emergency + chief complaint) | MEDIUM | LOW
  Never invents; only re-orders already-safe facts
        │
        ▼
Stage 4: Gemini Clinical Summary (Python)
  Receives ONLY high+medium priority safe facts + validated medicines
  Low-priority facts and excluded_information are deliberately NOT sent to the LLM
  → clinical_summary (natural language, for doctor review)
        │
        ▼
Node Gateway: Doctor Allocation
  Gemini analyses clinical_summary → PatientAnalysis { urgency, requiredSpecialty }
  Eligibility filter → specialty matching → ranking → slot scheduling
        │
        ▼
Appointment booked (Supabase + MongoDB)
Doctor portal displays:
  - clinical_summary (AI-generated, for doctor review only)
  - safe_facts (source-tagged: VOICE vs DOCUMENT)
  - conflicts (presented to doctor for resolution)
  - excluded_information (transparent audit trail)
```

### Clinical Data Safety Principle

The pipeline enforces a hard distinction between information types:

| Label | Meaning |
|---|---|
| `source_type: VOICE` | Patient self-reported during voice intake |
| `source_type: DOCUMENT` | Extracted from an uploaded medical document |
| `safe_facts` | Passed conflict detection — still unverified by a doctor |
| `excluded_information` | Dropped with reason — presented for transparency |
| `conflicts` | Contradictions — sent to doctor for resolution, never auto-resolved |
| `validated_medicines` | Confirmed in NIH RxNorm — dosage/frequency still unverified |

Nothing in the pipeline produces `DOCTOR_VERIFIED` status — that step happens in the consultation and is outside this prototype's scope.

---

## Request Flow: Patient Login → Book Appointment

```
1. Browser: POST http://localhost:5000/api/auth/login/patient
   { email, password }

2. auth.routes.ts: verify credentials (MongoDB → demo fallback)
   → jwt.sign({ sub, role:"patient", patientId, name })
   → return { token }

3. Browser: stores token in localStorage["medicare_token"]

4. Browser: POST /api/appointments/quick-book
   Authorization: Bearer <token>
   { appointmentDate, timeSlot, specialty }

5. auth.middleware.ts: jwt.verify(token) → req.user = { patientId, name, role }

6. appointments.routes.ts:
   - validates date (YYYY-MM-DD, not past)
   - validates timeSlot (HH:MM AM/PM)
   - patientId = req.user.patientId  ← always from JWT
   - calculates end_time with meridian rollover
   - saves to Supabase (+ in-memory fallback)
   → return 201 { appointment }
```

---

## Environment Variables

```sh
# backend/node_gateway/.env
PORT=5000
PYTHON_SERVICES_URL=http://localhost:8000
JWT_SECRET=<long-random-secret>
JWT_EXPIRES_IN=12h
ALLOWED_ORIGINS=                    # extra production origins (comma-separated)
GEMINI_API_KEY=<key>
SARVAM_API_KEY=<key>
MONGODB_URI=mongodb://localhost:27017/medicare
SUPABASE_URL=<url>
SUPABASE_KEY=<anon-key>

# backend/python_services/.env
GEMINI_API_KEYS=<key1,key2,...>     # comma-separated for round-robin rotation
GEMINI_MODEL=gemini-2.5-flash
RXNORM_BASE_URL=https://rxnav.nlm.nih.gov/REST
```
