@echo off
chcp 65001 >nul
echo Subindo o Blink (a primeira vez demora uns minutos)...
docker compose up -d --build
if errorlevel 1 (
  echo.
  echo Deu erro. O Docker Desktop esta aberto?
  pause
  exit /b 1
)
echo.
echo Esperando o link do tunel...
:espera
timeout /t 3 /nobreak >nul
docker compose logs app 2>nul | findstr /C:"Link pra mandar" >nul || goto espera
docker compose logs app 2>nul | findstr /C:"Link pra mandar"
echo.
echo Deixe o PC ligado enquanto voces usam. Pra desligar: parar.bat
pause
