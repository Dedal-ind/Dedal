# ============================================
# FestPass Backend Deploy (monorepo)
# ============================================

$ErrorActionPreference = "Stop"

# ── Configuration ────────────────────────────────────────────────────────────
# All machine-specific values come from deploy.config.ps1 (gitignored).
# See deploy.config.example.ps1 for every required value.
$configPath = Join-Path $PSScriptRoot "deploy.config.ps1"
if (-not (Test-Path $configPath)) {
    throw "Missing deploy.config.ps1 — copy deploy.config.example.ps1 and fill in real values."
}
. $configPath

foreach ($var in @("DEPLOY_SSH_KEY_PATH", "DEPLOY_SERVER_IP", "DEPLOY_SERVER_USER",
                   "DEPLOY_REPO_REMOTE_PATH", "DEPLOY_PM2_PROCESS_NAME",
                   "DEPLOY_BACKEND_HEALTH_URL", "DEPLOY_PNPM_PATH")) {
    if (-not (Get-Variable -Name $var -ValueOnly -ErrorAction SilentlyContinue)) {
        throw "deploy.config.ps1 must set `$$var"
    }
}

$KEY = $DEPLOY_SSH_KEY_PATH
$SERVER_IP = $DEPLOY_SERVER_IP
$SERVER_USER = $DEPLOY_SERVER_USER
$REMOTE_REPO = $DEPLOY_REPO_REMOTE_PATH
$PM2_PROCESS_NAME = $DEPLOY_PM2_PROCESS_NAME
$HEALTH_ENDPOINT = $DEPLOY_BACKEND_HEALTH_URL
$PNPM = $DEPLOY_PNPM_PATH

Write-Host ""
Write-Host "==> Pre-flight checks..." -ForegroundColor Cyan

if (-not (Test-Path $KEY)) { throw "SSH key not found: $KEY" }
Write-Host "    SSH key found" -ForegroundColor Green

Write-Host ""
Write-Host "==> Testing SSH..." -ForegroundColor Cyan
ssh -i $KEY -o ConnectTimeout=10 -o BatchMode=yes "${SERVER_USER}@${SERVER_IP}" "echo connected" 2>$null
if ($LASTEXITCODE -ne 0) { throw "SSH connection failed" }
Write-Host "    SSH reachable" -ForegroundColor Green

Write-Host ""
Write-Host "==> Checking that local work is actually pushed..." -ForegroundColor Cyan
<#
  This script deploys from origin/main, NOT from this machine's working tree.
  Unpushed commits ship NOTHING: the pm2 restart succeeds, the health check
  passes, and the deploy looks green while the server still runs the old code.
#>
# The git root is two levels up from this script (apps/backend -> repo root).
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
Set-Location $repoRoot

$dirtyFiles = git status --porcelain
if ($dirtyFiles) {
    Write-Host "    WARNING: uncommitted changes — these will NOT deploy:" -ForegroundColor Yellow
    $dirtyFiles | Select-Object -First 10 | ForEach-Object { Write-Host "      $_" -ForegroundColor Yellow }
}

git fetch origin main --quiet
if ($LASTEXITCODE -ne 0) { throw "git fetch origin main failed — cannot verify what will deploy" }

$localHead = (git rev-parse HEAD).Trim()
$remoteHead = (git rev-parse origin/main).Trim()

if ($localHead -ne $remoteHead) {
    $unpushed = git log origin/main..HEAD --oneline
    Write-Host ""
    if ($unpushed) {
        Write-Host "    STOP: these local commits are NOT on origin/main and will NOT deploy:" -ForegroundColor Red
        $unpushed | ForEach-Object { Write-Host "      $_" -ForegroundColor Red }
        Write-Host "    Push them first (git push origin main), then re-run this script." -ForegroundColor Red
        exit 1
    }
    Write-Host "    NOTE: local HEAD differs from origin/main (behind, or another branch)." -ForegroundColor Yellow
    Write-Host "    The server will deploy origin/main: $remoteHead" -ForegroundColor Yellow
} else {
    Write-Host "    Local HEAD matches origin/main ($($localHead.Substring(0,7)))" -ForegroundColor Green
}

Write-Host ""
Write-Host "==> This pulls the latest from origin/main on GitHub." -ForegroundColor Yellow
Write-Host "    Type YES to proceed"
$confirm = Read-Host
if ($confirm -ne "YES") { Write-Host "Aborted." -ForegroundColor Red; exit 1 }

Write-Host ""
Write-Host "==> Fetching latest code on server..." -ForegroundColor Cyan

$fetchCommand = "set -e; " +
    "cd $REMOTE_REPO && " +
    "git fetch origin main && " +
    "git reset --hard origin/main"

ssh -i $KEY "${SERVER_USER}@${SERVER_IP}" $fetchCommand
if ($LASTEXITCODE -ne 0) { throw "git fetch/reset failed on server" }
Write-Host "    Code updated" -ForegroundColor Green

Write-Host ""
Write-Host "==> Installing dependencies (pnpm, backend only)..." -ForegroundColor Cyan

$installCommand = "set -e; " +
    "cd $REMOTE_REPO && " +
    "$PNPM install --filter fest-app-backend... --frozen-lockfile --prod"

ssh -i $KEY "${SERVER_USER}@${SERVER_IP}" $installCommand
if ($LASTEXITCODE -ne 0) { throw "pnpm install failed — do NOT restart PM2 with a broken dependency tree" }
Write-Host "    Install succeeded" -ForegroundColor Green

Write-Host ""
Write-Host "==> Running deploy migrations (idempotent)..." -ForegroundColor Cyan

$migrateCommand = "set -e; " +
    "cd $REMOTE_REPO/apps/backend && " +
    "node scripts/deploy-migrate.js"

ssh -i $KEY "${SERVER_USER}@${SERVER_IP}" $migrateCommand
if ($LASTEXITCODE -ne 0) { throw "Deploy migration failed — do NOT restart PM2. Fix the migration, then re-run." }
Write-Host "    Migrations passed" -ForegroundColor Green

Write-Host ""
Write-Host "==> Restarting PM2..." -ForegroundColor Cyan

$restartCommand = "set -e; " +
    "cd $REMOTE_REPO/apps/backend && " +
    "pm2 restart $PM2_PROCESS_NAME --update-env && " +
    "pm2 status"

ssh -i $KEY "${SERVER_USER}@${SERVER_IP}" $restartCommand
if ($LASTEXITCODE -ne 0) { throw "PM2 restart failed on server" }
Write-Host "    PM2 restarted" -ForegroundColor Green

Write-Host ""
Write-Host "==> Verifying health endpoint..." -ForegroundColor Cyan
Start-Sleep -Seconds 3

$maxAttempts = 5
$attempt = 0
$healthOK = $false

while ($attempt -lt $maxAttempts -and -not $healthOK) {
    $attempt++
    try {
        $response = Invoke-WebRequest -Uri $HEALTH_ENDPOINT -UseBasicParsing -TimeoutSec 10
        if ($response.StatusCode -eq 200 -and $response.Content -match "ok") {
            Write-Host "    Health check passed (attempt $attempt)" -ForegroundColor Green
            $healthOK = $true
        }
    } catch {
        Write-Host "    Attempt $attempt failed, retrying in 3s..." -ForegroundColor Yellow
        Start-Sleep -Seconds 3
    }
}

if (-not $healthOK) { throw "Health check failed after $maxAttempts attempts" }

Write-Host ""
Write-Host "==> Backend deploy complete." -ForegroundColor Green
Write-Host "    $HEALTH_ENDPOINT is responding OK." -ForegroundColor Cyan
Write-Host ""
