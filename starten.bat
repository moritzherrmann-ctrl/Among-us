@echo off
chcp 65001 >nul
title Among Us Real Life - Server
cd /d "%~dp0"
if not exist node_modules (
  echo Erster Start: installiere Bausteine ...
  call npm install || goto fehler
)
echo.
echo Fenster offen lassen, solange ihr spielt. Beenden mit Strg+C.
echo.
call npm start
goto ende
:fehler
echo.
echo Installation fehlgeschlagen. Ist Node.js installiert?
:ende
pause
