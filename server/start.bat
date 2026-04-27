@echo off
REM ============================================================
REM SmartFarm DakLak - Windows Server Startup Script
REM ============================================================
REM Prerequisites:
REM   1. Docker Desktop installed and running (WSL2 backend)
REM   2. Ports available: 8080, 1880, 3000, 8086, 1700/udp, 1883
REM ============================================================

echo.
echo ========================================
echo   SmartFarm DakLak - Server Launcher
echo ========================================
echo.

REM Check Docker
docker --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Docker not found! Install Docker Desktop first.
    echo Download: https://www.docker.com/products/docker-desktop/
    pause
    exit /b 1
)

REM Check Docker Compose
docker compose version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Docker Compose not found!
    echo Update Docker Desktop to latest version.
    pause
    exit /b 1
)

echo [OK] Docker detected
echo.

REM Start all services
echo Starting services...
docker compose up -d

if %errorlevel% neq 0 (
    echo [ERROR] Failed to start services!
    pause
    exit /b 1
)

echo.
echo ========================================
echo   All services started!
echo ========================================
echo.
echo   ChirpStack  : http://localhost:8080  (admin/admin)
echo   Node-RED    : http://localhost:1880
echo   Grafana     : http://localhost:3000  (admin/admin)
echo   InfluxDB    : http://localhost:8086  (admin/admin12345)
echo   MQTT        : localhost:1883
echo.
echo   Gateway UDP : localhost:1700 (configure your E870 to this IP)
echo.
echo ========================================
echo   Press any key to open ChirpStack...
echo ========================================
pause >nul
start http://localhost:8080
