#!/usr/bin/env bash
# =========================================================================
#       MediKosh Patient Platform - Automated Setup (Linux / macOS)
# =========================================================================
set -e

BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "========================================================================="
echo "      MediKosh Patient Platform - Automated Dependencies Setup"
echo "========================================================================="

echo "[1/4] Installing Node Gateway dependencies..."
cd "$BASE_DIR/backend/node_gateway"
npm install

echo "[2/4] Installing Python Unified Services dependencies..."
cd "$BASE_DIR/backend/python_services"
python3 -m pip install -r requirements.txt

echo "[3/4] Building React Voice Intake Frontend..."
cd "$BASE_DIR/voice-intake-frontend"
npm install
npm run build

echo "[4/4] Syncing compiled React app to frontend/intake/..."
mkdir -p "$BASE_DIR/frontend/intake"
cp -r "$BASE_DIR/voice-intake-frontend/dist/"* "$BASE_DIR/frontend/intake/"

echo "========================================================================="
echo "Setup completed successfully! Run ./scripts/start-all.sh to start."
echo "========================================================================="
