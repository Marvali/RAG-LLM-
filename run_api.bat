@echo off
REM Lanza el backend FastAPI + sirve la UI en http://127.0.0.1:8000
REM Para usar Groq Cloud, define GROQ_API_KEY antes de ejecutar:
REM   set GROQ_API_KEY=gsk_tu_clave_aqui

cd /d "%~dp0"

REM Carga .env si existe (GROQ_API_KEY=...)
if exist ".env" (
  for /f "usebackq tokens=1,* delims==" %%A in (".env") do (
    if not "%%A"=="" if not "%%A:~0,1%"=="#" set %%A=%%B
  )
)

echo.
echo === Agentic RAG F1 2026 ===
echo Backend en http://127.0.0.1:8000
echo UI       en http://127.0.0.1:8000/
if defined GROQ_API_KEY (echo Groq Cloud: HABILITADO) else (echo Groq Cloud: sin GROQ_API_KEY)
echo.

python -m uvicorn src.api:app --host 127.0.0.1 --port 8000 --reload
pause
