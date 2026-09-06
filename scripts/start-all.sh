#!/usr/bin/env bash
# =========================================================================
#       MediKosh Patient Platform - Service Launcher (Linux / macOS)
# =========================================================================
BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "========================================================================="
echo "                MediKosh Patient Platform Launcher"
echo "========================================================================="

# 1. Start Python Services on port 8000
echo "[1/3] Starting Python Services (FastAPI on http://localhost:8000)..."
cd "$BASE_DIR/backend/python_services"
python3 -m uvicorn main:app --port 8000 &
PID_PY=$!

sleep 2

# 2. Start Node Gateway on port 5000
echo "[2/3] Starting Node Gateway (Express on http://localhost:5000)..."
cd "$BASE_DIR/backend/node_gateway"
npm run dev &
PID_NODE=$!

sleep 2

# 3. Start Frontend on port 3000
echo "[3/3] Starting Frontend Server (Port 3000)..."
cd "$BASE_DIR/frontend"
python3 -m http.server 3000 &
PID_FE=$!

sleep 2

echo ""
echo "========================================================================="
echo "All services launched!"
echo "- Patient Portal UI:       http://localhost:3000/"
echo "- Voice Intake System:     http://localhost:3000/intake/"
echo "- Node Gateway API:        http://localhost:5000/health"
echo "- Python Clinical Engines: http://localhost:8000/health"
echo "========================================================================="
echo "Press Ctrl+C to terminate all services."

trap "kill $PID_PY $PID_NODE $PID_FE 2>/dev/null; exit 0" SIGINT SIGTERM
wait
