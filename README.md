# MediKosh Patient Platform Prototype (`medikosh-merge-prototype-01`)

> **Voice-First Vernacular Clinical Intake, Document OCR, Clinical Reasoning Pipeline, Patient Summary Review & Smart Doctor Allocation Platform**

---

## 🌟 Overview & System Highlights

**MediKosh** is an AI-powered, patient-side clinical onboarding platform built for modern hospitals and digital health kiosks. It bridges patients and hospital OPDs through a voice-first conversational experience across **11 Indian languages**, automated document OCR processing, automated clinical reasoning with **NIH RxNorm drug normalization**, explicit patient summary review, and conflict-free doctor scheduling.

---

## 🧭 The 5-Step Sequential Patient Workflow

```text
  ┌─────────────────────────┐
  │  Step 1: Voice Intake   │  ◄── Multilingual 16kHz PCM WAV Audio (Sarvam STT/TTS)
  └───────────┬─────────────┘      Dynamic follow-up questions (Sarvam Q1 + Gemini Q2)
              │
              ▼
  ┌─────────────────────────┐
  │ Step 2: Document Gate   │  ◄── Drag & drop prescriptions, lab reports, or scans
  └───────────┬─────────────┘      (Automated OCR) OR click "Skip Documents →"
              │
              ▼
  ┌─────────────────────────┐
  │ Step 3: Clinical Engine │  ◄── Gemini 2.5 Flash Clinical Pipeline
  └───────────┬─────────────┘      NIH RxNorm drug validation & conflict resolution
              │
              ▼
  ┌─────────────────────────┐
  │ Step 4: Summary Review  │  ◄── Patient reviews generated Doctor Brief & facts
  └───────────┬─────────────┘      Live editing enabled before doctor allocation!
              │
              ▼
  ┌─────────────────────────┐
  │  Step 5: Doctor Engine  │  ◄── Optimal physician & slot matched
  └─────────────────────────┘      Generates Token #TK-15, Arrival Window & Room!
```

---

## ⚙️ Architecture & Port Mapping

| Service | Technology | Port | Purpose / URLs |
| :--- | :--- | :---: | :--- |
| **Frontend Portal** | HTML5 / Tailwind / JS | **3000** | Main Dashboard: `http://localhost:3000/` |
| **Voice Intake UI** | React 18 / Vite / Lucide | **3000** | React Voice App: `http://localhost:3000/intake/` |
| **Node.js Gateway** | Express / TypeScript | **5000** | API & Orchestration: `http://localhost:5000/health` |
| **Python Services** | FastAPI / Uvicorn | **8000** | OCR, Clinical, Scheduler: `http://localhost:8000/docs` |

---

## 💻 Prerequisites for Any Laptop

Before running this project on any Windows, macOS, or Linux laptop, make sure the following are installed:

