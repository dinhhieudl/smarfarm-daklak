@echo off
REM Reset all data (DANGER: deletes all data!)
echo.
echo WARNING: This will delete ALL data (database, configs, etc.)
echo.
set /p confirm="Type YES to confirm: "
if not "%confirm%"=="YES" (
    echo Cancelled.
    pause
    exit /b
)
echo Stopping and removing volumes...
docker compose down -v
echo Done. All data cleared.
pause
