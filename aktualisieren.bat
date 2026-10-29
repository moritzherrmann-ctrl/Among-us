@echo off
chcp 65001 >nul
title Among Us Real Life - Aktualisieren
cd /d "%~dp0"
echo Hole die neueste Version von GitHub ...
git pull || goto fehler
echo.
echo Installiere Bausteine ...
call npm install || goto fehler
echo.
echo Fertig! Starte das Spiel jetzt mit starten.bat.
goto ende
:fehler
echo.
echo Das hat nicht geklappt. Ist Git installiert und bist du im Spiel-Ordner?
:ende
pause
