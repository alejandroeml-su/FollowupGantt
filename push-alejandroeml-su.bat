@echo off
REM ============================================================
REM Push a GitHub: alejandroeml-su/FollowupGantt
REM Doble clic o ejecutar desde CMD/PowerShell
REM ============================================================

cd /d "%~dp0"

echo ==============================================
echo  FollowupGantt -^> github.com/alejandroeml-su
echo ==============================================
echo.

if not exist ".git" (
  echo [1/5] git init -b main
  git init -b main
) else (
  echo [1/5] Repo ya inicializado
)

echo [2/5] Configurando identidad
git config user.email "emartinez@complejoavante.com"
git config user.name "Edwin Martinez"

echo [3/5] git add .
git add .

echo [4/5] git commit
git commit -m "feat: bootstrap FollowupGantt (NestJS + Supabase + Vercel)" 2>nul

git remote remove origin 2>nul
git remote add origin https://github.com/alejandroeml-su/FollowupGantt.git

echo [5/5] git push -u origin main
git push -u origin main

echo.
echo ============================================
echo  LISTO. Repo: https://github.com/alejandroeml-su/FollowupGantt
echo ============================================
pause
