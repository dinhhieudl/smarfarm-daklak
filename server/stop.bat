@echo off
REM Stop all SmartFarm services
echo Stopping SmartFarm DakLak services...
docker compose down
echo Done.
pause
