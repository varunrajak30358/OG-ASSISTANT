@echo off
title OG Assistant - Docker Setup
color 0B

echo.
echo    ██████╗  ██████╗
echo   ██╔═══██╗██╔════╝
echo   ██║   ██║██║  ███╗
echo   ██║   ██║██║   ██║
echo   ╚██████╔╝╚██████╔╝
echo    ╚═════╝  ╚═════╝
echo   A S S I S T A N T
echo.
echo   ─────────────────────────────────────
echo   Docker Setup  ^|  Made by VR
echo   ─────────────────────────────────────
echo.

REM Check if .env exists
if not exist ".env" (
    echo   [!] .env file not found.
    echo.
    set /p APIKEY="   Enter your Gemini API key: "
    echo GOOGLE_API_KEY=%APIKEY%> .env
    echo OG_VOICE=Aoede>> .env
    echo.
    echo   [OK] .env created
    echo.
)

REM Check if Docker is running
docker info >nul 2>&1
if errorlevel 1 (
    echo   [!] Docker is not running.
    echo   Please start Docker Desktop and run this file again.
    echo.
    pause
    exit /b 1
)

echo   [1/3] Pulling/Building OG Assistant...
echo.
docker compose up --build -d

if errorlevel 1 (
    echo.
    echo   [!] Docker build failed. Check errors above.
    pause
    exit /b 1
)

echo.
echo   ─────────────────────────────────────
echo   [OK] OG Assistant is running!
echo.
echo   Open browser: http://localhost:6753
echo   ─────────────────────────────────────
echo.

REM Auto open browser
start http://localhost:6753

echo   To stop:  docker compose down
echo   To logs:  docker compose logs -f
echo.
pause
