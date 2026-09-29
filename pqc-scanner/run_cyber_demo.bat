@echo off
rem PQC Scanner, Stark-HUD variant: same API and five-stage logic, "Jarvis diagnostics" UI.
rem Runs alongside the standard demo (which uses :8000).
rem
rem   run_cyber_demo.bat                 http://localhost:8002
rem   set PORT=8090 ^& run_cyber_demo.bat  another port
setlocal
set "UI=hud"
if "%PORT%"=="" set "PORT=8002"
set "BANNER=STARK-HUD SCANNER ONLINE"
call "%~dp0run_demo.bat"
