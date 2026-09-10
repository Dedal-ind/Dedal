# ============================================
# FestPass Frontend Deploy (monorepo)
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
                   "DEPLOY_FRONTEND_REMOTE_PATH", "DEPLOY_FRONTEND_VERIFY_URL")) {
    if (-not (Get-Variable -Name $var -ValueOnly -ErrorAction SilentlyContinue)) {
        throw "deploy.config.ps1 must set `$$var"
    }
}

$KEY = $DEPLOY_SSH_KEY_PATH
$SERVER_IP = $DEPLOY_SERVER_IP
$SERVER_USER = $DEPLOY_SERVER_USER
$REMOTE_PATH = $DEPLOY_FRONTEND_REMOTE_PATH
$VERIFY_URL = $DEPLOY_FRONTEND_VERIFY_URL
# The frontend is wherever this script lives.
$LOCAL_FRONTEND = $PSScriptRoot
$LOCAL_DIST = "$LOCAL_FRONTEND\dist"

Write-Host ""
Write-Host "==> Pre-flight checks..." -ForegroundColor Cyan

if (-not (Test-Path $KEY)) { throw "SSH key not found: $KEY" }
if (-not (Test-Path $LOCAL_FRONTEND)) { throw "Frontend folder not found" }
if (-not (Test-Path "$LOCAL_FRONTEND\package.json")) { throw "package.json missing" }

if (-not (Test-Path "$LOCAL_FRONTEND\.env.production")) {
    Write-Host "    WARNING: .env.production not found locally" -ForegroundColor Yellow
    Write-Host "    Vite will use .env or defaults. Continue anyway? Type YES" -ForegroundColor Yellow
    $c = Read-Host
    if ($c -ne "YES") { exit 1 }
} else {
    Write-Host "    .env.production present" -ForegroundColor Green
}

Write-Host "    SSH key found" -ForegroundColor Green

Write-Host ""
Write-Host "==> Testing SSH..." -ForegroundColor Cyan
ssh -i $KEY -o ConnectTimeout=10 -o BatchMode=yes "${SERVER_USER}@${SERVER_IP}" "echo connected" 2>$null
if ($LASTEXITCODE -ne 0) { throw "SSH connection failed" }
Write-Host "    SSH reachable" -ForegroundColor Green

Set-Location $LOCAL_FRONTEND

Write-Host ""
Write-Host "==> Cleaning previous dist..." -ForegroundColor Cyan
if (Test-Path $LOCAL_DIST) { Remove-Item -Recurse -Force $LOCAL_DIST }
Write-Host "    Cleaned" -ForegroundColor Green

Write-Host ""
Write-Host "==> Building..." -ForegroundColor Cyan
npm run build
if ($LASTEXITCODE -ne 0) { throw "Build failed" }
if (-not (Test-Path "$LOCAL_DIST\index.html")) { throw "Build produced no index.html" }
Write-Host "    Build succeeded" -ForegroundColor Green

Write-Host ""
Write-Host "==> Upload dist to ${SERVER_USER}@${SERVER_IP}:${REMOTE_PATH}" -ForegroundColor Yellow
Write-Host "    Type YES to proceed"
$confirm = Read-Host
if ($confirm -ne "YES") { Write-Host "Aborted." -ForegroundColor Red; exit 1 }

Write-Host ""
Write-Host "==> Clearing old build on server..." -ForegroundColor Cyan
ssh -i $KEY "${SERVER_USER}@${SERVER_IP}" "rm -rf ${REMOTE_PATH}/assets/* ${REMOTE_PATH}/index.html ${REMOTE_PATH}/*.svg ${REMOTE_PATH}/*.jpeg 2>/dev/null; echo cleared"
if ($LASTEXITCODE -ne 0) { throw "Failed to clear old build on server" }
Write-Host "    Old build cleared" -ForegroundColor Green

Write-Host ""
Write-Host "==> Uploading..." -ForegroundColor Cyan
scp -i $KEY -r "$LOCAL_DIST\*" "${SERVER_USER}@${SERVER_IP}:${REMOTE_PATH}/"
if ($LASTEXITCODE -ne 0) { throw "SCP upload failed" }
Write-Host "    Upload succeeded" -ForegroundColor Green

Write-Host ""
Write-Host "==> Verifying the DEPLOYED BUNDLE, not just the status code..." -ForegroundColor Cyan
Start-Sleep -Seconds 2

$localIndexHtml = Get-Content "$LOCAL_DIST\index.html" -Raw
$localBundle = [regex]::Match($localIndexHtml, 'assets/(index-[A-Za-z0-9_-]+\.js)').Groups[1].Value
if (-not $localBundle) { throw "Could not read the built bundle name from dist\index.html" }
Write-Host "    Built:  $localBundle" -ForegroundColor Gray

try {
    $verifyUrl = "$VERIFY_URL/?deploycheck=" + (Get-Random)
    $response = Invoke-WebRequest -Uri $verifyUrl -UseBasicParsing -TimeoutSec 15
    $servedBundle = [regex]::Match($response.Content, 'assets/(index-[A-Za-z0-9_-]+\.js)').Groups[1].Value
    Write-Host "    Served: $servedBundle" -ForegroundColor Gray

    if ($servedBundle -eq $localBundle) {
        Write-Host "    Deployed bundle matches the build." -ForegroundColor Green
    } else {
        Write-Host ""
        Write-Host "    MISMATCH: the site is NOT serving the build just uploaded." -ForegroundColor Red
        Write-Host "    The upload did not take effect. Check DEPLOY_FRONTEND_REMOTE_PATH and that nginx" -ForegroundColor Red
        Write-Host "    serves $REMOTE_PATH. Do NOT report this deploy as shipped." -ForegroundColor Red
        exit 1
    }

    $cacheControl = $response.Headers["Cache-Control"]
    if (-not $cacheControl) {
        Write-Host ""
        Write-Host "    WARNING: index.html is served with NO Cache-Control header." -ForegroundColor Yellow
        Write-Host "    Users may keep seeing the OLD UI despite this successful deploy." -ForegroundColor Yellow
        Write-Host "    Fix: apps/backend/docs/server-nginx-config.md (section 1)." -ForegroundColor Yellow
    }
} catch {
    Write-Host "    Warning: could not verify the served bundle ($($_.Exception.Message))" -ForegroundColor Yellow
    Write-Host "    Confirm manually before reporting this deploy as shipped." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "==> Frontend deploy complete." -ForegroundColor Green
Write-Host ""
