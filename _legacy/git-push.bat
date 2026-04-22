@echo off
REM ============================================================
REM FollowupGantt - Init + commit + push a GitHub
REM Uso: git-push.bat https://github.com/TU_USUARIO/FollowupGantt.git
REM ============================================================

if "%~1"=="" (
  echo Uso: git-push.bat ^<REPO_URL^>
  echo Ejemplo: git-push.bat https://github.com/edwinmartinez/FollowupGantt.git
  exit /b 1
)

cd /d "%~dp0"

if not exist ".git" (
  echo ==^> git init -b main
  git init -b main
) else (
  echo ==^> Repo ya inicializado
)

git config user.email "emartinez@complejoavante.com"
git config user.name "Edwin Martinez"

echo ==^> git add .
git add .

echo ==^> git commit
git commit -m "feat: bootstrap FollowupGantt (NestJS + Supabase + Vercel)" 2>nul

git remote remove origin 2>nul
echo ==^> git remote add origin %1
git remote add origin %1

echo ==^> git push -u origin main
git push -u origin main

echo.
echo LISTO. Repositorio en: %1
