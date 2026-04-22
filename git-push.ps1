# ===============================================================
# FollowupGantt - Script de inicialización + commit + push a GitHub
# Uso (PowerShell):
#   cd C:\proyecto\Gantt\FollowupGantt
#   .\git-push.ps1 -RepoUrl "https://github.com/TU_USUARIO/FollowupGantt.git"
#
# Parámetros opcionales:
#   -Branch "main"                 (rama por defecto)
#   -Message "Commit inicial..."   (mensaje del primer commit)
# ===============================================================

param(
    [Parameter(Mandatory = $true)]
    [string]$RepoUrl,

    [string]$Branch = "main",
    [string]$Message = "feat: bootstrap FollowupGantt (NestJS + Supabase + Vercel)"
)

$ErrorActionPreference = "Stop"

Write-Host "==> Entrando a $PSScriptRoot" -ForegroundColor Cyan
Set-Location $PSScriptRoot

# 1) Init (si no existe ya)
if (-not (Test-Path ".git")) {
    Write-Host "==> git init -b $Branch" -ForegroundColor Cyan
    git init -b $Branch
} else {
    Write-Host "==> Repositorio ya inicializado" -ForegroundColor Yellow
}

# 2) Configurar identidad (solo para este repo)
Write-Host "==> Configurando identidad local" -ForegroundColor Cyan
git config user.email "emartinez@complejoavante.com"
git config user.name  "Edwin Martinez"

# 3) Agregar archivos y commit
Write-Host "==> git add ." -ForegroundColor Cyan
git add .

# Solo commit si hay algo que committear
$changes = git status --porcelain
if ([string]::IsNullOrWhiteSpace($changes)) {
    Write-Host "==> No hay cambios nuevos para commit" -ForegroundColor Yellow
} else {
    Write-Host "==> git commit -m `"$Message`"" -ForegroundColor Cyan
    git commit -m $Message
}

# 4) Configurar remote
$existingRemote = git remote 2>$null
if ($existingRemote -match "origin") {
    Write-Host "==> Remote 'origin' ya existe, actualizando URL" -ForegroundColor Yellow
    git remote set-url origin $RepoUrl
} else {
    Write-Host "==> git remote add origin $RepoUrl" -ForegroundColor Cyan
    git remote add origin $RepoUrl
}

# 5) Push
Write-Host "==> git push -u origin $Branch" -ForegroundColor Cyan
git push -u origin $Branch

Write-Host ""
Write-Host "LISTO. Repositorio en: $RepoUrl" -ForegroundColor Green
