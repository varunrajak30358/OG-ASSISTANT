# ============================================================
#  OG Assistant — Auto Installer Script
#  Run this once on any new Windows system
#  Usage: Right-click → "Run with PowerShell"
#         OR: powershell -ExecutionPolicy Bypass -File install.ps1
# ============================================================

$ErrorActionPreference = "Stop"

function Write-Header {
  Clear-Host
  Write-Host ""
  Write-Host "   ██████╗  ██████╗ " -ForegroundColor Cyan
  Write-Host "  ██╔═══██╗██╔════╝ " -ForegroundColor Cyan
  Write-Host "  ██║   ██║██║  ███╗" -ForegroundColor Cyan
  Write-Host "  ██║   ██║██║   ██║" -ForegroundColor Cyan
  Write-Host "  ╚██████╔╝╚██████╔╝" -ForegroundColor Cyan
  Write-Host "   ╚═════╝  ╚═════╝ " -ForegroundColor Cyan
  Write-Host "  A S S I S T A N T"  -ForegroundColor White
  Write-Host ""
  Write-Host "  ─────────────────────────────────────────────" -ForegroundColor DarkCyan
  Write-Host "  INSTALLER  ·  Made by VR  ·  Powered by Gemini" -ForegroundColor DarkCyan
  Write-Host "  ─────────────────────────────────────────────" -ForegroundColor DarkCyan
  Write-Host ""
}

function Write-Step($num, $total, $msg) {
  Write-Host "  [$num/$total] " -ForegroundColor DarkCyan -NoNewline
  Write-Host $msg -ForegroundColor White
}

function Write-OK($msg) {
  Write-Host "  ✓  $msg" -ForegroundColor Green
}

function Write-Warn($msg) {
  Write-Host "  ⚠  $msg" -ForegroundColor Yellow
}

function Write-Fail($msg) {
  Write-Host "  ✗  $msg" -ForegroundColor Red
}

# ── Start ─────────────────────────────────────────────────────────────────────
Write-Header

$TOTAL_STEPS = 5

# ── STEP 1: Check Node.js ─────────────────────────────────────────────────────
Write-Step 1 $TOTAL_STEPS "Checking Node.js..."

$nodeOk = $false
try {
  $nodeVer = node --version 2>$null
  $major = [int]($nodeVer -replace "v(\d+)\..*", '$1')
  if ($major -ge 18) {
    Write-OK "Node.js $nodeVer found"
    $nodeOk = $true
  } else {
    Write-Warn "Node.js $nodeVer found but v18+ required"
  }
} catch {
  Write-Warn "Node.js not found"
}

if (-not $nodeOk) {
  Write-Host ""
  Write-Host "  Installing Node.js via winget..." -ForegroundColor DarkCyan
  try {
    winget install OpenJS.NodeJS.LTS --silent --accept-package-agreements --accept-source-agreements
    Write-OK "Node.js installed — please restart terminal after this script"
  } catch {
    Write-Fail "Could not auto-install Node.js"
    Write-Host "  → Download manually: https://nodejs.org" -ForegroundColor Yellow
    Write-Host ""
    Read-Host "  Press Enter to continue anyway"
  }
}

Write-Host ""

# ── STEP 2: Check/Install SoX ─────────────────────────────────────────────────
Write-Step 2 $TOTAL_STEPS "Checking SoX (audio engine)..."

$soxOk = $false
try {
  $soxVer = sox --version 2>&1
  Write-OK "SoX found: $soxVer"
  $soxOk = $true
} catch {
  Write-Warn "SoX not found in PATH"
}

# Also check WinGet install path
$wingetSox = "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\ChrisBagwell.SoX_Microsoft.WinGet.Source_8wekyb3d8bbwe\sox-14.4.2\sox.exe"
if (-not $soxOk -and (Test-Path $wingetSox)) {
  Write-OK "SoX found at WinGet path"
  $soxOk = $true
}

if (-not $soxOk) {
  Write-Host "  Installing SoX via winget..." -ForegroundColor DarkCyan
  try {
    winget install ChrisBagwell.SoX --silent --accept-package-agreements --accept-source-agreements
    Write-OK "SoX installed successfully"
  } catch {
    Write-Fail "Could not auto-install SoX"
    Write-Host "  → Run manually: winget install ChrisBagwell.SoX" -ForegroundColor Yellow
  }
}

Write-Host ""

# ── STEP 3: Install npm dependencies ─────────────────────────────────────────
Write-Step 3 $TOTAL_STEPS "Installing npm dependencies..."

if (-not (Test-Path "package.json")) {
  Write-Fail "package.json not found — make sure you run this from the OG-Assistant folder"
  Read-Host "Press Enter to exit"
  exit 1
}

try {
  npm install --silent
  Write-OK "Dependencies installed"
} catch {
  Write-Fail "npm install failed: $_"
  Read-Host "Press Enter to exit"
  exit 1
}

Write-Host ""

# ── STEP 4: Check .env / API Key ─────────────────────────────────────────────
Write-Step 4 $TOTAL_STEPS "Checking API key configuration..."

$envPath = ".\.env"
$hasKey  = $false

if (Test-Path $envPath) {
  $envContent = Get-Content $envPath -Raw
  if ($envContent -match "GOOGLE_API_KEY=.{10,}") {
    Write-OK "API key already configured in .env"
    $hasKey = $true
  }
}

if (-not $hasKey) {
  Write-Warn "No API key found — you will be prompted on first run"
  Write-Host "  → Get your free key at: https://aistudio.google.com/app/api-keys" -ForegroundColor DarkCyan
}

Write-Host ""

# ── STEP 5: Done ──────────────────────────────────────────────────────────────
Write-Step 5 $TOTAL_STEPS "Finalizing setup..."
Start-Sleep -Milliseconds 500
Write-OK "Setup complete"

Write-Host ""
Write-Host "  ─────────────────────────────────────────────" -ForegroundColor DarkCyan
Write-Host ""
Write-Host "  ✓  OG Assistant is ready to run!" -ForegroundColor Green
Write-Host ""
Write-Host "  HOW TO START:" -ForegroundColor White
Write-Host "  ─────────────────────────────────────────────" -ForegroundColor DarkGray
Write-Host "  1. Open terminal in this folder" -ForegroundColor Gray
Write-Host "  2. Run:  npm run dev" -ForegroundColor Cyan
Write-Host "  3. Open: http://localhost:6753" -ForegroundColor Cyan
Write-Host ""
Write-Host "  First run will ask for your Gemini API key." -ForegroundColor DarkGray
Write-Host "  Get it free at: https://aistudio.google.com/app/api-keys" -ForegroundColor DarkGray
Write-Host ""
Write-Host "  ─────────────────────────────────────────────" -ForegroundColor DarkCyan
Write-Host "  Made by VR  ·  OG Assistant v1.0" -ForegroundColor DarkCyan
Write-Host "  ─────────────────────────────────────────────" -ForegroundColor DarkCyan
Write-Host ""

# Ask to launch now
$launch = Read-Host "  Launch OG Assistant now? (y/n)"
if ($launch -eq "y" -or $launch -eq "Y") {
  Write-Host ""
  Write-Host "  Starting OG Assistant..." -ForegroundColor Cyan
  Start-Process "cmd" -ArgumentList "/k npm run dev" -WorkingDirectory (Get-Location)
}

Write-Host ""
Read-Host "  Press Enter to exit"
