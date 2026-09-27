# Security Model — Medikosh Patient Gateway

## Authentication

All patient-facing API routes (`/api/intake`, `/api/appointments`, `/api/records`) require a valid JWT issued by `/api/auth/login/patient`.

### JWT Flow

```
POST /api/auth/login/patient  { email, password }
          ↓
  Verify credentials (MongoDB → demo fallback)
          ↓
  jwt.sign({ sub, role, patientId, name, ... }, JWT_SECRET, { expiresIn })
          ↓
  Return { success, token, patient }
          ↓
  Client stores token in localStorage["medicare_token"]
          ↓
  All subsequent requests: Authorization: Bearer <token>
          ↓
  authenticatePatient middleware verifies + injects req.user
```

### Token Configuration

| Variable | Default | Notes |
|---|---|---|
| `JWT_SECRET` | `medikosh-dev-secret-change-in-production` | **Must be overridden in production** |
| `JWT_EXPIRES_IN` | `12h` | Configurable via env |

**⚠️ Warning:** The default `JWT_SECRET` is public knowledge. Always set a strong random secret in production:
```sh
openssl rand -hex 64
```

### Demo Accounts

Demo accounts (Jane Sharma `PAT-8821`, Rajesh Patel `PAT-5291`, 4 demo doctors) work without MongoDB and are intended for development only. They are hardcoded in `auth.routes.ts` and should be removed or gated behind an env flag before any public deployment.

---

## Authorization

### Patient Data Isolation

Patient identity is **always resolved from the verified JWT payload** (`req.user.patientId`), never from client-supplied request body fields or query parameters.

Enforced in:
- `GET /api/appointments` — fetches only the authenticated patient's appointments
- `POST /api/appointments/quick-book` — books under the authenticated patient's ID
- `POST /api/appointments/revisit` — books under the authenticated patient's ID
- `POST /api/appointments/:id/cancel` — verifies ownership before cancelling; returns 404 (not 403) to avoid leaking appointment existence
- `GET /api/records` — returns only the authenticated patient's records (both MongoDB and in-memory fallback)
- `POST /api/records/upload` — uploads under the authenticated patient's ID
- `POST /api/intake/process` — case is attributed to the authenticated patient's ID

### Role Separation

| Route prefix | Middleware | Allowed roles |
|---|---|---|
| `/api/auth/*` | None (public) | Any |
| `/api/doctors/*` | None (public) | Any |
| `/api/intake/*` | `authenticatePatient` | `patient` only |
| `/api/appointments/*` | `authenticatePatient` | `patient` only |
| `/api/records/*` | `authenticatePatient` | `patient` only |

Doctor-authenticated endpoints (doctor portal) use `authenticateDoctor` middleware which enforces `role === "doctor"`.

---

## File Upload Security

All file uploads go through `validateUpload()` middleware (`src/middleware/uploadValidation.middleware.ts`) **after** multer buffers the file.

### Two-layer protection

1. **Multer hard limit** — rejects any HTTP body exceeding 25 MB at the transport layer before any application code runs.
2. **Magic-byte sniffing** — reads the first bytes of the raw buffer to detect the actual file type, regardless of the `Content-Type` header or file extension the client provides. Extension spoofing (e.g. a ZIP file named `report.pdf`) is caught here.

### Allowed file types

| Type | Magic bytes |
|---|---|
| PDF | `%PDF` |
| JPEG | `\xFF\xD8\xFF` |
| PNG | `\x89PNG` |
| TIFF (LE/BE) | `II*\x00` / `MM\x00*` |
| BMP | `BM` |
| WebP | `RIFF....WEBP` |

Anything else returns `422 Unprocessable Entity`.

---

## CORS

CORS is configured with an explicit origin allowlist rather than a wildcard:

```
http://localhost:3000  (Python dev static server)
http://localhost:5000  (Node gateway — same-origin)
http://localhost:5173  (Vite dev server)
http://localhost:3001  (Doctor portal)
+ any origins in ALLOWED_ORIGINS env var (comma-separated)
```

Both Express CORS and Socket.IO CORS use the same allowlist. Add production domains via the `ALLOWED_ORIGINS` environment variable.

---

## Secret Management

| Secret | Location | Status |
|---|---|---|
| `JWT_SECRET` | `.env` (from `.env.example`) | ✅ Env var, not committed |
| `GEMINI_API_KEY` | `.env` | ✅ Env var, not committed |
| `SARVAM_API_KEY` | `.env` | ✅ Env var, not committed |
| `SUPABASE_URL` / `SUPABASE_KEY` | `.env` | ✅ Env var, not committed |
| `MONGODB_URI` | `.env` | ✅ Env var, not committed |

`.env` is in `.gitignore`. Only `.env.example` (with no real values) is committed.

---

## Security Limitations (Known)

1. **No rate limiting** — `/api/auth/login/*` endpoints have no rate limit. Brute-force attacks are not mitigated. Add `express-rate-limit` before production.
2. **No refresh tokens** — JWTs are long-lived (12h) with no revocation mechanism.
3. **Demo accounts in production** — if deployed without removing demo account logic, any user can authenticate as `jane.sharma@example.com` / `patient123`.
4. **In-memory fallback** — when MongoDB is offline, data is stored in process memory and lost on restart. Not suitable for production.
5. **No HTTPS enforcement** — TLS termination is expected at the reverse proxy layer (not handled in application code).
