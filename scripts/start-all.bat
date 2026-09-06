@echo off
title MediCare Patient Platform Launcher
echo =========================================================================
echo                 MediCare Patient Platform Launcher
echo =========================================================================
echo.

set BASE_DIR=%~dp0..

echo [1/3] Starting Unified Python Services (FastAPI on http://localhost:8000)...
start "MediCare Python Services (OCR + Clinical + Scheduler)" cmd /k "cd /d %BASE_DIR%\backend\python_services && python -m uvicorn main:app --port 8000"

ping 127.0.0.1 -n 2 >nul

echo [2/3] Starting Node.js Patient Gateway (Express on http://localhost:5000)...
start "MediCare Node Gateway (Voice + Appointments + MongoDB + Supabase)" cmd /k "cd /d %BASE_DIR%\backend\node_gateway && npm run dev"

ping 127.0.0.1 -n 2 >nul

echo [3/3] Starting Frontend Server (Port 3000)...
start "MediCare Frontend Server (Port 3000)" cmd /k "cd /d %BASE_DIR%\frontend && python -m http.server 3000"

ping 127.0.0.1 -n 2 >nul

echo Opening MediCare Voice Intake in Browser...
start "" "http://localhost:3000/intake/"

echo.
echo =========================================================================
echo All services launched in persistent windows!
echo - Python Services:  http://localhost:8000 (Docs: /docs)
echo - Node Gateway:     http://localhost:5000 (Health: /health)
echo - Frontend Portal:  http://localhost:3000 (React Voice Intake: /intake/)
echo =========================================================================
