@echo off
REM Lanza el backend FastAPI + sirve la UI en http://127.0.0.1:8000
REM Asegurate de tener LM Studio escuchando en http://localhost:1234

cd /d "%~dp0"
echo.
echo === Agentic RAG F1 2026 ===
echo Backend en http://127.0.0.1:8000
echo UI       en http://127.0.0.1:8000/
echo.

python -m uvicorn src.api:app --host 127.0.0.1 --port 8000 --reload
pause