1. **Node.js**: Version **18.0.0 or higher** (v20+ recommended) — [Download Node.js](https://nodejs.org/)
2. **Python**: Version **3.10 or higher** — [Download Python](https://www.python.org/)
   * *Windows Notice*: Ensure **"Add Python to PATH"** was checked during installation.
3. **Web Browser**: Chrome, Microsoft Edge, Brave, Safari, or Firefox with microphone permissions enabled.

---

## 🚀 Fast Setup (Turnkey One-Click)

### 🪟 Windows Setup (Fastest)

1. **Open the project folder**: `medikosh-merge-prototype-01\`
2. **Run the automated setup**:
   * Double-click `scripts\setup.bat` (or run in cmd/PowerShell).
   * *This automatically installs all Node dependencies, Python packages, and compiles the React application into `frontend/intake/`.*
3. **Launch all services**:
   * Double-click `scripts\start-all.bat`.
   * *This launches the Python services, Node Gateway, and Frontend HTTP server in persistent console windows, and automatically opens your browser at `http://localhost:3000/`.*

---

### 🍏 macOS / 🐧 Linux Setup

1. Open your terminal and navigate to the project folder:
   ```bash
   cd medikosh-merge-prototype-01
   chmod +x scripts/*.sh
   ```
2. Run the automated setup:
   ```bash
   ./scripts/setup.sh
   ```
3. Launch all services:
   ```bash
   ./scripts/start-all.sh
   ```
4. Open your browser at **`http://localhost:3000/`** (or directly **`http://localhost:3000/intake/`**).

---

## 🛠️ Manual Step-by-Step Setup (If Needed)

If you prefer starting each service manually in separate terminal windows:

### Terminal 1: Python Clinical & OCR Services (Port 8000)
```bash
cd backend/python_services
python -m pip install -r requirements.txt
python -m uvicorn main:app --port 8000
```
*Health Check*: Open `http://localhost:8000/health` (should return `{"status": "healthy"}`)

---

### Terminal 2: Node.js Patient Gateway (Port 5000)
```bash
cd backend/node_gateway
npm install
npm run dev
```
*Health Check*: Open `http://localhost:5000/health` (should return `{"status": "ok"}`)

---

### Terminal 3: Main Frontend Portal (Port 3000)
```bash
cd frontend
python -m http.server 3000
```
*Portal Access*: Open `http://localhost:3000/`

---

### Optional: Live Vite HMR for React Voice App (Port 5174)
If you wish to edit React source code with live hot module reloading:
```bash
cd voice-intake-frontend
npm install
npm run dev
```

---

## 🔑 Environment Variables & Pre-Configured Keys

The project requires the following environment variables in `.env` files:

### `backend/node_gateway/.env`:
```env
PORT=5000
PYTHON_SERVICES_URL=http://localhost:8000
PYTHON_SCHEDULER_URL=http://localhost:8000

# Sarvam AI STT & TTS (Hindi, Hinglish, & 10 Vernacular Languages)
SARVAM_API_KEY=your_sarvam_api_key_here

# Google Gemini Model (Personalized Follow-up Question 2 & Structuring)
GEMINI_API_KEY=your_gemini_api_key_here
GEMINI_MODEL=gemini-2.5-flash

# MongoDB Atlas (Falls back automatically to local in-memory store if offline)
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/dbname?retryWrites=true&w=majority
```

### `backend/python_services/.env`:
```env
GEMINI_API_KEYS=your_gemini_api_key_here
GEMINI_MODEL=gemini-2.5-flash
RXNORM_BASE_URL=https://rxnav.nlm.nih.gov/REST
REQUEST_TIMEOUT_SECONDS=30.0
```

---

## 🧪 Testing the 5-Step Pipeline (Step-by-Step)

1. Navigate to **`http://localhost:3000/`** and click **"Start AI Voice Intake"** (or open **`http://localhost:3000/intake/`**).
2. **Step 1: Voice Consultation**:
   * Select your preferred language (e.g. Hindi, English, Tamil, Telugu, etc.).
   * Click **"Click to Speak (Push-to-Talk)"**, allow microphone access, and speak your symptoms (e.g., *"Mujhe 3 din se ghutne mein dard hai"*).
   * Or use the text box at the bottom to type.
   * Listen to the AI assistant speak back using Sarvam Bulbul TTS.
   * Answer the follow-up clinical question and proceed.
3. **Step 2: Document Verification Gate**:
   * Drag & drop any test prescription or lab report (`.pdf`, `.jpg`, `.png`).
   * Or simply click **"Skip Documents &rarr;"**.
4. **Step 3: Clinical Structuring Execution**:
   * Watch the live animated stepper as Gemini analyzes the case and cross-references NIH RxNorm.
5. **Step 4: Review Clinical Summary**:
   * Review the extracted **Chief Concern**, **Triage Urgency**, **Symptoms**, and **Medications**.
   * Click **"Edit Summary"** to make any custom adjustments to the doctor brief.
   * Click **"Confirm Summary & Allocate Doctor &rarr;"**.
6. **Step 5: Doctor Engine Consultation Ticket**:
   * View your confirmed ticket:
     * **Daily Token Number**: e.g., `#TK-13`
     * **Arrival Window**: e.g., `09:00 AM – 09:20 AM`
     * **Physician**: `Dr. Sneha Kapoor (Orthopedics)`
     * **Room**: `OPD Room 204`
     * **Desk Check-in OTP**: `4690`
   * Click **"Return to Patient Portal"** to view your active appointment on the main dashboard.

---

## 🔍 Automated Diagnostic Test Script

To verify that all services and APIs are working properly:
```bash
node -e "
Promise.all([
  fetch('http://localhost:3000/intake/').then(r => 'Frontend: ' + r.status),
  fetch('http://localhost:5000/health').then(r => r.json()).then(d => 'Gateway: ' + d.status),
  fetch('http://localhost:8000/health').then(r => r.json()).then(d => 'Python: ' + d.status)
]).then(res => console.log('STATUS:\n', res.join('\n'))).catch(console.error);
"
```

Expected Output:
```
STATUS:
 Frontend: 200
 Gateway: ok
 Python: healthy
```

---

## ❓ Troubleshooting FAQ

* **Issue: Browser shows "Microphone access was denied"**:
  * *Fix*: Click the camera/lock icon in your browser URL address bar and change **Microphone** to **Allow**.
* **Issue: Port in use (e.g., Port 3000, 5000, or 8000)**:
  * *Fix*: On Windows, run PowerShell command: `Stop-Process -Id (Get-NetTCPConnection -LocalPort 5000 -ErrorAction SilentlyContinue).OwningProcess -Force`.
* **Issue: "bad auth : authentication failed" in MongoDB logs**:
  * *Fix*: The system has a built-in resilient **Dual-Mode Persistence Store**. If MongoDB credentials expire or network fails, it falls back seamlessly to an in-memory & file-backed store without crashing.

---

## 📄 License & Provenance
Developed for digital health systems, ABDM compliant workflows, and vernacular clinical triage.
