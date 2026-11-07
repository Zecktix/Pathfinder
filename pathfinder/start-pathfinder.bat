@echo off
title Pathfinder
cd /d "%~dp0"
where node >nul 2>&1 || (echo Node.js is not installed. Get it from https://nodejs.org & pause & exit /b)
curl -s http://127.0.0.1:11434 >nul 2>&1 || (where ollama >nul 2>&1 && (echo Starting Ollama... & start "Ollama" /min ollama serve & timeout /t 4 >nul))
node pathfinder.js
pause
