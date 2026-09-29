@echo off
rem PQC Scanner: one-command local demo (Windows).
rem Installs backend requirements, builds the frontend if needed, and serves everything
rem (React app + API) from a single FastAPI/Uvicorn process.
rem
rem   run_demo.bat                 http://localhost:8000
rem   set PORT=8080 ^& run_demo.bat  another port
rem   set REBUILD=1 ^& run_demo.bat  force a fresh frontend build
setlocal EnableExtensions

set "ROOT=%~dp0"
set "BACKEND=%ROOT%backend"
set "FRONTEND=%ROOT%frontend"
if "%PORT%"=="" set "PORT=8000"
set "URL=http://localhost:%PORT%"

rem -- Prerequisites ----------------------------------------------------------
where py >nul 2>nul && (set "PYTHON=py -3") || (set "PYTHON=python")
%PYTHON% -c "import sys; sys.exit(sys.version_info < (3, 10))" 2>nul
if errorlevel 1 (
  echo error: Python 3.10+ is required. Install it from https://www.python.org/downloads/
  exit /b 1
)

rem -- Backend ----------------------------------------------------------------
if not exist "%BACKEND%\.venv\Scripts\python.exe" (
  echo ==^> Creating Python virtual environment
  %PYTHON% -m venv "%BACKEND%\.venv" || exit /b 1
)
set "VPY=%BACKEND%\.venv\Scripts\python.exe"
echo ==^> Installing backend requirements
"%VPY%" -m pip install --quiet --disable-pip-version-check -r "%BACKEND%\requirements.txt" || exit /b 1

rem -- Frontend ---------------------------------------------------------------
set "NEEDS_BUILD=0"
if "%REBUILD%"=="1" set "NEEDS_BUILD=1"
if not exist "%FRONTEND%\dist\index.html" set "NEEDS_BUILD=1"

if "%NEEDS_BUILD%"=="1" (
  where npm >nul 2>nul || (
    echo error: Node.js 20+ and npm are required to build the frontend. Install from https://nodejs.org/
    exit /b 1
  )
  if not exist "%FRONTEND%\node_modules" (
    echo ==^> Installing frontend dependencies
    pushd "%FRONTEND%" && call npm ci --no-audit --no-fund --loglevel=error & popd
  )
  echo ==^> Building frontend
  pushd "%FRONTEND%"
  call npm run build --silent
  if errorlevel 1 ( popd & echo error: Frontend build failed. & exit /b 1 )
  popd
) else (
  echo ==^> Frontend already built ^(set REBUILD=1 to rebuild^)
)

rem -- Port check -------------------------------------------------------------
"%VPY%" -c "import socket; s=socket.socket(); s.bind(('127.0.0.1', %PORT%))" 2>nul
if errorlevel 1 (
  echo error: Port %PORT% is already in use. Stop the other process or run: set PORT=8080 ^& run_demo.bat
  exit /b 1
)

rem -- Start ------------------------------------------------------------------
echo ==^> Starting server on %URL% ^(Ctrl+C to stop^)

rem Announce once the API answers; the server itself runs in the foreground.
start "" /b powershell -NoProfile -Command "for ($i=0; $i -lt 120; $i++) { try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 1 '%URL%/api/health' | Out-Null; Write-Host ''; Write-Host '  SYSTEM LIVE: Open %URL% in your browser' -ForegroundColor Green; Write-Host ''; exit 0 } catch { Start-Sleep -Milliseconds 250 } }; Write-Host 'Server did not respond within 30 s.' -ForegroundColor Red"

cd /d "%BACKEND%"
"%VPY%" -m uvicorn app.main:app --host 127.0.0.1 --port %PORT% --log-level warning
