# Testing Guide — Medikosh Patient Gateway

## Prerequisites

```sh
# Node gateway (requires the server running on port 5000)
node >= 18
npm install   # in backend/node_gateway

# Python services
python >= 3.11
pip install pytest   # in backend/python_services
```

---

## Running Tests

### Start the server first

All Node integration tests run against the **live server** on port 5000.

```sh
cd backend/node_gateway
npm run dev
```

### Node.js — All test suites

```sh
cd backend/node_gateway
npm run test:all
```

Or individually:

```sh
npm run test               # Auth tests (16 tests)
npm run test:appointments  # Authorization + booking validation tests (18 tests)
npm run test:upload        # File upload validation tests (11 tests)
```

### Python — Validation service unit tests

These run **without any server** (pure unit tests, no network calls):

```sh
cd backend/python_services
pytest tests/test_validation_service.py -v
```

---

## Test Categories

### Auth tests (`tests/auth.test.ts`) — 16 tests

| Test | What it verifies |
|---|---|
| Patient login — valid credentials | Returns JWT with correct patientId and role |
| Patient login — wrong password | Returns 401 |
| Patient login — unknown email | Returns 401 |
| Patient login — missing fields | Returns 400 |
| Doctor login — valid credentials | Returns JWT with role=doctor and specialty |
| Doctor login — wrong password | Returns 401 |
| Doctor login — missing doctorId | Returns 400 |
| `GET /api/auth/me` — valid token | Returns decoded user payload |
| `GET /api/auth/me` — no token | Returns 401 |
| `GET /api/auth/me` — invalid token | Returns 401 |
| `GET /api/appointments` — no token | Protected route blocks unauthenticated |
| `GET /api/records` — no token | Protected route blocks unauthenticated |
| `GET /api/appointments` — valid token | Returns appointments array |
| `GET /api/doctors` — public | Returns doctor list without auth |
| `GET /api/doctors?specialty=Cardiology` | Filters by specialty |
| `GET /api/doctors/specialties` | Returns specialty list |

### Appointment + authorization tests (`tests/appointments.test.ts`) — 18 tests

| Test | What it verifies |
|---|---|
| Unauthenticated GET /appointments | 401 |
| Unauthenticated POST /quick-book | 401 |
| **Patient A cannot see Patient B's appointments** | Data isolation — Rajesh cannot see Jane's booking |
| **Patient cannot cancel another patient's appointment** | Ownership check — returns 404, not 403 |
| Missing appointmentDate | 400 |
| Missing timeSlot | 400 |
| Invalid date format (DD-MM-YYYY) | 400 |
| Nonsense date string | 400 |
| **Past date rejected** | 400 with "past" in error message |
| Invalid timeSlot (no AM/PM) | 400 |
| 24-hour time format | 400 |
| Valid booking | 201 with appointment object; patientId from JWT |
| `09:00 AM` + 15 min | end_time = `09:15 AM` |
| `09:50 AM` + 15 min | end_time = `10:05 AM` |
| **`11:50 AM` + 15 min** | end_time = `12:05 PM` ← AM→PM noon rollover |
| **`11:50 PM` + 15 min** | end_time = `12:05 AM` ← PM→AM midnight rollover |
| Rajesh cannot see Jane's records | Records scoped to authenticated patient |
| Jane sees her own records | All records belong to PAT-8821 |

### Upload validation tests (`tests/upload.test.ts`) — 11 tests

| Test | What it verifies |
|---|---|
| No token | 401 before file validation |
| No file attached | 400 |
| Valid PDF | 201 accepted |
| Valid JPEG | 201 accepted |
| Valid PNG | 201 accepted |
| ZIP file | 422 rejected |
| EXE file | 422 rejected |
| SVG/XML text | 422 rejected |
| Plain text | 422 rejected |
| **PDF extension + ZIP magic bytes** | 422 — extension spoofing caught by magic-byte check |
| Small valid file (size boundary) | 201 — confirms size path works |

### Python validation service tests (`tests/test_validation_service.py`) — 25 tests

Pure unit tests for the clinical `build_safe_facts()` function:

- Empty input, valid facts, empty/null values
- Single-value field conflicts (age, blood_type, sex)
- Multi-value negation conflicts (medical_history)
- Cross-field non-conflicts
- Medicine validation (valid, invalid, suggestion not auto-applied)
- Uncertain information passthrough
- Source type and evidence preservation
- Conflict record structure

---

## Important Security Tests

The following tests are security-critical regression tests — **never delete them**:

| File | Test name | Bug it prevents |
|---|---|---|
| `appointments.test.ts` | Patient A cannot see Patient B's appointments | Data leak via shared in-memory fallback |
| `appointments.test.ts` | Patient cannot cancel another patient's appointment | IDOR — cancel any appointment by ID |
| `appointments.test.ts` | Past date rejected | Booking in the past |
| `appointments.test.ts` | `11:50 AM` → `12:05 PM` | AM→PM rollover bug in end_time calculation |
| `appointments.test.ts` | `11:50 PM` → `12:05 AM` | PM→AM midnight rollover bug |
| `upload.test.ts` | PDF extension + ZIP magic bytes | Extension-spoofing file upload bypass |
| `upload.test.ts` | Unauthenticated upload returns 401 | Auth check precedes file processing |

---

## Regression Testing

After any change to the following files, run the full suite:

| Changed file | Run |
|---|---|
| `src/routes/appointments.routes.ts` | `npm run test:appointments` |
| `src/routes/records.routes.ts` | `npm run test:appointments` (records isolation) |
| `src/routes/auth.routes.ts` | `npm run test` |
| `src/middleware/auth.middleware.ts` | `npm run test:all` |
| `src/middleware/uploadValidation.middleware.ts` | `npm run test:upload` |
| `src/db/supabase.ts` | `npm run test:appointments` |
| Python `validation_service.py` | `pytest tests/test_validation_service.py -v` |
