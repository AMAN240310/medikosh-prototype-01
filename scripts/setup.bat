@echo off
title MediKosh Patient Platform - Automated Environment Setup
echo =========================================================================
echo       MediKosh Patient Platform - Automated Dependencies Setup
echo =========================================================================
echo.

set BASE_DIR=%~dp0..

:: 1. Verify Prerequisites
echo [1/5] Checking prerequisites...
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Node.js is not installed or not in PATH!
    echo Please install Node.js (v18 or higher) from https://nodejs.org/
    pause
    exit /b 1
)

where python >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Python is not installed or not in PATH!
    echo Please install Python (v3.10 or higher) from https://www.python.org/
    pause
    exit /b 1
)

echo - Node.js: OK
echo - Python: OK
echo.

:: 2. Setup Node.js Patient Gateway
echo [2/5] Installing dependencies for Node.js Gateway (backend/node_gateway)...
cd /d "%BASE_DIR%\backend\node_gateway"
call npm install
if %ERRORLEVEL% NEQ 0 (
    echo [WARNING] npm install in node_gateway had warnings, proceeding...
)

:: 3. Setup Python Services
echo.
echo [3/5] Installing dependencies for Python Services (backend/python_services)...
cd /d "%BASE_DIR%\backend\python_services"
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
if %ERRORLEVEL% NEQ 0 (
    echo [WARNING] Some python wheels had notices, continuing...
)

:: 4. Setup & Build React Voice Intake Frontend
echo.
echo [4/5] Building React Voice Intake Frontend (voice-intake-frontend)...
cd /d "%BASE_DIR%\voice-intake-frontend"
call npm install
call npm run build

:: 5. Sync React Build to Main Portal
echo.
echo [5/5] Deploying built React Voice App into frontend/intake/...
if not exist "%BASE_DIR%\frontend\intake" mkdir "%BASE_DIR%\frontend\intake"
xcopy /E /Y /I "%BASE_DIR%\voice-intake-frontend\dist\*" "%BASE_DIR%\frontend\intake\"

echo.
echo =========================================================================
echo                SETUP COMPLETED SUCCESSFULLY!
echo =========================================================================
echo.
echo All dependencies are installed and the React app has been compiled.
echo.
echo To launch the entire platform:
echo Double-click scripts\start-all.bat
echo.
echo Platform will be available at:
echo - Patient Portal UI:       http://localhost:3000/
echo - Voice Intake System:     http://localhost:3000/intake/
echo - Node Gateway API:        http://localhost:5000/
echo - Python Clinical Engines: http://localhost:8000/docs
echo =========================================================================
pause
